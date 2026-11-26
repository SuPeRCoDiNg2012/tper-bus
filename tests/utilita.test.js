const test = require('node:test');
const assert = require('node:assert');
const Utilita = require('../utilita');

test('le durate sopra l\'ora passano a ore e minuti', () => {
  assert.equal(Utilita.durata(0), '0 min');
  assert.equal(Utilita.durata(59), '59 min');
  assert.equal(Utilita.durata(60), '1h');
  assert.equal(Utilita.durata(95), '1h e 35min');
  assert.equal(Utilita.durata(120), '2h');
  assert.equal(Utilita.durata(155), '2h e 35min');
});

test('il contrasto segue la formula WCAG', () => {
  assert.equal(Math.round(Utilita.contrasto('#FFFFFF', '#000000')), 21);
  assert.equal(Math.round(Utilita.contrasto('#FFFFFF', '#FFFFFF')), 1);
  assert.equal(Utilita.contrasto('non-un-colore', '#FFFFFF'), null);
});

test('un ritardo simulato fa perdere il cambio e indica il punto da cui ripartire', () => {
  const tappe = [
    { linea: 'A', da: '452', partenza: 10 * 3600 + 25 * 60, arrivo: 10 * 3600 + 34 * 60 },
    { linea: '96', da: '800', partenza: 10 * 3600 + 45 * 60, arrivo: 11 * 3600 + 6 * 60 }
  ];
  // Il bus A arriva 12 minuti dopo: il margine di 11 minuti non basta più.
  const perso = Utilita.analizzaRitardi(tappe, [12 * 60, 0]);
  assert.equal(perso.cambioPerso, true);
  assert.equal(perso.lineaPersa, '96');
  assert.equal(perso.cambioDa, '800');
  assert.equal(perso.noti, 2);

  // Con 10 minuti di ritardo il cambio è solo a rischio.
  const rischio = Utilita.analizzaRitardi(tappe, [10 * 60, 0]);
  assert.equal(rischio.cambioPerso, false);
  assert.equal(rischio.cambioRischioso, true);
});

test('dopo un cambio perso si riparte da posizione, cambio, poi partenza', () => {
  const posizione = { lat: 44.49, lon: 11.34 };
  const cambio = { id: '1003', nome: 'Porta Maggiore' };
  assert.equal(Utilita.scegliOrigineRitardo(posizione, cambio).tipo, 'posizione');
  assert.equal(Utilita.scegliOrigineRitardo(null, cambio).tipo, 'cambio');
  assert.equal(Utilita.scegliOrigineRitardo(null, null).tipo, 'partenza');
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

test('le coordinate condivise si leggono dai link più comuni', () => {
  assert.deepEqual(Utilita.coordinateCondivise('https://maps.google.com/?q=44.4949,11.3426'), { lat: 44.4949, lon: 11.3426 });
  assert.deepEqual(Utilita.coordinateCondivise('https://www.google.com/maps/@44.4949,11.3426,15z'), { lat: 44.4949, lon: 11.3426 });
  assert.deepEqual(Utilita.coordinateCondivise('https://maps.apple.com/?ll=44.4949,11.3426'), { lat: 44.4949, lon: 11.3426 });
  assert.deepEqual(Utilita.coordinateCondivise('geo:44.4949,11.3426'), { lat: 44.4949, lon: 11.3426 });
  assert.deepEqual(Utilita.coordinateCondivise('https://www.openstreetmap.org/?mlat=44.4949&mlon=11.3426#map=16'), { lat: 44.4949, lon: 11.3426 });
});

test('una condivisione senza coordinate resta testo, non un punto inventato', () => {
  assert.equal(Utilita.coordinateCondivise('Piazza Maggiore, Bologna'), null);
  assert.equal(Utilita.coordinateCondivise('https://example.com/evento'), null);
  assert.equal(Utilita.coordinateCondivise(''), null);
  assert.equal(Utilita.testoCondiviso('Piazza Maggiore https://maps.google.com/?q=44.49,11.34'), 'Piazza Maggiore');
});

test('semplifica toglie i vertici sulla retta e tiene gli estremi', () => {
  const linea = [[0, 0], [0.0001, 0], [0.0002, 0], [0.0003, 0]];
  const out = Utilita.semplifica(linea, 0.00008);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[1], [0.0003, 0]);
});

test('semplifica tiene i vertici che deviano oltre la tolleranza', () => {
  const linea = [[0, 0], [0.0001, 0.001], [0.0002, 0]];
  assert.equal(Utilita.semplifica(linea, 0.00008).length, 3);
  // Con una tolleranza più larga sparisce anche la curva.
  assert.equal(Utilita.semplifica(linea, 0.01).length, 2);
});

test('semplifica regge linee vuote, corte o degenerate', () => {
  assert.deepEqual(Utilita.semplifica([], 0.0001), []);
  assert.deepEqual(Utilita.semplifica([[1, 2]], 0.0001), [[1, 2]]);
  assert.equal(Utilita.semplifica([[0, 0], [1, 1]], 0.0001).length, 2);
  // Tre punti identici non fanno dividere per zero.
  assert.deepEqual(Utilita.semplifica([[0, 0], [0, 0], [0, 0]], 0.0001), [[0, 0], [0, 0]]);
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

test('raggruppa tiene insieme le fermate vicine e separa quelle lontane', () => {
  // Tre fermate entro un paio di chilometri: una sola area.
  const vicine = Utilita.raggruppa([[11.34, 44.49], [11.35, 44.50], [11.36, 44.50]], 3500);
  assert.equal(vicine.length, 1);
  assert.equal(vicine[0].length, 3);
  // Una fermata a 80 km non appartiene alla stessa zona.
  const lontane = Utilita.raggruppa([[11.34, 44.49], [11.35, 44.50], [12.50, 44.80]], 3500);
  assert.equal(lontane.length, 2);
  assert.deepEqual(lontane.map((g) => g.length).sort(), [1, 2]);
});

test('raggruppa lavora a catena e regge elenchi vuoti o sporchi', () => {
  // Il primo e l'ultimo distano più del raggio, ma il punto in mezzo li unisce.
  const catena = Utilita.raggruppa([[11.30, 44.5], [11.32, 44.5], [11.34, 44.5]], 2000);
  assert.equal(catena.length, 1);
  assert.deepEqual(Utilita.raggruppa([], 3500), []);
  assert.deepEqual(Utilita.raggruppa(null, 3500), []);
  // Coordinate non valide: si scartano, non fanno saltare il disegno.
  assert.equal(Utilita.raggruppa([[11.34, 44.49], ['x', 1]], 3500).length, 1);
});

test('il centroide è la media dei punti validi', () => {
  assert.deepEqual(Utilita.centroide([[0, 0], [2, 0], [1, 3]]), [1, 1]);
  assert.deepEqual(Utilita.centroide([[1, 2], ['x', 3]]), [1, 2]);
  assert.equal(Utilita.centroide([]), null);
});

test('l\'involucro tiene solo i vertici esterni e scarta quelli interni', () => {
  const anello = Utilita.involucro([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.8]]);
  assert.equal(anello.length, 4);
  assert.deepEqual(anello.map((p) => p.join(',')).sort(), ['0,0', '0,1', '1,0', '1,1']);
  // Punti allineati o doppioni: non è un\'area.
  assert.equal(Utilita.involucro([[0, 0], [1, 1], [2, 2]]).length, 2);
  assert.equal(Utilita.involucro([[5, 5], [5, 5], [5, 5]]).length, 1);
  assert.deepEqual(Utilita.involucro([]), []);
  assert.deepEqual(Utilita.involucro(null), []);
  // Coordinate sporche: si scartano, non fanno saltare il disegno.
  assert.equal(Utilita.involucro([[0, 0], ['x', 2], [1, 0], [1, 1]]).length, 3);
});
