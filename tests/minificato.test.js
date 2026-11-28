'use strict';

// app.min.js è il file che il browser carica davvero: se resta indietro rispetto
// ad app.js, l'app pubblicata esegue codice vecchio mentre i test leggono quello
// nuovo. Il file generato porta in testa l'impronta di app.js, quindi qui basta
// ricalcolarla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const radice = path.join(__dirname, '..');

test('app.min.js corrisponde all’ultima versione di app.js', () => {
  const codice = fs.readFileSync(path.join(radice, 'app.js'), 'utf8');
  const attesa = crypto.createHash('sha256').update(codice).digest('hex').slice(0, 16);
  const minificato = fs.readFileSync(path.join(radice, 'app.min.js'), 'utf8');
  assert.match(minificato.slice(0, 400), new RegExp(attesa),
    'app.min.js è indietro: esegui `npm run minifica`');
});

test('index.html carica il file minificato e sw.js lo mette in cache', () => {
  const html = fs.readFileSync(path.join(radice, 'index.html'), 'utf8');
  assert.ok(html.includes('src="./app.min.js"'), 'index.html non carica app.min.js');
  const sw = fs.readFileSync(path.join(radice, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'./app.min.js'"), 'sw.js non mette app.min.js in precache');
});
