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

test('un treno mostra “Tratta ferroviaria”, non “1 fermata”', () => {
  const html = render(viaggio());
  assert.match(html, /Tratta ferroviaria/);
  assert.doesNotMatch(html, /1 fermata/);
  assert.match(html, /16:34/);
  assert.match(html, /16:54/);
  assert.match(html, /RV/);
});

test('un bus continua a mostrare il numero di fermate', () => {
  const html = render(viaggio({}, corsa({ linea: '20', tipo: 3, fermate: 1 })));
  assert.match(html, /1 fermata/);
  assert.doesNotMatch(html, /Tratta ferroviaria/);
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

test('l’opzione compatta mostra in ordine i modi e i tratti a piedi', () => {
  const e = viaggio({
    camminoIniziale: 5 * 60,
    camminoFinale: 4 * 60,
    tappe: [corsa({ linea: '20', tipo: 3, fermate: 4 })]
  });
  const html = render(e);
  assert.match(html, /opzione-piedi/);
  assert.match(html, /opzione-linea/);
  assert.match(html, /A piedi 5 min/);
  assert.ok(html.indexOf('opzione-piedi') < html.indexOf('opzione-linea'));
  assert.ok(html.indexOf('opzione-linea') < html.lastIndexOf('opzione-piedi'));
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
  assert.match(senzaOrari, /GTFS aperto/);

  const nessuno = Vista.esito({ stato: 'nessuno', modo: 'partenza' }, (id) => id);
  assert.match(nessuno, /Nessun collegamento/);

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
