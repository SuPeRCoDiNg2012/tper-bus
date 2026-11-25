const test = require('node:test');
const assert = require('node:assert');
const Utilita = require('../utilita');

test('il contrasto segue la formula WCAG', () => {
  assert.equal(Math.round(Utilita.contrasto('#FFFFFF', '#000000')), 21);
  assert.equal(Math.round(Utilita.contrasto('#FFFFFF', '#FFFFFF')), 1);
  assert.equal(Utilita.contrasto('non-un-colore', '#FFFFFF'), null);
});

test('il testo del badge resta leggibile su ogni colore di linea', () => {
  // Giallo chiaro: bianco sarebbe illeggibile, serve il nero.
  assert.equal(Utilita.testoSuColore('#FFD400'), '#1A1A1A');
  // Blu scuro: il bianco è l'unica scelta sensata.
  assert.equal(Utilita.testoSuColore('#0B3D91'), '#FFFFFF');
  // Colore mancante: si tiene quello del GTFS.
  assert.equal(Utilita.testoSuColore('', '#FFFFFF'), '#FFFFFF');
});

test('ogni scelta di testo su colore supera 4.5:1', () => {
  ['#C1121F', '#FFD400', '#7BC96F', '#0B3D91', '#8E44AD', '#E67E22', '#95A5A6'].forEach((colore) => {
    const testo = Utilita.testoSuColore(colore);
    assert.ok(Utilita.contrasto(colore, testo) >= 4.5, colore + ' con ' + testo);
  });
});

test('la cache si svuota solo oltre la soglia', () => {
  const misure = { tperzc_piedi_v4: 100, tperzc_recenti_v2: 50 };
  assert.deepEqual(Utilita.cacheDaSvuotare(misure, 1000), []);
  assert.deepEqual(Utilita.cacheDaSvuotare(misure, 120), ['tperzc_piedi_v4']);
});

test('la pulizia non tocca i dati scritti dall\'utente', () => {
  const svuotate = Utilita.cacheDaSvuotare({ tperzc_piedi_v4: 1, tperzc_recenti_v2: 9000 }, 100);
  assert.deepEqual(svuotate, ['tperzc_piedi_v4']);
  assert.equal(svuotate.indexOf('tperzc_recenti_v2'), -1);
});

test('la pulizia si ferma appena basta', () => {
  const misure = { tperzc_snap_v4: 300, tperzc_piedi_v4: 300, tperzc_storico_ritardi_v2: 300 };
  assert.deepEqual(Utilita.cacheDaSvuotare(misure, 700), ['tperzc_snap_v4']);
  assert.deepEqual(Utilita.cacheDaSvuotare(misure, 100), [
    'tperzc_snap_v4', 'tperzc_piedi_v4', 'tperzc_storico_ritardi_v2'
  ]);
});

test('l\'invito all\'installazione compare al terzo uso e una volta sola', () => {
  assert.equal(Utilita.deveMostrareInvito(2, false, false), false);
  assert.equal(Utilita.deveMostrareInvito(3, false, false), true);
  assert.equal(Utilita.deveMostrareInvito(9, true, false), false);
  assert.equal(Utilita.deveMostrareInvito(9, false, true), false);
});

test('i timeout sono diversi per tipo di chiamata', () => {
  assert.equal(Utilita.timeoutPer('fermate'), 10000);
  assert.equal(Utilita.timeoutPer('orari'), 15000);
  assert.equal(Utilita.timeoutPer('nominatim'), 5000);
  assert.equal(Utilita.timeoutPer('osrm'), 8000);
  assert.equal(Utilita.timeoutPer('hellobus'), 9000);
  // Tipo sconosciuto: si ricade sui dati statici, non su zero.
  assert.equal(Utilita.timeoutPer('boh'), 10000);
});
