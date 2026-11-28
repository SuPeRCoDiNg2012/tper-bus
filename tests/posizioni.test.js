const test = require('node:test');
const assert = require('node:assert');
const Posizioni = require('../posizioni.js');

// Tracciato dritto verso est: 0.00 → 0.10 gradi di longitudine, 3 vertici.
const PUNTI = [
  [44.5, 11.3],
  [44.5, 11.35],
  [44.5, 11.4]
];

function quasi(uguale, atteso, tolleranza) {
  assert.ok(Math.abs(uguale - atteso) <= (tolleranza || 1e-6),
    uguale + ' non è vicino a ' + atteso);
}

test('la posizione segue il tracciato a metà del tempo tra due fermate', () => {
  const punto = Posizioni.stimaPosizione({
    punti: PUNTI,
    posizioni: [10, 0, 11, 1, 12, 2],
    fermate: [10, 11, 12],
    orari: [0, 600, 1200],
    istante: 600
  });
  assert.ok(punto);
  quasi(punto.lat, 44.5);
  quasi(punto.lon, 11.35);
});

test('un quarto del tempo è un quarto dello spazio sul primo tratto', () => {
  const punto = Posizioni.stimaPosizione({
    punti: PUNTI,
    posizioni: [10, 0, 11, 1, 12, 2],
    fermate: [10, 11, 12],
    orari: [0, 600, 1200],
    istante: 150
  });
  assert.ok(punto);
  quasi(punto.lon, 11.3 + 0.05 * 0.25, 1e-4);
});

test('nel secondo tratto la posizione riparte dal vertice giusto', () => {
  const punto = Posizioni.stimaPosizione({
    punti: PUNTI,
    posizioni: [10, 0, 11, 1, 12, 2],
    fermate: [10, 11, 12],
    orari: [0, 600, 1200],
    istante: 900
  });
  assert.ok(punto);
  quasi(punto.lon, 11.375, 1e-4);
});

test('prima della partenza e dopo l\'ultima fermata non c\'è nessun bus', () => {
  const base = {
    punti: PUNTI,
    posizioni: [10, 0, 11, 1, 12, 2],
    fermate: [10, 11, 12],
    orari: [0, 600, 1200]
  };
  assert.equal(Posizioni.stimaPosizione(Object.assign({}, base, { istante: 0 })), null);
  assert.equal(Posizioni.stimaPosizione(Object.assign({}, base, { istante: 1200 })), null);
  assert.equal(Posizioni.stimaPosizione(Object.assign({}, base, { istante: 1300 })), null);
});

test('senza tabella fermata→vertice la stima si ferma invece di indovinare', () => {
  const punto = Posizioni.stimaPosizione({
    punti: PUNTI,
    posizioni: null,
    fermate: [10, 11, 12],
    orari: [0, 600, 1200],
    istante: 300
  });
  assert.equal(punto, null);
});

test('la tabella resta monotona sulle linee ad anello', () => {
  // La fermata 11 compare due volte sul tracciato: la corsa passa dalla prima
  // occorrenza, non salta alla seconda che sta più avanti.
  const tabella = Posizioni.vertici([10, 0, 11, 1, 11, 5, 12, 6], [10, 11, 12]);
  assert.deepEqual(tabella, [0, 1, 6]);
});

test('una corsa con fermate ripetute usa il vertice successivo, non quello dietro', () => {
  const tabella = Posizioni.vertici([10, 0, 10, 8, 11, 9], [10, 10, 11]);
  assert.deepEqual(tabella, [0, 8, 9]);
});

test('la distanza tra due punti vicini è in metri, non in gradi', () => {
  const metri = Posizioni.distanzaMetri([44.5, 11.3], [44.5, 11.31]);
  assert.ok(metri > 700 && metri < 900, 'distanza inattesa: ' + metri);
});
