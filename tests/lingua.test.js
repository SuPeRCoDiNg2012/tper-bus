'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Lingua = require('../lingua');

test('traduce le voci del menu e lascia stare i nomi propri', () => {
  assert.equal(Lingua.traduci('Impostazioni'), 'Settings');
  assert.equal(Lingua.traduci('  Partenza  '), '  From  ');
  assert.equal(Lingua.traduci('Piazza Maggiore'), 'Piazza Maggiore');
  assert.equal(Lingua.traduci('Stazione Centrale'), 'Stazione Centrale');
  assert.equal(Lingua.traduci('Via Indipendenza 12'), 'Via Indipendenza 12');
});

test('traduce le righe composte senza toccare i numeri', () => {
  assert.equal(Lingua.traduci('Palina 100 · Zona 500 · 29 · A'), 'Stop 100 · Zone 500 · 29 · A');
  assert.equal(Lingua.traduci('Linea 20 · 19:28'), 'Line 20 · 19:28');
  assert.equal(Lingua.traduci('Indirizzo · zona 500'), 'Address · zone 500');
});

test('le notifiche dell’ultima corsa hanno una versione inglese', () => {
  assert.equal(Lingua.traduci('Ultima corsa tra 12 min'), 'Last bus in 12 min');
  assert.equal(Lingua.traduci('Ultima corsa alle 21:14'), 'Last bus at 21:14');
  assert.equal(Lingua.traduci('5 min a piedi'), '5 min on foot');
});

test('quello che non è nel dizionario resta com’è', () => {
  assert.equal(Lingua.traduci(''), '');
  assert.equal(Lingua.traduci('39032'), '39032');
});
