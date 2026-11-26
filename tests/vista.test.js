'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Vista = require('../vista-percorso');

function corsa(extra) {
  return Object.assign({
    linea: 'RV',
    tipo: 2,
    da: 'TRN001',
    a: 'TRN010',
    partenza: 16 * 3600 + 34 * 60,
    arrivo: 16 * 3600 + 54 * 60,
    fermate: 1,
    camminoPrima: null,
    attesa: 0
  }, extra);
}

function viaggio(extra, tappa) {
  return Object.assign({
    camminoIniziale: 0,
    camminoFinale: 0,
    partenza: 16 * 3600 + 34 * 60,
    arrivo: 16 * 3600 + 54 * 60,
    cambi: 0,
    tappe: [tappa || corsa()]
  }, extra);
}

function render(e) {
  return Vista.esito({
    stato: 'ok',
    esito: e,
    opzioni: [e],
    modo: 'partenza',
    aperto: 0
  }, (id) => id);
}

test('un treno mostra “Treno”, non “1 fermata”', () => {
  const html = render(viaggio());
  assert.match(html, /Treno · 20 min/);
  assert.doesNotMatch(html, /1 fermata/);
  assert.match(html, /16:34/);
  assert.match(html, /16:54/);
  assert.match(html, /RV/);
});

test('un bus continua a mostrare il numero di fermate', () => {
  const html = render(viaggio({}, corsa({ linea: '20', tipo: 3, fermate: 1 })));
  assert.match(html, /1 fermata/);
  assert.doesNotMatch(html, /Treno · /);
});

test('tempi a piedi e totale porta-a-porta', () => {
  const e = viaggio({
    camminoIniziale: 8 * 60,
    camminoFinale: 5 * 60,
    partenza: 8 * 3600 + 10 * 60,
    arrivo: 9 * 3600
  }, corsa({
    linea: '20',
    tipo: 3,
    partenza: 8 * 3600 + 10 * 60,
    arrivo: 9 * 3600,
    fermate: 3
  }));
  const html = render(e);
  assert.match(html, /A piedi <b>8 min<\/b>/);
  assert.match(html, /A piedi <b>5 min<\/b> fino a destinazione/);
  // Si esce di casa alle 08:02 (bus alle 08:10 meno 8 min) e si arriva alle 09:05.
  assert.match(html, /08:02/);
  assert.match(html, /09:05/);
  assert.match(html, /63 min/);
});

test('nomi e linee vengono sempre escapati', () => {
  const html = render(viaggio({}, corsa({ linea: '<script>', da: '<partenza>', a: '&arrivo' })));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;partenza&gt;/);
  assert.match(html, /&amp;arrivo/);
});

test('l’opzione compatta elenca le linee e i minuti a piedi una sola volta', () => {
  const e = viaggio({
    camminoIniziale: 5 * 60,
    camminoFinale: 4 * 60,
    tappe: [corsa({ linea: '20', tipo: 3, fermate: 4 })]
  });
  const html = render(e);
  const testa = html.slice(0, html.indexOf('opzione-corpo'));
  assert.match(testa, /opzione-linea[^>]*>20</);
  // I minuti a piedi stanno solo nel riepilogo, senza badge ripetuti.
  assert.match(testa, /9 min a piedi/);
  assert.doesNotMatch(testa, /opzione-piedi/);
  assert.equal(testa.match(/9 min a piedi/g).length, 1);
});

test('bus + treno restano distinti nella sequenza dei modi', () => {
  const e = viaggio({
    camminoIniziale: 2 * 60,
    camminoFinale: 3 * 60,
    tappe: [
      corsa({ linea: '27', tipo: 3, da: 'A', a: 'B', fermate: 5 }),
      corsa({ linea: 'REG', tipo: 2, da: 'B', a: 'C', camminoPrima: { da: 'B', secondi: 60 } })
    ]
  });
  const html = render(e);
  assert.match(html, /opzione-linea[^>]*>27</);
  assert.match(html, /opzione-linea treno[^>]*>REG</);
  assert.ok(html.indexOf('>27<') < html.indexOf('>REG<'));
});

test('orari oltre 24 ore vengono mostrati sul quadrante 00–23', () => {
  const html = render(viaggio({
    partenza: 88200,
    arrivo: 88800,
    tappe: [corsa({ partenza: 88200, arrivo: 88800 })]
  }));
  assert.match(html, /00:30/);
  assert.match(html, /00:40/);
});

test('messaggi per stazione senza orari, nessun viaggio e percorso a piedi', () => {
  const senzaOrari = Vista.esito({ stato: 'messaggio', esito: { errore: 'senza-orari' } }, (id) => id);
  assert.match(senzaOrari, /Nessuna fermata con orari entro 10 min a piedi/);

  const nessuno = Vista.esito({ stato: 'nessuno', modo: 'partenza' }, (id) => id);
  assert.match(nessuno, /Nessun viaggio a quest'ora/);

  const piedi = Vista.esito({ stato: 'piedi', piedi: { metri: 326, minuti: 6 } }, (id) => id);
  assert.match(piedi, /326 m/);
  assert.match(piedi, /6 min/);
});

test('controlli data e ora cambiano etichetta in modalità arrivo', () => {
  const partenza = Vista.controlli('2026-11-23', '08:00', 'partenza');
  assert.match(partenza, /Parti alle/);
  assert.match(partenza, /Adesso/);
  const arrivo = Vista.controlli('2026-11-23', '08:00', 'arrivo');
  assert.match(arrivo, /Arriva entro/);
  assert.match(arrivo, /Tra 1 ora/);
});

test('il percorso calcolato offre il pulsante per avviare la navigazione', () => {
  const html = render(viaggio());
  assert.match(html, /data-azione="avvia-navigazione"/);
  assert.match(html, /Avvia navigazione/);
  // Anche un tragitto tutto a piedi si può seguire sulla mappa.
  const piedi = Vista.esito({ stato: 'piedi', piedi: { metri: 326, minuti: 6 } }, (id) => id);
  assert.match(piedi, /data-azione="avvia-navigazione"/);
});

test('il percorso riserva un riquadro all’orario reale e dichiara i treni', () => {
  const html = render(viaggio());
  // Il riquadro nasce vuoto e nascosto: lo riempie l'app con il passaggio
  // reale del primo bus, quando TPER lo fornisce.
  assert.match(html, /id="live-percorso" hidden/);
  assert.match(html, /Orari programmati; il primo bus mostra il passaggio reale/);
});

test('gli arrivi uniscono tempo reale e orari programmati in un solo elenco', () => {
  const adesso = 8 * 60;   // 08:00
  const uniti = Vista.arriviUniti(
    [{ linea: '20', ora: '08:10', tipo: 'live', bus: '4412' }],
    [
      { linea: '19', ora: '08:32', destinazione: 'Casteldebole' },
      { linea: '20', ora: '08:10', destinazione: 'Normandia' },
      { linea: '23', ora: '08:50', destinazione: 'Normandia' }
    ],
    adesso
  );
  // Un solo elenco, in ordine di quanto manca: 10, 32, 50 minuti.
  assert.deepEqual(uniti.map((v) => v.linea + '@' + v.ora), ['20@08:10', '19@08:32', '23@08:50']);
  assert.deepEqual(uniti.map((v) => v.minuti), [10, 32, 50]);
  // La stessa corsa da due fonti resta una: vince quella con il bus reale,
  // e la direzione arriva comunque dal GTFS.
  assert.equal(uniti[0].tipo, 'live');
  assert.equal(uniti[0].bus, '4412');
  assert.equal(uniti[0].destinazione, 'Normandia');
  assert.equal(uniti[1].tipo, 'orario');
});

test('la variante della linea non duplica la corsa programmata', () => {
  // HelloBus dice 13A, il GTFS dice 13: è lo stesso bus, una riga sola.
  const uniti = Vista.arriviUniti(
    [{ linea: '13A', ora: '07:06', tipo: 'live', bus: '6114' }],
    [{ linea: '13', ora: '07:06', destinazione: 'Borgo Panigale' }],
    7 * 60
  );
  assert.equal(uniti.length, 1);
  assert.equal(uniti[0].tipo, 'live');
  assert.equal(uniti[0].destinazione, 'Borgo Panigale');
  assert.equal(Vista.chiaveLinea('T1'), 'T1');
});

test('gli arrivi scartano le corse già passate', () => {
  const elenco = Vista.arriviUniti([], [
    { linea: '20', ora: '07:55' },
    { linea: '20', ora: '08:05' }
  ], 8 * 60);
  assert.deepEqual(elenco.map((v) => v.ora), ['08:05']);
});

test('di default l’elenco tiene tutta la giornata, non solo le prossime ore', () => {
  const elenco = Vista.arriviUniti([], [
    { linea: '20', ora: '08:05' },
    { linea: '21', ora: '20:00' }
  ], 8 * 60);
  assert.deepEqual(elenco.map((v) => v.ora), ['08:05', '20:00']);
  // Con un tetto esplicito la corsa lontana si può escludere.
  assert.equal(Vista.arriviUniti([], [{ linea: '21', ora: '20:00' }], 8 * 60, { massimo: 360 }).length, 0);
});

test('i minuti degli arrivi reggono la mezzanotte', () => {
  assert.equal(Vista.minutiA('00:10', 23 * 60 + 50), 20);
  assert.equal(Vista.minutiA('23:50', 10), -20);
});

test('la scheda espone quanto si è disposti a camminare, da 3 a 25 minuti', () => {
  const html = Vista.controlli('2026-11-24', '08:00', 'partenza', 15);
  assert.match(html, /id="input-camminata"/);
  assert.match(html, /type="range"/);
  assert.match(html, /min="3"/);
  assert.match(html, /max="25"/);
  assert.match(html, /value="15"/);
  assert.match(html, /15 min/);

  // Fuori scala si riporta nei limiti consentiti.
  assert.match(Vista.controlli('2026-11-24', '08:00', 'partenza', 99), /value="25"/);
  assert.match(Vista.controlli('2026-11-24', '08:00', 'partenza', 1), /value="3"/);
  assert.match(Vista.controlli('2026-11-24', '08:00', 'partenza', undefined), /value="10"/);
});
