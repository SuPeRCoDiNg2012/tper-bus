'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Tracciato = require('../tracciato');

function tappa(extra) {
  return Object.assign({ linea: '20', tipo: 3, da: 'TRN001', a: 'TRN008', forma: 12 }, extra);
}

function geometria(punti, ufficiale) {
  return {
    punti: punti || [[11.34, 44.49], [11.35, 44.50], [11.36, 44.51]],
    ufficiale: ufficiale !== false
  };
}

test('le tappe ferroviarie non vengono passate al map matching stradale', () => {
  const tappe = [
    tappa({ tipo: 2, linea: 'S1A' }),   // treno
    tappa({ tipo: 1, linea: 'MEX' }),   // metropolitana
    tappa({ tipo: 3, linea: '20' })     // bus
  ];
  const geometrie = [geometria(), geometria(), geometria()];
  const richieste = Tracciato.richiesteSnap(tappe, geometrie);

  assert.equal(richieste.length, tappe.length);
  assert.equal(richieste[0], null, 'un treno non va agganciato alle strade');
  assert.equal(richieste[1], null, 'la metropolitana non va agganciata alle strade');
  // Il bus invece si aggancia: la regola esclude solo i binari.
  assert.deepEqual(richieste[2], geometrie[2].punti);
});

test('un treno resta escluso anche con geometria ufficiale lunga e forma valida', () => {
  const punti = Array.from({ length: 40 }, (_, i) => [11.3 + i / 1000, 44.5 + i / 1000]);
  const richieste = Tracciato.richiesteSnap([tappa({ tipo: 2, forma: 1234 })], [geometria(punti)]);

  assert.equal(richieste[0], null);
  assert.equal(Tracciato.eFerroviaria(tappa({ tipo: 2 })), true);
  assert.equal(Tracciato.eFerroviaria(tappa({ tipo: 1 })), true);
  assert.equal(Tracciato.eFerroviaria(tappa({ tipo: 3 })), false);
  assert.equal(Tracciato.eFerroviaria(null), false);
});

test('il bus si aggancia solo con geometria ufficiale, abbastanza fitta e forma GTFS', () => {
  const tappe = [
    tappa({}),
    tappa({ forma: -1 }),
    tappa({}),
    tappa({})
  ];
  const geometrie = [
    geometria(),
    geometria(),
    geometria(null, false),
    geometria([[11.34, 44.49], [11.35, 44.5]])
  ];
  const richieste = Tracciato.richiesteSnap(tappe, geometrie);

  assert.deepEqual(richieste, [geometrie[0].punti, null, null, null]);
});

test('una geometria mancante non rompe l’elenco delle richieste', () => {
  const richieste = Tracciato.richiesteSnap([tappa({}), tappa({ tipo: 2 })], [null]);

  assert.deepEqual(richieste, [null, null]);
  assert.deepEqual(Tracciato.richiesteSnap(null, null), []);
});
