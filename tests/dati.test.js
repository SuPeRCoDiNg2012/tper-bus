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
  // Regola dichiarata: una forma inutilizzabile diventa assente (''), la corsa
  // resta e la mappa disegna la retta tratteggiata. Le forme assenti non devono
  // però diventare la norma: se crescono, la fonte ha un problema.
  let assenti = 0;
  tracciati.forme.forEach((forma, indice) => {
    if (forma === '') {
      assenti += 1;
      assert.deepEqual(tracciati.posizioni[indice], [], 'forma assente ma con posizioni: ' + indice);
      return;
    }
    assert.ok(typeof forma === 'string' && forma.length > 0);
  });
  assert.ok(assenti < tracciati.forme.length / 20, 'troppe forme assenti: ' + assenti);
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

test('tracciati: fermate vicine alla linea e treni sulla rete ferroviaria', () => {
  const coordinate = new Map(fermate.fermate.map((f) => [f.id, [f.lon, f.lat]]));
  const distanza = (a, b) => Math.hypot(
    (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180),
    (a[1] - b[1]) * 111320
  );
  const decodifica = (testo) => {
    const punti = [];
    let indice = 0;
    let lat = 0;
    let lon = 0;
    const numero = () => {
      let risultato = 0;
      let shift = 0;
      let byte;
      do {
        byte = testo.charCodeAt(indice++) - 63;
        risultato |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return (risultato & 1) ? ~(risultato >> 1) : (risultato >> 1);
    };
    while (indice < testo.length) {
      lat += numero();
      lon += numero();
      punti.push([lon / 1e5, lat / 1e5]);
    }
    return punti;
  };

  let scartoMassimo = 0;
  tracciati.posizioni.forEach((tabella, indice) => {
    const punti = decodifica(tracciati.forme[indice]);
    for (let k = 0; k < tabella.length; k += 2) {
      const fermata = coordinate.get(orari.fermate[tabella[k]]);
      const vertice = punti[tabella[k + 1]];
      if (!fermata || !vertice) continue;
      scartoMassimo = Math.max(scartoMassimo, distanza(fermata, vertice));
    }
  });
  assert.ok(scartoMassimo <= 300, 'fermata troppo lontana dalla linea: ' + Math.round(scartoMassimo) + ' m');

  const formeTreno = new Set();
  orari.corse.forEach((corsa, indice) => {
    if (orari.linee[corsa[0]][1] === 2) formeTreno.add(tracciati.corse[indice]);
  });
  formeTreno.forEach((forma) => {
    const punti = decodifica(tracciati.forme[forma]);
    assert.ok(punti.length >= 50, 'forma treno troppo rada: ' + forma + ' (' + punti.length + ' punti)');
    let saltoMassimo = 0;
    for (let i = 1; i < punti.length; i += 1) saltoMassimo = Math.max(saltoMassimo, distanza(punti[i - 1], punti[i]));
    assert.ok(saltoMassimo <= 3000, 'salto ferroviario assurdo nella forma ' + forma + ': ' + Math.round(saltoMassimo) + ' m');
  });
});

test('treni: stazioni, linee e corse con geometria', () => {
  const stazioni = orari.fermate.filter((id) => id.startsWith('TRN'));
  assert.deepEqual(stazioni.sort(), [
    'TRN001', 'TRN004', 'TRN007', 'TRN008', 'TRN009', 'TRN010', 'TRN011', 'TRN012', 'TRN013',
    'TRN014', 'TRN015', 'TRN016', 'TRN017', 'TRN018', 'TRN019', 'TRN020',
    'TRN021', 'TRN022', 'TRN023', 'TRN024', 'TRN025', 'TRN026', 'TRN027',
    'TRN028', 'TRN029', 'TRN030', 'TRN031', 'TRN032', 'TRN033', 'TRN034',
    'TRN035', 'TRN036', 'TRN037', 'TRN038', 'TRN039', 'TRN040', 'TRN041',
    'TRN042', 'TRN043', 'TRN044'
  ]);
  const lineeTreno = orari.linee.filter((linea) => linea[1] === 2);
  assert.deepEqual(lineeTreno.map((linea) => linea[0]).sort(), ['MEX', 'REG', 'RV', 'S2A']);

  const corseTreno = [];
  orari.corse.forEach((corsa, indice) => {
    if (orari.linee[corsa[0]][1] !== 2) return;
    corseTreno.push({ corsa, indice });
  });
  assert.equal(corseTreno.length, 3815);
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

test('Marconi Express: corse MEX, fermate e calendario ufficiale', () => {
  const indiceLinea = orari.linee.findIndex((linea) => linea[0] === 'MEX');
  assert.ok(indiceLinea >= 0, 'linea MEX assente');
  const corse = [];
  orari.corse.forEach((corsa, indice) => {
    if (corsa[0] !== indiceLinea) return;
    let fermata = corsa[2];
    let tempo = corsa[3];
    const fermateCorsa = [orari.fermate[fermata]];
    const tempi = [tempo];
    for (let k = 4; k < corsa.length; k += 2) {
      fermata += corsa[k];
      tempo += corsa[k + 1];
      fermateCorsa.push(orari.fermate[fermata]);
      tempi.push(tempo);
    }
    corse.push({ indice, fermate: fermateCorsa, tempi, servizio: corsa[1] });
  });
  assert.equal(corse.length, 3591);
  const andata = ['TRN001', 'TRN043', 'TRN044'];
  const ritorno = andata.slice().reverse();
  corse.forEach(({ indice, fermate: f, tempi, servizio }) => {
    assert.ok(f.join('|') === andata.join('|') || f.join('|') === ritorno.join('|'), 'sequenza MEX inattesa: ' + f.join('→'));
    for (let i = 1; i < tempi.length; i += 1) {
      assert.ok(tempi[i] > tempi[i - 1], 'orari MEX non crescenti alla corsa ' + indice);
    }
    assert.ok(servizio >= 0 && servizio < orari.servizi.length, 'servizio MEX fuori range');
    assert.equal(orari.servizi[servizio][0], 0, 'MEX usa una maschera settimanale inventata');
    assert.ok(tracciati.corse[indice] >= 0, 'corsa MEX senza geometria');
  });
  assert.ok(corse.some((c) => c.fermate[0] === 'TRN001'));
  assert.ok(corse.some((c) => c.fermate[0] === 'TRN044'));
  assert.ok(orari.eccezioni['20261123'].a.some((indice) => indice >= 0));
});

test('treni S2A: corse Vignola validate, servizi e geometria', () => {
  const indiceLinea = orari.linee.findIndex((linea) => linea[0] === 'S2A');
  assert.ok(indiceLinea >= 0);
  const andata = [
    'TRN001', 'TRN012', 'TRN013', 'TRN004', 'TRN014', 'TRN015', 'TRN016',
    'TRN017', 'TRN018', 'TRN019', 'TRN020', 'TRN021', 'TRN022', 'TRN023',
    'TRN024', 'TRN025', 'TRN026', 'TRN009'
  ];
  const ritorno = andata.slice().reverse();
  const corse = [];
  orari.corse.forEach((corsa, indice) => {
    if (corsa[0] !== indiceLinea) return;
    let fermata = corsa[2];
    let tempo = corsa[3];
    const fermateCorsa = [orari.fermate[fermata]];
    const tempi = [tempo];
    for (let k = 4; k < corsa.length; k += 2) {
      fermata += corsa[k];
      tempo += corsa[k + 1];
      fermateCorsa.push(orari.fermate[fermata]);
      tempi.push(tempo);
    }
    corse.push({ indice, fermate: fermateCorsa, tempi, servizio: corsa[1] });
  });
  assert.equal(corse.length, 58);
  assert.ok(corse.some((c) => c.fermate.length === 18), 'manca una corsa completa Bologna–Vignola');
  corse.forEach(({ indice, fermate: f, tempi, servizio }) => {
    assert.ok(f.length >= 2, 'corsa S2A con meno di due fermate');
    f.forEach((id) => assert.ok(id.startsWith('TRN'), 'corsa S2A su fermata non ferroviaria: ' + id));
    for (let i = 1; i < tempi.length; i += 1) {
      assert.ok(tempi[i] > tempi[i - 1], 'orari S2A non crescenti alla corsa ' + indice);
    }
    assert.ok(f[0] === 'TRN001' || f[f.length - 1] === 'TRN001', 'corsa S2A senza capolinea Bologna');
    const canonica = f[0] === 'TRN001' ? andata : ritorno;
    let j = 0;
    f.forEach((id) => {
      while (j < canonica.length && canonica[j] !== id) j += 1;
      assert.ok(j < canonica.length, 'fermata S2A fuori sequenza: ' + id);
    });
    assert.ok(servizio >= 0 && servizio < orari.servizi.length, 'servizio S2A fuori range');
    assert.notEqual(tracciati.corse[indice], -1, 'corsa S2A senza geometria');
  });
  const maschere = new Set(corse.map((c) => orari.servizi[c.servizio][0]));
  assert.ok(maschere.has(63), 'mancano corse S2A feriali');
  assert.ok(maschere.has(96), 'mancano corse S2A festive');
});

test('treni S1: corse Bologna–Porretta validate, servizio e geometria', () => {
  const andata = [
    'TRN001', 'TRN012', 'TRN013', 'TRN004', 'TRN027', 'TRN028', 'TRN029',
    'TRN007', 'TRN030', 'TRN008', 'TRN031', 'TRN032', 'TRN033', 'TRN034',
    'TRN035', 'TRN036', 'TRN037'
  ];
  const ritorno = andata.slice().reverse();
  const corse = [];
  orari.corse.forEach((corsa, indice) => {
    let fermata = corsa[2];
    let tempo = corsa[3];
    const fermateCorsa = [orari.fermate[fermata]];
    const tempi = [tempo];
    for (let k = 4; k < corsa.length; k += 2) {
      fermata += corsa[k];
      tempo += corsa[k + 1];
      fermateCorsa.push(orari.fermate[fermata]);
      tempi.push(tempo);
    }
    if (!fermateCorsa.includes('TRN037')) return;
    corse.push({ indice, fermate: fermateCorsa, tempi, servizio: corsa[1] });
  });
  assert.equal(corse.length, 56);
  assert.equal(corse.filter((c) => c.fermate[0] === 'TRN001').length, 23);
  assert.equal(corse.filter((c) => c.fermate[c.fermate.length - 1] === 'TRN001').length, 33);
  corse.forEach(({ indice, fermate: f, tempi, servizio }) => {
    assert.ok(f.length >= 2, 'corsa S1 con meno di due fermate');
    assert.ok(f[0] === 'TRN001' || f[f.length - 1] === 'TRN001', 'corsa S1 senza capolinea Bologna');
    assert.ok(f.includes('TRN037'), 'corsa S1 senza Porretta Terme');
    f.forEach((id) => assert.ok(id.startsWith('TRN'), 'corsa S1 su fermata non ferroviaria: ' + id));
    for (let i = 1; i < tempi.length; i += 1) {
      assert.ok(tempi[i] > tempi[i - 1], 'orari S1 non crescenti alla corsa ' + indice);
    }
    const canonica = f[0] === 'TRN001' ? andata : ritorno;
    let j = 0;
    f.forEach((id) => {
      while (j < canonica.length && canonica[j] !== id) j += 1;
      assert.ok(j < canonica.length, 'fermata S1 fuori sequenza: ' + id);
    });
    assert.ok(servizio >= 0 && servizio < orari.servizi.length, 'servizio S1 fuori range');
    assert.deepEqual(orari.servizi[servizio], [127, 20260614, 20261212]);
    assert.notEqual(tracciati.corse[indice], -1, 'corsa S1 senza geometria');
    assert.ok(tracciati.forme[tracciati.corse[indice]].length > 0, 'geometria S1 vuota');
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
