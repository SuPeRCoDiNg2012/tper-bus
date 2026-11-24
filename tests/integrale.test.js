'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { caricaRouting } = require('./helpers');

const cartella = path.join(__dirname, '..', 'data');
const orari = JSON.parse(fs.readFileSync(path.join(cartella, 'orari.json'), 'utf8'));
const tracciati = JSON.parse(fs.readFileSync(path.join(cartella, 'tracciati.json'), 'utf8'));

test('rete reale: Bologna C.le → Imola in treno con geometria', async () => {
  const routing = await caricaRouting(orari, tracciati);
  const esito = routing.calcola('TRN001', 'TRN010', new Date(2026, 10, 23, 16, 20, 0), { maxCambi: 3 });

  assert.ok(esito, 'nessun percorso ferroviario trovato');
  assert.equal(esito.cambi, 0);
  assert.equal(esito.tappe.length, 1);
  const tappa = esito.tappe[0];
  assert.equal(tappa.tipo, 2);
  assert.equal(tappa.linea, 'RV');
  assert.equal(tappa.da, 'TRN001');
  assert.equal(tappa.a, 'TRN010');
  assert.equal(tappa.partenza, 16 * 3600 + 34 * 60);
  assert.equal(tappa.arrivo, 16 * 3600 + 54 * 60);

  const punti = routing.tratta(tappa.forma, tappa.da, tappa.a, tappa.sequenza);
  assert.ok(Array.isArray(punti) && punti.length > 2, 'geometria ferroviaria assente');
  assert.ok(punti.every((p) => Array.isArray(p) && p.length === 2 && p[0] > 9 && p[0] < 13));
});

test('rete reale: Bologna C.le → Vignola in treno S2A', async () => {
  const routing = await caricaRouting(orari, tracciati);
  const feriale = routing.calcola('TRN001', 'TRN009', new Date(2026, 10, 23, 8, 0, 0), { maxCambi: 0 });

  assert.ok(feriale, 'nessun percorso S2A feriale');
  assert.equal(feriale.cambi, 0);
  assert.equal(feriale.tappe.length, 1);
  // La linea S2A è un regionale: in scheda prende l'etichetta REG.
  assert.equal(feriale.tappe[0].linea, 'REG');
  assert.equal(feriale.tappe[0].da, 'TRN001');
  assert.equal(feriale.tappe[0].a, 'TRN009');
  assert.equal(feriale.tappe[0].partenza, 8 * 3600 + 32 * 60);
  assert.equal(feriale.tappe[0].arrivo, 9 * 3600 + 28 * 60);
  assert.equal(feriale.tappe[0].stops.length, 18, 'fermate intermedie S2A mancanti');

  const festivo = routing.calcola('TRN001', 'TRN009', new Date(2026, 10, 22, 9, 0, 0), { maxCambi: 0 });
  assert.ok(festivo, 'nessun percorso S2A festivo');
  assert.equal(festivo.tappe[0].linea, 'REG');
  assert.equal(festivo.tappe[0].partenza, 9 * 3600 + 32 * 60);

  const punti = routing.tratta(
    feriale.tappe[0].forma,
    feriale.tappe[0].da,
    feriale.tappe[0].a,
    feriale.tappe[0].sequenza
  );
  assert.ok(Array.isArray(punti) && punti.length > 2, 'geometria S2A assente');
  assert.ok(punti.every((p) => Array.isArray(p) && p.length === 2 && p[0] > 9 && p[0] < 13));
});

test('rete reale: Bologna C.le → Vignola usa il servizio festivo l’8 dicembre', async () => {
  const routing = await caricaRouting(orari, tracciati);
  const esito = routing.calcola('TRN001', 'TRN009', new Date(2026, 11, 8, 8, 0, 0), { maxCambi: 0 });

  assert.ok(esito, 'nessun percorso S2A nell’8 dicembre');
  assert.equal(esito.tappe[0].linea, 'REG');
  assert.equal(esito.tappe[0].partenza, 9 * 3600 + 32 * 60, 'l’8 dicembre non usa l’orario festivo');
});

test('rete reale: Bologna C.le → Musiano usa tutte le fermate del ramo Pianoro', async () => {
  const routing = await caricaRouting(orari, tracciati);
  const esito = routing.calcola('TRN001', 'TRN042', new Date(2026, 10, 23, 8, 0, 0), { maxCambi: 3 });

  assert.ok(esito, 'nessun percorso per il ramo Pianoro');
  assert.equal(esito.cambi, 0);
  assert.equal(esito.tappe.length, 1);
  assert.deepEqual(esito.tappe[0].stops, [
    'TRN001', 'TRN038', 'TRN039', 'TRN040', 'TRN041', 'TRN042'
  ]);
  assert.equal(esito.tappe[0].linea, 'REG');
  const punti = routing.tratta(esito.tappe[0].forma, esito.tappe[0].da, esito.tappe[0].a, esito.tappe[0].sequenza);
  assert.ok(Array.isArray(punti) && punti.length >= 7, 'geometria del ramo Pianoro assente');
});
