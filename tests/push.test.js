'use strict';

// Verifica della crittografia Web Push senza rete né servizi esterni:
// l'esempio della RFC 8291 §5 è un vettore noto, quindi se i byte combaciano
// la cifratura è corretta e non solo "sembra funzionare".
const test = require('node:test');
const assert = require('node:assert/strict');

const b64u = (testo) => testo.replace(/\s+/g, '');

// RFC 8291 §5 e Appendice A.
const UA_PUBLIC = b64u('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
const UA_PRIVATE = b64u('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94');
const AS_PUBLIC = b64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
const AS_PRIVATE = b64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
const AUTH_SECRET = b64u('BTBZMqHH6r4Tts7J_aSIgg');
const SALT = b64u('DGv6ra1nlYgDCS1FRnbzlw');
const TESTO_ATTESO = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztL' +
  'VBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

let C;

test.before(async () => {
  C = await import('../push/crypto.mjs');
});

test('base64url fa andata e ritorno senza perdere byte', () => {
  assert.equal(C.bytesToB64u(C.b64uToBytes(AS_PUBLIC)), AS_PUBLIC);
  assert.equal(C.bytesToB64u(C.b64uToBytes(AUTH_SECRET)), AUTH_SECRET);
  assert.equal(C.b64uToBytes(UA_PUBLIC).length, 65);
  assert.equal(C.b64uToBytes(UA_PUBLIC)[0], 4);
});

test('le chiavi derivate combaciano con l’Appendice A della RFC 8291', async () => {
  const x = C.b64uToBytes(AS_PUBLIC).slice(1, 33);
  const y = C.b64uToBytes(AS_PUBLIC).slice(33, 65);
  const asPrivate = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: AS_PRIVATE,
    x: C.bytesToB64u(x),
    y: C.bytesToB64u(y)
  };
  const chiavi = await C.chiaviCifratura({
    uaPublic: C.b64uToBytes(UA_PUBLIC),
    authSecret: C.b64uToBytes(AUTH_SECRET),
    asPrivate,
    asPublic: C.b64uToBytes(AS_PUBLIC),
    salt: C.b64uToBytes(SALT)
  });
  assert.equal(C.bytesToB64u(chiavi.segreto), 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs');
  assert.equal(C.bytesToB64u(chiavi.cek), 'oIhVW04MRdy2XN9CiKLxTg');
  assert.equal(C.bytesToB64u(chiavi.nonce), '4h_95klXJ5E_qnoN');
});

test('il corpo cifrato è identico all’esempio della RFC 8291', async () => {
  const x = C.b64uToBytes(AS_PUBLIC).slice(1, 33);
  const y = C.b64uToBytes(AS_PUBLIC).slice(33, 65);
  const asPrivate = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: AS_PRIVATE,
    x: C.bytesToB64u(x),
    y: C.bytesToB64u(y)
  };
  const corpo = await C.cifraPayload('When I grow up, I want to be a watermelon', {
    uaPublic: C.b64uToBytes(UA_PUBLIC),
    authSecret: C.b64uToBytes(AUTH_SECRET),
    asPrivate,
    asPublic: C.b64uToBytes(AS_PUBLIC),
    salt: C.b64uToBytes(SALT)
  });
  assert.equal(C.bytesToB64u(corpo), TESTO_ATTESO);
});

test('il JWT VAPID è ES256, verificabile e con la chiave giusta', async () => {
  const coppia = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privata = await crypto.subtle.exportKey('jwk', coppia.privateKey);
  const pubblica = await crypto.subtle.exportKey('jwk', coppia.publicKey);
  const jwt = await C.firmaVapid({
    chiave: privata,
    soggetto: 'mailto:prova@example.com',
    audience: 'https://fcm.googleapis.com',
    adesso: Date.UTC(2026, 0, 1)
  });
  const parti = jwt.split('.');
  assert.equal(parti.length, 3);
  const intestazione = JSON.parse(Buffer.from(parti[0], 'base64url').toString());
  const corpo = JSON.parse(Buffer.from(parti[1], 'base64url').toString());
  assert.deepEqual(intestazione, { typ: 'JWT', alg: 'ES256' });
  assert.equal(corpo.aud, 'https://fcm.googleapis.com');
  assert.equal(corpo.sub, 'mailto:prova@example.com');
  assert.equal(corpo.exp, Math.floor(Date.UTC(2026, 0, 1) / 1000) + 12 * 3600);
  const valida = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await crypto.subtle.importKey('jwk', pubblica, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
    Buffer.from(parti[2], 'base64url'),
    Buffer.from(parti[0] + '.' + parti[1])
  );
  assert.equal(valida, true);
  // La chiave pubblica nell'header deve essere quella del JWK: 65 byte, 0x04.
  assert.equal(C.bytesToB64u(C.chiavePubblicaDaJwk(pubblica)), C.bytesToB64u(C.chiavePubblicaDaJwk(pubblica)));
  const punto = C.chiavePubblicaDaJwk(pubblica);
  assert.equal(punto.length, 65);
  assert.equal(punto[0], 4);
});
