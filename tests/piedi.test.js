'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Piedi = require('../piedi');

test('URL pedonale: coordinate [lon, lat], non invertite', () => {
  const url = Piedi.url([11.300004, 44.500004], [11.310006, 44.510007]);
  assert.equal(
    url,
    'https://routing.openstreetmap.de/routed-foot/route/v1/foot/11.30000,44.50000;11.31001,44.51001'
  );
  // Il primo numero deve essere la longitudine (11.x), non la latitudine (44.x).
  assert.match(url, /foot\/11\.30000,44\.50000;11\.31001,44\.51001$/);
});

test('chiave di cache stabile e coerente con le coordinate', () => {
  const da = [11.3, 44.5];
  const a = [11.31, 44.51];
  assert.equal(Piedi.chiave(da, a), '11.30000,44.50000|11.31000,44.51000');
  assert.equal(Piedi.chiave(da, a), Piedi.chiave(da, a));
  assert.notEqual(Piedi.chiave(da, a), Piedi.chiave(a, da));
});

test('risposta OSRM: accetta GeoJSON [lon, lat] e scarta risposte inutilizzabili', () => {
  const coordinate = [[11.3, 44.5], [11.31, 44.51]];
  const dati = { code: 'Ok', routes: [{ geometry: { coordinates: coordinate } }] };
  assert.deepEqual(Piedi.geometriaRisposta(dati), coordinate);
  assert.equal(Piedi.geometriaRisposta({ code: 'NoRoute' }), null);
  assert.equal(Piedi.geometriaRisposta({ code: 'Ok', routes: [] }), null);
  assert.equal(Piedi.geometriaRisposta({ code: 'Ok', routes: [{ geometry: { coordinates: [[11.3, 44.5]] } }] }), null);
  assert.equal(Piedi.geometriaRisposta(null), null);
});

test('lunghezza e validità: scarta geometrie assurde o incomplete', () => {
  const vicini = [[11.3, 44.5], [11.31, 44.51]];
  assert.ok(Piedi.lunghezza(vicini) > 1300 && Piedi.lunghezza(vicini) < 1500);
  assert.equal(Piedi.valida(vicini, 2500), true);
  assert.equal(Piedi.valida(vicini, 1000), false);
  assert.equal(Piedi.valida([[11.3, 44.5]], 2500), false);
  assert.equal(Piedi.valida(null, 2500), false);
  assert.equal(Piedi.lunghezza([[11.3, 44.5]]), 0);
});
