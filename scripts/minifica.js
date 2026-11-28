'use strict';

/* app.min.js: app.js minificato, senza bundler.
 *
 * Il progetto non ha un bundler e non ne ha bisogno: index.html carica script
 * normali e app.js è un'unica IIFE che parla con oggetti globali. Qui si fa
 * solo quello che serve al primo avvio, cioè togliere spazi e commenti e
 * accorciare i nomi locali, lasciando intatta la struttura.
 *
 * Il risultato si committa (Vercel e GitHub servono i file così come sono, non
 * c'è una build in produzione) e porta in testa l'impronta di app.js:
 * tests/minificato.test.js fallisce se qualcuno modifica il sorgente e
 * dimentica `npm run minifica`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const terser = require('terser');

const radice = path.join(__dirname, '..');
const sorgente = path.join(radice, 'app.js');
const destinazione = path.join(radice, 'app.min.js');

function impronta(codice) {
  return crypto.createHash('sha256').update(codice).digest('hex').slice(0, 16);
}

async function main() {
  const codice = fs.readFileSync(sorgente, 'utf8');
  const firma = impronta(codice);
  const esito = await terser.minify({ 'app.js': codice }, {
    compress: true,
    mangle: true,
    // Nessun commento nel file servito, ma le direttive restano (servono ai
    // `use strict` interni).
    format: { comments: false, ascii_only: true }
  });
  if (!esito || !esito.code) throw new Error('terser non ha prodotto codice');
  const testa = '/* app.min.js — generato da app.js con `npm run minifica`. Non modificare a mano.\n' +
    ' * app.js: ' + Buffer.byteLength(codice) + ' byte, impronta ' + firma + '.\n' +
    ' * app.min.js: ' + Buffer.byteLength(esito.code) + ' byte. */\n';
  fs.writeFileSync(destinazione, testa + esito.code);
  console.log('app.js      ' + Buffer.byteLength(codice) + ' byte · impronta ' + firma);
  console.log('app.min.js  ' + Buffer.byteLength(testa + esito.code) + ' byte');
}

main().catch((errore) => {
  console.error('minifica fallita:', errore && errore.message ? errore.message : errore);
  process.exitCode = 1;
});
