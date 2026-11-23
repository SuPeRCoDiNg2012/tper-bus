'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Tariffe = require('../tariffe');

const urbano = { nome: 'Centro', zona: '500', tipo: 'bus' };
const extraBus = { nome: 'Imola', zona: '510', tipo: 'bus' };
const extraTreno = { nome: 'Imola - Stazione', zona: '510', tipo: 'treno' };

test('urbano ↔ urbano: biglietto urbano o abbonamento', () => {
  const senza = Tariffe.calcola(urbano, { ...urbano, zona: 508 }, false);
  assert.equal(senza.prezzo, 2.3);
  assert.equal(senza.badge, 'rosso');
  assert.equal(senza.avviso, null);

  const con = Tariffe.calcola(urbano, urbano, true);
  assert.equal(con.prezzo, 0);
  assert.equal(con.badge, 'verde');
  assert.equal(con.prezzoNota, 'Nessun costo aggiuntivo');
});

test('urbano ↔ extraurbano bus e treno usano tariffe diverse', () => {
  const bus = Tariffe.calcola(urbano, extraBus, false);
  assert.equal(bus.prezzo, 2.9);
  assert.equal(bus.titolo, 'Biglietto a 2 zone necessario');

  const treno = Tariffe.calcola(urbano, extraTreno, false);
  assert.equal(treno.prezzo, 3.1);
  assert.match(treno.prezzoNota, /stima treno/);
});

test('extraurbano → urbano e abbonamento urbano', () => {
  const senza = Tariffe.calcola(extraBus, urbano, false);
  assert.equal(senza.prezzo, 2.9);

  const con = Tariffe.calcola(extraBus, urbano, true);
  assert.equal(con.prezzo, 2.3);
  assert.equal(con.badge, 'arancio');
  assert.match(con.avviso, /integrazione extraurbana/);

  // Con l'abbonamento resta una sola zona extraurbana: tariffa treno a 1 zona.
  const conTreno = Tariffe.calcola(extraTreno, urbano, true);
  assert.equal(conTreno.prezzo, 2.3);
  assert.match(conTreno.prezzoNota, /stima treno/);
});

test('due zone extraurbane: nessun prezzo inventato', () => {
  const esito = Tariffe.calcola(extraBus, { nome: 'Vignola', zona: '591', tipo: 'treno' }, false);
  assert.equal(esito.prezzo, null);
  assert.equal(esito.badge, 'info');
  assert.match(esito.avviso, /calcolatore ufficiale/);
});

test('avvisi di confine per Zola Predosa e Sasso Marconi', () => {
  assert.match(Tariffe.avvisoConfine({ nome: 'Zola', zona: '571' }), /Zola Predosa/);
  assert.match(Tariffe.avvisoConfine({ nome: 'Sasso', zona: '581' }), /Casalecchio - Garibaldi/);
  assert.match(Tariffe.avvisoConfine({ nome: 'Marzabotto', zona: '582' }), /Casalecchio - Garibaldi/);
  assert.match(Tariffe.avvisoConfine({ nome: 'Ferrara', zona: '700' }), /integrazione extraurbana/);
});

test('zone urbane e numeri accettati come stringhe', () => {
  assert.equal(Tariffe.isZonaUrbana('500'), true);
  assert.equal(Tariffe.isZonaUrbana('509'), true);
  assert.equal(Tariffe.isZonaUrbana(510), false);
  assert.equal(Tariffe.isZonaUrbana('510'), false);
});
