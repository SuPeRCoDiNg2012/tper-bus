'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cartella = path.join(__dirname, '..', 'data');
const leggi = (nome) => JSON.parse(fs.readFileSync(path.join(cartella, nome), 'utf8'));

const orari = leggi('orari.json');
const tracciati = leggi('tracciati.json');
const fermate = leggi('fermate.json');
const lineePerFermata = leggi('linee-per-fermata.json');

test('fermate: id unici, coordinate e tipi validi', () => {
  const ids = new Set();
  fermate.fermate.forEach((f) => {
    assert.ok(f.id, 'fermata senza id');
    assert.equal(ids.has(f.id), false, 'id duplicato: ' + f.id);
    ids.add(f.id);
    assert.ok(f.lat >= 43.5 && f.lat <= 45.2, 'latitudine fuori regione: ' + f.id);
    assert.ok(f.lon >= 9.5 && f.lon <= 12.5, 'longitudine fuori regione: ' + f.id);
    assert.ok(['bus', 'treno', 'entrambi'].includes(f.tipo), 'tipo non valido: ' + f.id);
    assert.match(String(f.zona), /^\d{3}$/, 'zona non valida: ' + f.id);
  });
  assert.ok(ids.size > 6000);
  assert.ok(ids.has('TRN001') && ids.has('TRN010') && ids.has('TRN011'));
});

test('orari: fermate, linee e servizi coerenti', () => {
  const ids = new Set(fermate.fermate.map((f) => f.id));
  const idOrari = new Set();
  orari.fermate.forEach((id) => {
    assert.ok(ids.has(id), 'fermata degli orari assente da fermate.json: ' + id);
    assert.equal(idOrari.has(id), false, 'fermata duplicata negli orari: ' + id);
    idOrari.add(id);
  });
  orari.linee.forEach((linea) => {
    assert.ok(Array.isArray(linea) && linea.length >= 2);
    assert.ok(typeof linea[0] === 'string' && linea[0].length > 0);
    assert.ok([1, 2, 3].includes(linea[1]), 'tipo linea non valido: ' + linea[0]);
  });
  assert.match(orari.aggiornato, /^\d{4}-\d{2}-\d{2}$/);
  orari.servizi.forEach((servizio) => {
    assert.ok(Array.isArray(servizio) && servizio.length === 3);
    assert.ok(Number.isInteger(servizio[0]) && servizio[0] >= 0 && servizio[0] <= 127);
    assert.match(String(servizio[1]), /^\d{8}$/);
    assert.match(String(servizio[2]), /^\d{8}$/);
    assert.ok(servizio[1] <= servizio[2]);
  });
  Object.keys(orari.eccezioni).forEach((data) => {
    assert.match(data, /^\d{8}$/);
    const voce = orari.eccezioni[data];
    ['a', 'r'].forEach((tipo) => (voce[tipo] || []).forEach((indice) => {
      assert.ok(indice >= 0 && indice < orari.servizi.length, 'eccezione con servizio inesistente');
    }));
  });
});

test('orari: ogni corsa è decodificabile e non va nel passato', () => {
  const errori = [];
  orari.corse.forEach((corsa, indice) => {
    if (corsa.length < 4 || (corsa.length - 4) % 2 !== 0) {
      errori.push('corsa ' + indice + ' malformata');
      return;
    }
    if (corsa[0] < 0 || corsa[0] >= orari.linee.length) errori.push('corsa ' + indice + ' linea fuori range');
    if (corsa[1] < 0 || corsa[1] >= orari.servizi.length) errori.push('corsa ' + indice + ' servizio fuori range');
    let fermata = corsa[2];
    let tempo = corsa[3];
    if (fermata < 0 || fermata >= orari.fermate.length) errori.push('corsa ' + indice + ' fermata iniziale fuori range');
    for (let k = 4; k < corsa.length; k += 2) {
      fermata += corsa[k];
      tempo += corsa[k + 1];
      // Il formato comprime gli indici: il delta può essere negativo quando
      // una corsa torna su una fermata precedente (anelli e deviazioni).
      if (!Number.isInteger(corsa[k])) errori.push('corsa ' + indice + ' delta fermata non intero');
      if (corsa[k + 1] < 0) errori.push('corsa ' + indice + ' delta tempo negativo');
      if (fermata < 0 || fermata >= orari.fermate.length) errori.push('corsa ' + indice + ' fermata fuori range');
    }
    if (tempo < 0) errori.push('corsa ' + indice + ' tempo negativo');
  });
  assert.deepEqual(errori.slice(0, 10), []);
  assert.ok(orari.corse.length > 25000);
});

test('tracciati: corse allineate, forme e posizioni valide', () => {
  assert.equal(tracciati.corse.length, orari.corse.length);
  assert.ok(tracciati.forme.length > 1600);
  tracciati.corse.forEach((forma, indice) => {
    assert.ok(forma === -1 || (forma >= 0 && forma < tracciati.forme.length), 'forma fuori range alla corsa ' + indice);
  });
  tracciati.forme.forEach((forma) => assert.ok(typeof forma === 'string' && forma.length > 0));
  tracciati.posizioni.forEach((tabella, indice) => {
    assert.equal(tabella.length % 2, 0, 'tabella posizioni dispari: ' + indice);
    let ultimo = -1;
    for (let k = 0; k < tabella.length; k += 2) {
      assert.ok(tabella[k] >= 0 && tabella[k] < orari.fermate.length, 'fermata fuori range nella forma ' + indice);
      assert.ok(tabella[k + 1] >= ultimo, 'posizione non monotona nella forma ' + indice);
      ultimo = tabella[k + 1];
    }
  });
});

test('treni: stazioni, linee e corse con geometria', () => {
  const stazioni = orari.fermate.filter((id) => id.startsWith('TRN'));
  assert.deepEqual(stazioni.sort(), [
    'TRN001', 'TRN010', 'TRN011',
    'TRN038', 'TRN039', 'TRN040', 'TRN041', 'TRN042'
  ]);
  const lineeTreno = orari.linee.filter((linea) => linea[1] === 2);
  assert.deepEqual(lineeTreno.map((linea) => linea[0]).sort(), ['REG', 'RV']);

  const corseTreno = [];
  orari.corse.forEach((corsa, indice) => {
    if (orari.linee[corsa[0]][1] !== 2) return;
    corseTreno.push({ corsa, indice });
  });
  assert.equal(corseTreno.length, 110);
  corseTreno.forEach(({ corsa, indice }) => {
    const fermateCorsa = [];
    let fermata = corsa[2];
    fermateCorsa.push(fermata);
    for (let k = 4; k < corsa.length; k += 2) {
      fermata += corsa[k];
      fermateCorsa.push(fermata);
    }
    assert.ok(fermateCorsa.length >= 2, 'corsa treno con meno di due fermate');
    fermateCorsa.forEach((indiceFermata) => {
      assert.ok(orari.fermate[indiceFermata].startsWith('TRN'), 'corsa treno su fermata non ferroviaria');
    });
    assert.notEqual(tracciati.corse[indice], -1, 'corsa treno senza geometria');
  });
});

test('treni: tutte le fermate delle linee Bologna–Vignola, Bologna–Porretta e Bologna–Pianoro', () => {
  const perId = new Map(fermate.fermate.map((f) => [f.id, f]));
  const linee = {
    'Bologna–Vignola': [
      'TRN001', 'TRN012', 'TRN013', 'TRN004', 'TRN014', 'TRN015', 'TRN016',
      'TRN017', 'TRN018', 'TRN019', 'TRN020', 'TRN021', 'TRN022', 'TRN023',
      'TRN024', 'TRN025', 'TRN026', 'TRN009'
    ],
    'Bologna–Porretta': [
      'TRN001', 'TRN012', 'TRN013', 'TRN004', 'TRN027', 'TRN028', 'TRN029',
      'TRN007', 'TRN030', 'TRN008', 'TRN031', 'TRN032', 'TRN033', 'TRN034',
      'TRN035', 'TRN036', 'TRN037'
    ],
    'Bologna–Pianoro': [
      'TRN001', 'TRN038', 'TRN039', 'TRN040', 'TRN041', 'TRN042', 'TRN011'
    ]
  };
  Object.entries(linee).forEach(([nome, ids]) => {
    ids.forEach((id) => {
      const fermata = perId.get(id);
      assert.ok(fermata, nome + ': fermata mancante ' + id);
      assert.ok(fermata.tipo === 'treno' || fermata.tipo === 'entrambi', nome + ': tipo non ferroviario ' + id);
      assert.ok(Number.isFinite(fermata.lat) && Number.isFinite(fermata.lon), nome + ': coordinate mancanti ' + id);
    });
  });
});

test('linee-per-fermata non contiene fermate inesistenti', () => {
  const ids = new Set(fermate.fermate.map((f) => f.id));
  const mancanti = Object.keys(lineePerFermata.linee || {}).filter((id) => !ids.has(id));
  assert.deepEqual(mancanti.slice(0, 5), []);
});
