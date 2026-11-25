#!/usr/bin/env node
/**
 * bump-cache.js
 *
 * Incrementa di uno la versione delle cache in sw.js, così il browser non
 * continua a servire l'app di ieri dopo una modifica.
 *
 * USO
 *   npm run bump        (oppure: node scripts/bump-cache.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'sw.js');
const testo = fs.readFileSync(file, 'utf8');
const trovata = testo.match(/muovi-bologna-static-v(\d+)/);
if (!trovata) {
  console.error('Versione cache non trovata in sw.js');
  process.exit(1);
}
const nuova = Number(trovata[1]) + 1;
const aggiornato = testo.replace(/(muovi-bologna-(?:static|data)-v)\d+/g, '$1' + nuova);
fs.writeFileSync(file, aggiornato);
console.log('cache: v' + trovata[1] + ' → v' + nuova);
