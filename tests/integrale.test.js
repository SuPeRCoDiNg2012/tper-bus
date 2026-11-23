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
