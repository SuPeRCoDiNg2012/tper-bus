'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { caricaRouting, polilinea } = require('./helpers');
const TPERRouting = require('../routing');

const GIORNO = new Date(2026, 10, 23, 8, 0, 0); // lunedì 23 novembre 2026
const DOMENICA = new Date(2026, 10, 22, 8, 0, 0);
const TUTTI = [[127, 20260101, 20261231]];

function dati(orari, servizi) {
  return {
    fermate: ['A', 'B', 'C', 'D', 'E'],
    linee: [['L1', 3], ['L2', 3], ['T1', 2]],
    servizi: servizi || TUTTI,
    eccezioni: {},
    corse: orari
  };
}

test('percorso diretto e cambio con attesa', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],       // L1 A 08:00 → B 08:10
    [1, 0, 1, 29700, 1, 600]        // L2 B 08:15 → C 08:25
  ]));

  const esito = routing.calcola('A', 'C', GIORNO, { maxCambi: 3 });
  assert.equal(esito.cambi, 1);
  assert.deepEqual(esito.tappe.map((t) => t.linea), ['L1', 'L2']);
  assert.equal(esito.partenza, 28800);
  assert.equal(esito.arrivo, 30300);
  assert.equal(esito.tappe[1].attesa, 300);
  assert.equal(esito.tappe[0].fermate, 1);
  assert.equal(esito.tappe[1].fermate, 1);
});

test('maxCambi rispettato: diretto a zero, cambio a uno', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],
    [1, 0, 1, 29700, 1, 600]
  ]));

  assert.equal(routing.calcola('A', 'B', GIORNO, { maxCambi: 0 }).cambi, 0);
  assert.equal(routing.calcola('A', 'C', GIORNO, { maxCambi: 0 }), null);
  assert.equal(routing.calcola('A', 'C', GIORNO, { maxCambi: 1 }).cambi, 1);
});

test('cambio a piedi tra paline vicine non consuma un cambio', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],       // A → B
    [2, 0, 3, 30000, 1, 600]        // D → E
  ]));
  routing.impostaCammini([['B', 'D', 120]]);

  // Il tratto a piedi non è un cambio, ma serve un round per raggiungere la
  // palina successiva: con maxCambi 1 il viaggio ha un solo cambio di linea.
  const esito = routing.calcola('A', 'E', GIORNO, { maxCambi: 1 });
  assert.ok(esito);
  assert.equal(esito.cambi, 1);
  assert.deepEqual(esito.tappe[1].camminoPrima, { da: 'B', secondi: 120 });
  assert.equal(esito.tappe[1].da, 'D');
  assert.equal(esito.arrivo, 30600);
});

test('il cambio con il treno vuole più margine di uno tra bus', async () => {
  // Bus in arrivo a B alle 08:10 e coincidenza alle 08:12. Tra due bus due
  // minuti bastano; se la coincidenza è un treno servono banchina e scale,
  // quindi quel cambio non va proposto.
  const busBus = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],       // L1 A 08:00 → B 08:10
    [1, 0, 1, 29520, 1, 600]        // L2 B 08:12 → C 08:22
  ]));
  const esito = busBus.calcola('A', 'C', GIORNO, { maxCambi: 3 });
  assert.ok(esito);
  assert.deepEqual(esito.tappe.map((t) => t.linea), ['L1', 'L2']);

  const busTreno = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],       // L1 A 08:00 → B 08:10
    [2, 0, 1, 29520, 1, 600]        // T1 B 08:12 → C 08:22
  ]));
  assert.equal(busTreno.calcola('A', 'C', GIORNO, { maxCambi: 3 }), null);
});

test('i treni si chiamano REG o RV, mai con il nome GTFS', () => {
  assert.equal(TPERRouting.etichettaTreno('RV'), 'RV');
  assert.equal(TPERRouting.etichettaTreno('Regionale Veloce'), 'RV');
  assert.equal(TPERRouting.etichettaTreno('REG'), 'REG');
  // I suburbani S1A/S2A sono regionali a tutti gli effetti.
  assert.equal(TPERRouting.etichettaTreno('S2A'), 'REG');
  assert.equal(TPERRouting.etichettaTreno(null), 'REG');
});

test('vietando la linea diretta emerge un percorso alternativo', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 480, 1, 420],   // L1 A 08:00 → B 08:08 → C 08:15, diretto
    [1, 0, 0, 28800, 1, 300],       // L2 A 08:00 → B 08:05
    [2, 0, 1, 29400, 1, 600]        // T1 B 08:10 → C 08:20
  ]));

  const diretto = routing.calcola('A', 'C', GIORNO, { maxCambi: 3 });
  assert.deepEqual(diretto.tappe.map((t) => t.linea), ['L1']);
  assert.equal(diretto.arrivo, 29700);

  const alternativa = routing.calcola('A', 'C', GIORNO, { maxCambi: 3, vietate: ['L1'] });
  assert.ok(alternativa);
  // La linea T1 è un treno (tipo 2): in scheda si chiama REG, non col nome GTFS.
  assert.deepEqual(alternativa.tappe.map((t) => t.linea), ['L2', 'REG']);
  assert.equal(alternativa.cambi, 1);
  assert.equal(alternativa.arrivo, 30000);
});

test('cammino iniziale e finale vengono sommati al porta-a-porta', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],
    [1, 0, 1, 29700, 1, 600]
  ]));

  const esito = routing.calcola(
    [{ id: 'A', cammino: 120 }],
    [{ id: 'C', cammino: 300 }],
    new Date(2026, 10, 23, 7, 50, 0),
    { maxCambi: 3 }
  );
  assert.equal(esito.camminoIniziale, 120);
  assert.equal(esito.camminoFinale, 300);
  assert.equal(esito.partenza, 28800);
  assert.equal(esito.arrivo, 30300);
  assert.equal(esito.durata, 2100);
});

test('stessa fermata e assenza di corse', async () => {
  const routing = await caricaRouting(dati([[0, 0, 0, 28800, 1, 600]]));
  assert.deepEqual(routing.calcola('A', 'A', GIORNO), { errore: 'stessa-fermata' });
  assert.equal(routing.calcola('A', 'B', new Date(2026, 10, 23, 23, 0, 0)), null);
  assert.deepEqual(routing.calcola('Z', 'B', GIORNO), { errore: 'senza-orari' });
});

test('dopo mezzanotte usa la corsa serale del giorno precedente', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 88200, 1, 600]        // 24:30 → 24:40
  ]));

  const esito = routing.calcola('A', 'B', new Date(2026, 10, 24, 0, 10, 0), { maxCambi: 3 });
  assert.ok(esito);
  assert.equal(esito.richiesta, 87000);
  assert.equal(esito.partenza, 88200);
  assert.equal(esito.arrivo, 88800);
  assert.equal(esito.durata, 1800);
  assert.equal(esito.chiave, '20261123');
});

test('dopo mezzanotte sceglie la corsa che arriva prima, non quella del giorno dopo', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 1200, 1, 600],        // 00:20 → 00:30 (servizio di oggi)
    [0, 0, 0, 88200, 1, 600]        // 24:30 → 24:40 (servizio di ieri)
  ]));

  const esito = routing.calcola('A', 'B', new Date(2026, 10, 24, 0, 10, 0), { maxCambi: 3 });
  assert.ok(esito);
  assert.equal(esito.richiesta, 600);
  assert.equal(esito.partenza, 1200);
  assert.equal(esito.arrivo, 1800);
  assert.equal(esito.durata, 1200);
});

test('calendario: giorno attivo, domenica e eccezioni', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600]
  ], [[1, 20260101, 20261231]])); // solo lunedì

  assert.ok(routing.calcola('A', 'B', GIORNO, { maxCambi: 3 }));
  assert.equal(routing.calcola('A', 'B', DOMENICA, { maxCambi: 3 }), null);

  routing.impostaCammini([]);
  const conAggiunta = await caricaRouting({
    fermate: ['A', 'B'],
    linee: [['L1', 3]],
    servizi: [[1, 20260101, 20261231]],
    eccezioni: { '20261122': { a: [0], r: [] } },
    corse: [[0, 0, 0, 28800, 1, 600]]
  });
  assert.ok(conAggiunta.calcola('A', 'B', DOMENICA, { maxCambi: 3 }));

  const conRimozione = await caricaRouting({
    fermate: ['A', 'B'],
    linee: [['L1', 3]],
    servizi: [[1, 20260101, 20261231]],
    eccezioni: { '20261123': { a: [], r: [0] } },
    corse: [[0, 0, 0, 28800, 1, 600]]
  });
  assert.equal(conRimozione.calcola('A', 'B', GIORNO, { maxCambi: 3 }), null);
});

test('tratta taglia la geometria tra le fermate, in [lon, lat]', async () => {
  const tracciati = {
    forme: [polilinea([[44.5, 11.3], [44.51, 11.31], [44.52, 11.32]])],
    posizioni: [[0, 0, 1, 1, 2, 2]],
    corse: [0]
  };
  const routing = await caricaRouting({
    fermate: ['A', 'B', 'C'],
    linee: [['L1', 3]],
    servizi: TUTTI,
    eccezioni: {},
    corse: [[0, 0, 0, 28800, 1, 600, 1, 600]]
  }, tracciati);

  assert.deepEqual(routing.tratta(0, 'A', 'C', [0, 1, 2]), [
    [11.3, 44.5], [11.31, 44.51], [11.32, 44.52]
  ]);
  assert.deepEqual(routing.tratta(0, 'A', 'B', [0, 1]), [[11.3, 44.5], [11.31, 44.51]]);
  assert.deepEqual(routing.tratta(0, 'B', 'C', [1, 2]), [[11.31, 44.51], [11.32, 44.52]]);
  assert.deepEqual(routing.tratta(0, 'A', 'C'), [
    [11.3, 44.5], [11.31, 44.51], [11.32, 44.52]
  ]);
  assert.equal(routing.tratta(-1, 'A', 'C'), null);
  assert.equal(routing.tratta(1, 'A', 'C'), null);
});

test('fermate disponibili e disponibilità del motore', async () => {
  const routing = await caricaRouting(dati([]));
  assert.equal(routing.disponibile(), true);
  assert.deepEqual(routing.fermateDisponibili(), ['A', 'B', 'C', 'D', 'E']);
});
