const test = require('node:test');
const assert = require('node:assert');
const Linee = require('../linee');

// Corse compatte come in data/orari.json: [linea, servizio, fermata, ora, …].
const orari = {
  fermate: ['A', 'B', 'C', 'D'],
  linee: [['20', 3]],
  servizi: [[127, 20260101, 20261231]],
  corse: [
    [0, 0, 0, 36000, 1, 300, 1, 300],   // A 10:00 → B 10:05 → C 10:10
    [0, 0, 0, 37800, 1, 300, 1, 300],   // A 10:30 → B 10:35 → C 10:40
    [0, 0, 2, 39600, -1, 300, -1, 300]  // C 11:00 → B 11:05 → A 11:10
  ]
};

test('l\'indice raggruppa le corse per linea e per sequenza', () => {
  const indice = Linee.indice(orari);
  assert.equal(indice.size, 1);
  const linea = Linee.lineaDi(indice, '20');
  assert.equal(linea.nome, '20');
  assert.equal(linea.tipo, 3);
  assert.equal(linea.gruppi.size, 2);
});

test('la ricerca accetta il numero, «linea 20» e i prefissi', () => {
  const indice = Linee.indice(orari);
  assert.equal(Linee.cerca(indice, '20').length, 1);
  assert.equal(Linee.cerca(indice, 'linea 20').length, 1);
  assert.equal(Linee.cerca(indice, 'linea').length, 0);
  assert.equal(Linee.cerca(indice, '99').length, 0);
  assert.equal(Linee.cerca(indice, '').length, 0);
});

test('i versi sono i capolinea, con le fermate nel verso giusto', () => {
  const linea = Linee.lineaDi(Linee.indice(orari), '20');
  const versi = Linee.versi(linea).map((v) => v.capolinea).sort();
  assert.deepEqual(versi, ['A', 'C']);
  assert.deepEqual(Linee.fermateVerso(linea, 'C'), ['A', 'B', 'C']);
  assert.deepEqual(Linee.fermateVerso(linea, 'A'), ['C', 'B', 'A']);
});

test('la direzione scelta funziona anche con capolinea numerici', () => {
  // La tendina restituisce una stringa, i gruppi del GTFS usano numeri.
  const linea = {
    gruppi: new Map([
      [3056, { capolinea: 3056, fermate: ['A', 'B'], corse: [], offsets: [0, 300] }],
      [455, { capolinea: 455, fermate: ['X', 'Y'], corse: [], offsets: [0, 300] }]
    ])
  };
  assert.deepEqual(Linee.fermateVerso(linea, '455'), ['X', 'Y']);
  assert.deepEqual(Linee.fermateVerso(linea, 455), ['X', 'Y']);
  assert.equal(Linee.gruppoPrincipale(linea, '455').capolinea, 455);
});

test('le partenze rispettano il servizio attivo e scartano l\'ultima fermata', () => {
  const linea = Linee.lineaDi(Linee.indice(orari), '20');
  const oggi = Linee.partenze(linea, 'C', [0], 0);
  assert.deepEqual(oggi.map((p) => p.secondi), [36000, 37800]);
  assert.deepEqual(Linee.partenze(linea, 'C', [1], 0), []);
  // Alla fermata B la corsa passa, non parte: resta valida, ma all'ultima no.
  assert.deepEqual(Linee.partenze(linea, 'C', [0], 2), []);
});

test('l\'ultima corsa è quella che parte più tardi, anche da una fermata', () => {
  const linea = Linee.lineaDi(Linee.indice(orari), '20');
  assert.equal(Linee.ultima(linea, 'C', [0]).secondi, 37800);
  assert.equal(Linee.ultima(linea, 'A', [0]).secondi, 39600);
  assert.equal(Linee.ultimaAllaFermata(linea, 'C', 'B', [0]).secondi, 38100);
  assert.equal(Linee.ultimaAllaFermata(linea, 'C', 'C', [0]), null);
});

test('l\'indice regge orari vuoti o incompleti', () => {
  assert.equal(Linee.cerca(Linee.indice(null), '20').length, 0);
  assert.deepEqual(Linee.versi(null), []);
  assert.deepEqual(Linee.fermateVerso(null, 'C'), []);
  assert.deepEqual(Linee.partenze(null, 'C', null, 0), []);
  assert.equal(Linee.ultima(null, 'C', null), null);
});

test('i tragitti di una fermata sono uno per linea e per capolinea', () => {
  const indice = Linee.indice(orari);
  const tragitti = Linee.tragittiAllaFermata(indice, 'B');
  assert.equal(tragitti.length, 2);
  assert.deepEqual(tragitti.map((t) => t.capolinea).sort(), ['A', 'C']);
  // Ogni verso porta la corsa del gruppo più frequente, non una variante.
  tragitti.forEach((t) => assert.equal(typeof t.corsa, 'number'));
  // Una fermata che non esiste non inventa linee.
  assert.deepEqual(Linee.tragittiAllaFermata(indice, 'Z'), []);
  assert.deepEqual(Linee.tragittiAllaFermata(indice, 'B', 1).length, 1);
});
