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

test('la soglia a piedi limita i cambi a piedi', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],       // A → B
    [2, 0, 3, 30000, 1, 600]        // D → E
  ]));
  routing.impostaCammini([['B', 'D', 120]]);

  // Con 2 minuti concessi il cambio a piedi è possibile.
  assert.ok(routing.calcola('A', 'E', GIORNO, { maxCambi: 1, camminoMax: 120 }));
  // Con 3 minuti di soglia… anche; con 1 minuto no.
  assert.equal(routing.calcola('A', 'E', GIORNO, { maxCambi: 1, camminoMax: 60 }), null);
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

/* ------------------------------------------------------------------ *
 * Criteri "veloce" e "ottimizzato"
 * ------------------------------------------------------------------ */

function tappaFinta(linea, partenza, arrivo, fermate, attesa) {
  return { linea: linea, partenza: partenza, arrivo: arrivo, fermate: fermate, attesa: attesa };
}

// Esito minimo con i soli campi che il punteggio usa: il pool dei test è
// costruito a mano, così i numeri sono leggibili e non dipendono dal dataset.
function esitoFinto(tappe, extra) {
  const base = extra || {};
  const esito = {
    richiesta: base.richiesta != null ? base.richiesta : 0,
    partenza: tappe[0].partenza,
    arrivo: tappe[tappe.length - 1].arrivo,
    camminoIniziale: base.camminoIniziale || 0,
    camminoFinale: base.camminoFinale || 0,
    cambi: tappe.length - 1,
    tappe: tappe
  };
  return esito;
}

test('veloce restituisce sempre l\'arrivo minore', () => {
  const routing = require('../routing');
  const veloce = esitoFinto([
    tappaFinta('20', 600, 1200, 6, 600),
    tappaFinta('25', 1500, 2100, 4, 300)
  ]);
  const lento = esitoFinto([tappaFinta('27', 600, 3000, 8, 600)]);

  assert.equal(routing.valuta([lento, veloce], 'veloce'), veloce);
  assert.equal(routing.confronta([lento, veloce]).veloce, veloce);
  assert.equal(veloce.punteggio.tempoTotale, 2100);
  assert.equal(veloce.punteggio.numeroCambi, 1);
});

test('ottimizzato riduce i cambi a parità di tempi ragionevoli', () => {
  const routing = require('../routing');
  // Veloce: 2000 s con due cambi. Ottimizzato: 2200 s (+10%) con un cambio.
  const dueCambi = esitoFinto([
    tappaFinta('20', 600, 1100, 4, 300),
    tappaFinta('25', 1200, 1700, 4, 600),
    tappaFinta('27', 1800, 2000, 4, 600)
  ]);
  const unCambio = esitoFinto([
    tappaFinta('20', 600, 1100, 6, 300),
    tappaFinta('27', 1200, 2200, 6, 60 + 600)
  ]);

  assert.equal(routing.valuta([dueCambi, unCambio], 'veloce'), dueCambi);
  assert.equal(routing.valuta([dueCambi, unCambio], 'ottimizzato'), unCambio);
});

test('ottimizzato scarta la soluzione oltre il +15%', () => {
  const routing = require('../routing');
  const veloce = esitoFinto([
    tappaFinta('20', 600, 1100, 4, 300),
    tappaFinta('25', 1200, 2000, 4, 600)
  ]);
  // 2500 s = +25%: comoda (zero cambi) ma fuori soglia.
  const comoda = esitoFinto([tappaFinta('27', 600, 2500, 12, 60 + 600)]);

  assert.equal(routing.valuta([veloce, comoda], 'ottimizzato'), veloce);
});

test('cambi uguali: a parità di attrito vince il tempo minore', () => {
  const routing = require('../routing');
  const prima = esitoFinto([
    tappaFinta('20', 600, 1100, 5, 300),
    tappaFinta('27', 1200, 2000, 5, 600)
  ]);
  const dopo = esitoFinto([
    tappaFinta('20', 600, 1100, 5, 300),
    tappaFinta('27', 1200, 2100, 5, 600)
  ]);

  assert.equal(routing.valuta([dopo, prima], 'ottimizzato'), prima);
});

test('la penalità del cambio corto batte il cambio in meno', () => {
  const routing = require('../routing');
  // Due cambi, tutti con attese tranquille (150 s: sopra la soglia di rischio).
  const sicuro = esitoFinto([
    tappaFinta('20', 600, 1100, 4, 150),
    tappaFinta('25', 1250, 1750, 4, 150),
    tappaFinta('27', 1900, 2100, 4, 150)
  ]);
  // Un cambio solo, ma con 60 s di coincidenza (rischio connessione).
  const rischioso = esitoFinto([
    tappaFinta('20', 600, 1100, 4, 300),
    tappaFinta('27', 1400, 2100, 4, 60)
  ]);

  assert.equal(routing.valuta([sicuro, rischioso], 'veloce'), sicuro);
  assert.equal(routing.valuta([sicuro, rischioso], 'ottimizzato'), sicuro);
  assert.equal(rischioso.punteggio.cambioRischioso, true);
  assert.equal(sicuro.punteggio.cambioRischioso, false);
});

test('calcolaConfronto è coerente con calcola per lo stesso criterio', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],       // L1 A 08:00 → B 08:10
    [1, 0, 1, 29700, 1, 600]        // L2 B 08:15 → C 08:25
  ]));

  const veloce = routing.calcola('A', 'C', GIORNO, { maxCambi: 3, criterio: 'veloce' });
  const ottimizzato = routing.calcola('A', 'C', GIORNO, { maxCambi: 3, criterio: 'ottimizzato' });
  const confronto = routing.calcolaConfronto('A', 'C', GIORNO, { maxCambi: 3 });

  assert.ok(veloce.punteggio);
  assert.ok(ottimizzato.punteggio);
  assert.equal(confronto.veloce.arrivo, veloce.arrivo);
  assert.equal(confronto.ottimizzato.arrivo, ottimizzato.arrivo);
  assert.equal(confronto.veloce.punteggio.costoVeloce, veloce.punteggio.costoVeloce);
  assert.equal(confronto.ottimizzato.punteggio.costoOttimizzato, ottimizzato.punteggio.costoOttimizzato);
  assert.ok(Array.isArray(confronto.alternative));
  assert.ok(confronto.alternative.length >= 1);
});

test('il criterio assente vale veloce (retrocompatibilità)', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600],
    [1, 0, 1, 29700, 1, 600]
  ]));
  const senzaCriterio = routing.calcola('A', 'C', GIORNO, { maxCambi: 3 });
  const esplicito = routing.calcola('A', 'C', GIORNO, { maxCambi: 3, criterio: 'veloce' });
  assert.equal(senzaCriterio.arrivo, esplicito.arrivo);
  assert.equal(senzaCriterio.punteggio.costoVeloce, esplicito.punteggio.costoVeloce);
});

test('partenzeFermata elenca tutte le corse del giorno, senza i capolinea', async () => {
  const routing = await caricaRouting(dati([
    [0, 0, 0, 28800, 1, 600, 1, 600],   // L1 A 08:00 → B → C 08:20
    [0, 0, 0, 32400, 1, 600, 1, 600],   // L1 A 09:00 → B → C 09:20
    [1, 0, 1, 29100, 1, 300]            // L2 B 08:05 → C
  ]));

  const partenze = routing.partenzeFermata('A', GIORNO);
  assert.deepEqual(partenze.map((p) => p.orario), [28800, 32400]);
  assert.deepEqual(partenze.map((p) => p.linea), ['L1', 'L1']);
  assert.equal(partenze[0].capolinea, 'C');
  // A C il bus arriva e non riparte: non è una partenza.
  assert.deepEqual(routing.partenzeFermata('C', GIORNO), []);
  // A B compaiono anche le corse che proseguono verso C, in ordine di orario.
  const aB = routing.partenzeFermata('B', GIORNO);
  assert.deepEqual(aB.map((p) => p.linea), ['L2', 'L1', 'L1']);
  assert.deepEqual(aB.map((p) => p.orario), [29100, 29400, 33000]);
  assert.deepEqual(routing.partenzeFermata('Z', GIORNO), []);
});
