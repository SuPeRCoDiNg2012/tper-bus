/* Muovi Bologna — Web Push lato server.
 *
 * Solo WebCrypto (nessuna dipendenza, nessun bundler): gira nel Worker e nei
 * test Node. Riferimenti: RFC 8291 (cifratura del payload), RFC 8188
 * (content coding aes128gcm), RFC 8292 (VAPID).
 *
 * Il modulo è verificato contro l'esempio ufficiale della RFC 8291 §5: la
 * stessa chiave, lo stesso salt e lo stesso testo devono produrre esattamente
 * gli stessi byte. Vedi tests/push.test.js.
 */

const TESTO = new TextEncoder();
const RS = 4096;

export function b64uToBytes(testo) {
  const base64 = String(testo).replace(/-/g, '+').replace(/_/g, '/');
  const riempimento = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binario = atob(base64 + riempimento);
  const byte = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) byte[i] = binario.charCodeAt(i);
  return byte;
}

export function bytesToB64u(byte) {
  let binario = '';
  const vista = new Uint8Array(byte);
  for (let i = 0; i < vista.length; i += 1) binario += String.fromCharCode(vista[i]);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parti) {
  const totale = parti.reduce((somma, parte) => somma + parte.length, 0);
  const uscita = new Uint8Array(totale);
  let offset = 0;
  parti.forEach((parte) => {
    uscita.set(parte, offset);
    offset += parte.length;
  });
  return uscita;
}

async function hmac(chiave, dati) {
  const importata = await crypto.subtle.importKey('raw', chiave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', importata, dati));
}

// HKDF-Expand a un solo blocco: qui la lunghezza richiesta è sempre ≤ 32 byte,
// quindi T(1) è tutto quello che serve.
async function hkdf(chiave, info, lunghezza) {
  const blocco = await hmac(chiave, concat(info, new Uint8Array([1])));
  return blocco.slice(0, lunghezza);
}

export function chiavePubblicaDaJwk(jwk) {
  const x = b64uToBytes(jwk.x);
  const y = b64uToBytes(jwk.y);
  return concat(new Uint8Array([4]), x, y);
}

/** Chiavi finali della cifratura, esposte per i test e per il debug. */
export async function chiaviCifratura({ uaPublic, authSecret, asPrivate, asPublic, salt }) {
  const pubblicaUa = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const privataAs = await crypto.subtle.importKey(
    'jwk', asPrivate, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']
  );
  const segreto = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: pubblicaUa }, privataAs, 256)
  );
  // HKDF-Extract(auth_secret, ecdh_secret) → IKM con il "WebPush: info".
  const prkKey = await hmac(authSecret, segreto);
  const info = concat(TESTO.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(prkKey, info, 32);
  // HKDF del content coding (RFC 8188).
  const prk = await hmac(salt, ikm);
  // cek_info e nonce_info finiscono con uno 0x00 (RFC 8188 §2), poi la HKDF
  // aggiunge il suo 0x01: senza quello zero la chiave esce sbagliata.
  const cek = await hkdf(prk, concat(TESTO.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(prk, concat(TESTO.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);
  return { cek, nonce, segreto };
}

/**
 * Corpo della richiesta push: header aes128gcm + ciphertext.
 * `payload` è la stringa JSON che arriva al service worker.
 */
export async function cifraPayload(payload, opzioni) {
  const { uaPublic, authSecret, asPrivate, asPublic, salt } = opzioni;
  const { cek, nonce } = await chiaviCifratura({ uaPublic, authSecret, asPrivate, asPublic, salt });
  const header = concat(
    salt,
    new Uint8Array([0, 0, RS >> 8, RS & 0xff]),
    new Uint8Array([asPublic.length]),
    asPublic
  );
  // Il delimitatore 0x02 chiude il record (RFC 8188 §2).
  const chiaro = concat(TESTO.encode(payload), new Uint8Array([2]));
  const chiave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // aes128gcm non autentica l'header come dato aggiuntivo: salt e keyid sono
  // già legati alla chiave e al nonce (RFC 8188 §2). Passarlo qui produce un
  // tag che i browser rifiutano.
  const cifrato = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, chiave, chiaro)
  );
  return concat(header, cifrato);
}

/** JWT ES256 per l'header `Authorization: vapid t=…, k=…`. */
export async function firmaVapid({ chiave, soggetto, audience, secondi = 12 * 3600, adesso }) {
  const ora = adesso == null ? Date.now() : adesso;
  const intestazione = bytesToB64u(TESTO.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = bytesToB64u(TESTO.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(ora / 1000) + secondi,
    sub: soggetto
  })));
  const dati = TESTO.encode(intestazione + '.' + corpo);
  const privata = await crypto.subtle.importKey(
    'jwk', chiave, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privata, dati));
  return intestazione + '.' + corpo + '.' + bytesToB64u(firma);
}

/**
 * Invia una notifica al servizio push del browser.
 * `sottoscrizione` è l'oggetto di `PushSubscription.toJSON()`.
 */
export async function inviaPush({ sottoscrizione, payload, vapid }) {
  const endpoint = new URL(sottoscrizione.endpoint);
  const chiavi = sottoscrizione.keys || {};
  const uaPublic = b64uToBytes(chiavi.p256dh);
  const authSecret = b64uToBytes(chiavi.auth);
  const coppia = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPrivate = await crypto.subtle.exportKey('jwk', coppia.privateKey);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', coppia.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const corpo = await cifraPayload(payload, { uaPublic, authSecret, asPrivate, asPublic, salt });
  const jwt = await firmaVapid({
    chiave: vapid.chiavePrivata,
    soggetto: vapid.soggetto,
    audience: endpoint.origin
  });
  return fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      TTL: '3600',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: 'vapid t=' + jwt + ', k=' + vapid.chiavePubblica
    },
    body: corpo
  });
}
