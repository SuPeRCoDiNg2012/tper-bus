#!/usr/bin/env node
'use strict';

/* Genera la coppia VAPID per il Worker.
 *
 *   node push/genera-chiavi.js
 *
 * Stampa:
 *  - VAPID_PRIVATE_JWK  → segreto del Worker (wrangler secret put)
 *  - VAPID_PUBLIC       → variabile pubblica del Worker e `PUSH_CHIAVE` se
 *                         vuoi fissarla nell'app invece di leggerla da /config
 *
 * La chiave privata è un JWK perché il Worker la importa così, senza DER.
 */

const { webcrypto } = require('node:crypto');

async function principale() {
  const coppia = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privata = await webcrypto.subtle.exportKey('jwk', coppia.privateKey);
  const pubblica = await webcrypto.subtle.exportKey('jwk', coppia.publicKey);
  const b64u = (testo) => Buffer.from(testo, 'base64url');
  const punto = Buffer.concat([
    Buffer.from([4]),
    b64u(privata.x),
    b64u(privata.y)
  ]);
  const chiavePubblica = punto.toString('base64url');
  console.log('');
  console.log('Segreto del Worker (una riga, JSON):');
  console.log('  VAPID_PRIVATE_JWK=' + JSON.stringify(privata));
  console.log('');
  console.log('Variabile pubblica del Worker:');
  console.log('  VAPID_PUBLIC=' + chiavePubblica);
  console.log('');
  console.log('Comandi:');
  console.log('  npx wrangler secret put VAPID_PRIVATE_JWK --config push/wrangler.toml');
  console.log('  npx wrangler secret put VAPID_SUBJECT --config push/wrangler.toml   # mailto:tu@example.com');
  console.log('');
  console.log('Nota: se rigeneri le chiavi, le sottoscrizioni esistenti smettono di funzionare.');
}

principale().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
