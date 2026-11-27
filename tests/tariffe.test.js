'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Tariffe = require('../tariffe');

// Coordinate reali: servono al prezzo del treno, che va a km.
const urbano = { nome: 'Bologna - Piazza Maggiore', zona: '500', tipo: 'bus', lat: 44.494373, lon: 11.343674 };
const extraBus = { nome: 'Imola - Autostazione', zona: '510', tipo: 'bus', lat: 44.354, lon: 11.714 };
const extraTreno = { nome: 'Imola - Stazione', zona: '510', tipo: 'treno', lat: 44.359375, lon: 11.718726 };
const stazioneBologna = { nome: 'Bologna - Stazione Centrale', zona: '500', tipo: 'entrambi', lat: 44.506234, lon: 11.342267 };

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

test('bus extraurbano: resta la tariffa a zone', () => {
  const bus = Tariffe.calcola(urbano, extraBus, false);
  assert.equal(bus.prezzo, 2.9);
  assert.equal(bus.titolo, 'Biglietto a 2 zone necessario');
});

test('treno: prezzo a km, non a zone (Bologna–Imola 34 km = 4,90 €)', () => {
  const treno = Tariffe.calcola(urbano, extraTreno, false, { treno: true });
  assert.equal(treno.prezzo, 4.9, 'la tariffa a due zone dava 3,10 €');
  assert.equal(treno.titolo, 'Biglietto regionale necessario');
  // Linea d'aria ~33 km: stessa fascia della distanza ferroviaria (34 km).
  assert.match(treno.prezzoNota, /^3[0-9] km · tariffa regionale/);

  // Senza il segnale "treno" resta la stima a zone: il prezzo del treno non si
  // applica a un itinerario che usa solo bus.
  const senzaSegnale = Tariffe.calcola(urbano, extraTreno, false);
  assert.equal(senzaSegnale.prezzo, 2.9);
});

test('treno con abbonamento urbano: serve comunque il biglietto regionale', () => {
  const con = Tariffe.calcola(stazioneBologna, extraTreno, true, { treno: true });
  assert.equal(con.prezzo, 4.9);
  assert.equal(con.badge, 'arancio');
  assert.match(con.avviso, /abbonamento urbano/);
});

test('Marconi Express: tariffa separata, non coperta dall’abbonamento', () => {
  const aeroporto = { id: 'TRN044', nome: 'Bologna - Aeroporto', zona: '500', tipo: 'treno', lat: 44.52876, lon: 11.29440 };
  const lazzaretto = { id: 'TRN043', nome: 'Lazzaretto - Stazione', zona: '500', tipo: 'treno', lat: 44.51792, lon: 11.31785 };
  const centrale = { id: 'TRN001', nome: 'Bologna - Stazione Centrale', zona: '500', tipo: 'entrambi', lat: 44.506234, lon: 11.342267 };

  const aeroportoCentrale = Tariffe.calcolaMex(centrale, aeroporto);
  assert.equal(aeroportoCentrale.prezzo, 12.8);
  assert.equal(aeroportoCentrale.titolo, 'Biglietto Marconi Express');
  assert.match(aeroportoCentrale.prezzoNota, /Aeroporto–Bologna Centrale/);

  const centraleLazzaretto = Tariffe.calcolaMex(centrale, lazzaretto);
  assert.equal(centraleLazzaretto.prezzo, 2.3);
  assert.match(centraleLazzaretto.avviso, /separato dai titoli TPER/);

  assert.equal(Tariffe.calcolaMex(urbano, extraBus), null);
});

test('scaglioni del treno: minimo 2,90 € e nessun prezzo oltre 200 km', () => {
  assert.equal(Tariffe.prezzoTreno(4), 2.9);
  assert.equal(Tariffe.prezzoTreno(14), 3.4);
  assert.equal(Tariffe.prezzoTreno(25), 4.0);
  assert.equal(Tariffe.prezzoTreno(34.1), 4.9);
  assert.equal(Tariffe.prezzoTreno(52), 5.7);
  assert.equal(Tariffe.prezzoTreno(99), 8.2);
  assert.equal(Tariffe.prezzoTreno(300), null);
  assert.equal(Tariffe.prezzoTreno(null), null);
});

test('extraurbano → urbano e abbonamento urbano', () => {
  const senza = Tariffe.calcola(extraBus, urbano, false);
  assert.equal(senza.prezzo, 2.9);

  const con = Tariffe.calcola(extraBus, urbano, true);
  assert.equal(con.prezzo, 2.3);
  assert.equal(con.badge, 'arancio');
  assert.match(con.avviso, /integrazione extraurbana/);
});

test('due zone extraurbane: nessun prezzo inventato', () => {
  const esito = Tariffe.calcola(extraBus, { nome: 'Vignola', zona: '591', tipo: 'treno', lat: 44.5, lon: 10.99 }, false);
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

test('l\'etichetta della zona dice se è urbana, neutra o extraurbana', () => {
  assert.deepEqual(Tariffe.etichettaZona('500'), { titolo: 'Zona 500', nota: 'Area urbana di Bologna · 1 zona' });
  assert.deepEqual(Tariffe.etichettaZona(509), { titolo: 'Zona 509', nota: 'Zona neutra dell’area urbana (cuscinetto)' });
  assert.deepEqual(Tariffe.etichettaZona('577'), { titolo: 'Zona 577', nota: 'Extraurbana' });
  assert.equal(Tariffe.etichettaZona(null).titolo, 'Zona non nota');
});
