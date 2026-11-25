#!/usr/bin/env node
/**
 * ricostruisci-tracciati.js
 *
 * Ripara le geometrie di data/tracciati.json senza rigenerare gli orari:
 *
 *  1. Ricalcola la tabella fermata -> vertice di ogni forma con una proiezione
 *     sul segmento (non sul solo vertice) e un percorso monotono. La vecchia
 *     proiezione "solo in avanti" sbagliava le linee ad anello: molte fermate
 *     finivano sullo stesso vertice, anche a chilometri di distanza.
 *  2. Sostituisce le forme ferroviarie (5-8 punti nel GTFS nazionale) con il
 *     percorso reale sulla rete ferroviaria OpenStreetMap, così il treno resta
 *     sui binari anche tra due stazioni.
 *
 * USO
 *   node scripts/ricostruisci-tracciati.js [--osm file.json] [--scrivi]
 *
 * Senza --osm scarica la rete ferroviaria da Overpass e la mette in
 * .tmp-binari/binari.json (solo per la rigenerazione, non a runtime).
 * Senza --scrivi mostra solo le verifiche.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RADICE = path.join(__dirname, '..');
const FILE_ORARI = path.join(RADICE, 'data', 'orari.json');
const FILE_TRACCIATI = path.join(RADICE, 'data', 'tracciati.json');
const FILE_FERMATE = path.join(RADICE, 'data', 'fermate.json');
const FILE_OSM = path.join(RADICE, '.tmp-binari', 'binari.json');
// Più server in ordine di affidabilità osservata: il primo è quello che ha
// risposto quando gli altri erano in sovraccarico.
const SERVER_OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const URL_OVERPASS = SERVER_OVERPASS[0];
const UA = 'MuoviBologna/1.0 (ricostruzione geometrie)';

const args = process.argv.slice(2);
const scrivi = args.includes('--scrivi');
const indiceOsm = args.indexOf('--osm');
const osmPath = indiceOsm >= 0 && args[indiceOsm + 1] ? args[indiceOsm + 1] : FILE_OSM;

function leggiJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function distanza(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(lat), (a[1] - b[1]) * 111320);
}

function polilinea(punti) {
  let uscita = '';
  let latPrec = 0;
  let lonPrec = 0;
  const coppia = (valore) => {
    let v = valore < 0 ? ~(valore << 1) : valore << 1;
    let testo = '';
    while (v >= 0x20) {
      testo += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return testo + String.fromCharCode(v + 63);
  };
  punti.forEach((punto) => {
    const lat = Math.round(punto[1] * 1e5);
    const lon = Math.round(punto[0] * 1e5);
    uscita += coppia(lat - latPrec) + coppia(lon - lonPrec);
    latPrec = lat;
    lonPrec = lon;
  });
  return uscita;
}

function decodifica(testo) {
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
}

/**
 * Per ogni fermata sceglie un vertice della polilinea, in ordine crescente.
 * Il costo è la distanza dal segmento più vicino; il DP impone la monotonia.
 * Le fermate ripetute (anelli e ritorni) vengono spostate in avanti, così il
 * secondo passaggio non finisce sullo stesso vertice del primo.
 */
function posizioniMonotone(punti, ids, coordinate) {
  const n = punti.length;
  const m = ids.length;
  if (n < 2 || m < 1) return [];

  const costi = ids.map((id) => {
    const c = coordinate.get(id);
    const riga = new Float64Array(n).fill(Infinity);
    if (!c) return riga;
    for (let j = 0; j < n; j += 1) riga[j] = distanza(c, punti[j]);
    return riga;
  });

  let precedente = Float64Array.from(costi[0]);
  const scelte = [new Int32Array(n)];
  for (let i = 1; i < m; i += 1) {
    const corrente = new Float64Array(n);
    const arg = new Int32Array(n);
    let minimo = Infinity;
    let indiceMinimo = 0;
    for (let j = 0; j < n; j += 1) {
      if (precedente[j] < minimo) { minimo = precedente[j]; indiceMinimo = j; }
      corrente[j] = costi[i][j] + minimo;
      arg[j] = indiceMinimo;
    }
    scelte.push(arg);
    precedente = corrente;
  }

  let fine = 0;
  for (let j = 1; j < n; j += 1) if (precedente[j] < precedente[fine]) fine = j;
  const posizioni = new Array(m);
  let j = fine;
  for (let i = m - 1; i >= 0; i -= 1) {
    posizioni[i] = j;
    if (i > 0) j = scelte[i][j];
  }

  // Fermate ripetute: il secondo passaggio deve stare più avanti del primo.
  const ultimaOccorrenza = new Map();
  for (let i = 0; i < m; i += 1) {
    const id = ids[i];
    let minimo = i > 0 ? posizioni[i - 1] : 0;
    if (ultimaOccorrenza.has(id)) minimo = Math.max(minimo, ultimaOccorrenza.get(id) + 1);
    if (posizioni[i] < minimo) {
      let migliore = -1;
      let distanzaMinima = Infinity;
      for (let k = minimo; k < n; k += 1) {
        if (costi[i][k] < distanzaMinima) { distanzaMinima = costi[i][k]; migliore = k; }
      }
      posizioni[i] = migliore >= 0 ? migliore : n - 1;
    }
    ultimaOccorrenza.set(id, posizioni[i]);
  }

  return posizioni;
}

/**
 * Inserisce nella polilinea il punto di proiezione di ogni fermata. Senza,
 * una fermata a metà di un segmento lungo resta a centinaia di metri dal
 * vertice scelto e la tratta disegnata parte dal punto sbagliato.
 */
function inserisciProiezioni(punti, ids, posizioni, coordinate) {
  const n = punti.length;
  const proiezioni = [];

  function proietta(c, a, b) {
    const coseno = Math.cos((c[1] * Math.PI) / 180);
    const ax = a[0] * coseno;
    const ay = a[1];
    const dx = b[0] * coseno - ax;
    const dy = b[1] - ay;
    const lunghezza2 = dx * dx + dy * dy;
    let t = lunghezza2 ? ((c[0] * coseno - ax) * dx + (c[1] - ay) * dy) / lunghezza2 : 0;
    t = Math.max(0, Math.min(1, t));
    const punto = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    return { distanza: distanza(c, punto), punto: punto, t: t };
  }

  for (let i = 0; i < ids.length; i += 1) {
    const c = coordinate.get(ids[i]);
    if (!c) { proiezioni.push(null); continue; }
    const vertice = posizioni[i];
    let migliore = null;
    [vertice - 1, vertice].forEach((s) => {
      if (s < 0 || s >= n - 1) return;
      const p = proietta(c, punti[s], punti[s + 1]);
      if (!migliore || p.distanza < migliore.distanza) migliore = Object.assign({ segmento: s }, p);
    });
    // Se il vertice scelto è su un ramo sbagliato, si cerca su tutta la linea.
    if (!migliore || migliore.distanza > 120) {
      for (let s = 0; s < n - 1; s += 1) {
        const p = proietta(c, punti[s], punti[s + 1]);
        if (!migliore || p.distanza < migliore.distanza) migliore = Object.assign({ segmento: s }, p);
      }
    }
    proiezioni.push(migliore);
  }

  const perSegmento = new Map();
  proiezioni.forEach((p, i) => {
    if (!p) return;
    if (!perSegmento.has(p.segmento)) perSegmento.set(p.segmento, []);
    perSegmento.get(p.segmento).push({ i: i, p: p });
  });

  const nuove = [];
  const indiceVertice = new Array(n);
  const daRimappare = [];
  for (let v = 0; v < n; v += 1) {
    indiceVertice[v] = nuove.length;
    nuove.push(punti[v]);
    if (v >= n - 1) continue;
    const elenco = (perSegmento.get(v) || []).sort((a, b) => a.p.t - b.p.t);
    elenco.forEach((voce) => {
      if (voce.p.t <= 0.001) { voce.p.indice = indiceVertice[v]; return; }
      if (voce.p.t >= 0.999) { daRimappare.push(voce); return; }
      const ultimo = nuove[nuove.length - 1];
      if (ultimo && distanza(ultimo, voce.p.punto) < 0.5) {
        voce.p.indice = nuove.length - 1;
        return;
      }
      voce.p.indice = nuove.length;
      nuove.push(voce.p.punto);
    });
  }
  daRimappare.forEach((voce) => { voce.p.indice = indiceVertice[voce.p.segmento + 1]; });

  const risultato = proiezioni.map((p, i) => (p && p.indice != null ? p.indice : posizioni[i]));
  // Difesa: le posizioni devono restare in ordine crescente.
  for (let i = 1; i < risultato.length; i += 1) {
    if (risultato[i] >= risultato[i - 1]) continue;
    const coordinata = coordinate.get(ids[i]);
    // Fermata senza coordinate (o tabella riferita a un indice mancante): non
    // c'è niente da riallineare, si tiene la posizione calcolata.
    if (!coordinata) continue;
    let migliore = risultato[i - 1];
    let minima = Infinity;
    for (let k = risultato[i - 1]; k < nuove.length; k += 1) {
      const d = distanza(coordinata, nuove[k]);
      if (d < minima) { minima = d; migliore = k; }
    }
    risultato[i] = migliore;
  }
  return { punti: nuove, posizioni: risultato };
}

/* --- Rete ferroviaria OSM ------------------------------------------- */

// Overpass è un servizio pubblico e a volte risponde 502 o va in timeout: in
// pipeline si prova più di un server, con attese crescenti, prima di arrendersi.
async function scaricaOsm() {
  if (fs.existsSync(osmPath)) return leggiJSON(osmPath);
  fs.mkdirSync(path.dirname(osmPath), { recursive: true });
  const query = '[out:json][timeout:180];way["railway"="rail"](44.28,10.95,44.56,11.82);out geom;';
  console.log('Scarico la rete ferroviaria da OpenStreetMap…');
  let ultimo = null;
  for (let giro = 0; giro < SERVER_OVERPASS.length; giro += 1) {
    const server = SERVER_OVERPASS[giro];
    try {
      const risposta = await fetch(server + '?data=' + encodeURIComponent(query), {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(200000)
      });
      if (!risposta.ok) throw new Error('HTTP ' + risposta.status);
      const testo = await risposta.text();
      const dati = JSON.parse(testo);
      fs.writeFileSync(osmPath, testo);
      return dati;
    } catch (errore) {
      ultimo = errore;
      console.log('  ' + new URL(server).host + ' non disponibile (' + errore.message + ')' +
        (giro + 1 < SERVER_OVERPASS.length ? ', provo un altro server' : ''));
      if (giro + 1 < SERVER_OVERPASS.length) {
        await new Promise((risolvi) => setTimeout(risolvi, 5000 * (giro + 1)));
      }
    }
  }
  throw new Error('nessun server Overpass disponibile (' + (ultimo && ultimo.message) +
    '): riprova più tardi o passa --osm con un estratto della rete ferroviaria');
}

function costruisciGrafo(osm) {
  const nodi = new Map();
  const grafo = new Map();
  const archi = new Set();
  const chiaveArco = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  function arco(a, b, peso) {
    if (!grafo.has(a)) grafo.set(a, []);
    if (!grafo.has(b)) grafo.set(b, []);
    grafo.get(a).push([b, peso]);
    grafo.get(b).push([a, peso]);
  }

  osm.elements.forEach((way) => {
    if (!way.geometry || !way.nodes || way.nodes.length !== way.geometry.length) return;
    way.geometry.forEach((p, i) => nodi.set(way.nodes[i], [p.lon, p.lat]));
    for (let i = 1; i < way.nodes.length; i += 1) {
      const a = way.nodes[i - 1];
      const b = way.nodes[i];
      if (a === b) continue;
      const chiave = chiaveArco(a, b);
      if (archi.has(chiave)) continue;
      archi.add(chiave);
      arco(a, b, distanza(nodi.get(a), nodi.get(b)));
    }
  });

  // Binari paralleli e scambi: collega nodi vicini di way diverse. Senza
  // questi ponti le due direzioni restano componenti separate e il percorso
  // non esiste.
  const lato = 0.00015; // ~15 m
  const griglia = new Map();
  nodi.forEach((p, id) => {
    const chiave = Math.floor(p[0] / lato) + '|' + Math.floor(p[1] / lato);
    if (!griglia.has(chiave)) griglia.set(chiave, []);
    griglia.get(chiave).push(id);
  });
  nodi.forEach((p, id) => {
    const cx = Math.floor(p[0] / lato);
    const cy = Math.floor(p[1] / lato);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const elenco = griglia.get((cx + dx) + '|' + (cy + dy));
        if (!elenco) continue;
        elenco.forEach((altro) => {
          if (altro === id) return;
          const chiave = chiaveArco(id, altro);
          if (archi.has(chiave)) return;
          const d = distanza(p, nodi.get(altro));
          if (d > 0 && d <= 15) { archi.add(chiave); arco(id, altro, d); }
        });
      }
    }
  });

  return { nodi, grafo };
}

function nodoVicino(rete, coord) {
  let migliore = null;
  let minima = Infinity;
  rete.nodi.forEach((p, id) => {
    const d = distanza(coord, p);
    if (d < minima) { minima = d; migliore = id; }
  });
  return { id: migliore, metri: minima };
}

function dijkstra(grafo, da, a) {
  const dist = new Map([[da, 0]]);
  const prev = new Map();
  const visitati = new Set();
  const coda = [[0, da]];
  while (coda.length) {
    coda.sort((x, y) => x[0] - y[0]);
    const [d, id] = coda.shift();
    if (visitati.has(id)) continue;
    visitati.add(id);
    if (id === a) break;
    (grafo.get(id) || []).forEach(([v, peso]) => {
      if (visitati.has(v)) return;
      const nd = d + peso;
      if (nd < (dist.get(v) === undefined ? Infinity : dist.get(v))) {
        dist.set(v, nd);
        prev.set(v, id);
        coda.push([nd, v]);
      }
    });
  }
  if (!dist.has(a)) return null;
  const percorso = [];
  let id = a;
  while (id !== undefined) {
    percorso.push(id);
    id = prev.get(id);
  }
  percorso.reverse();
  return { metri: dist.get(a), percorso: percorso };
}

// P2 — forme degeneri: un tracciato più lungo di cinque volte la distanza tra i
// suoi estremi, o un treno con un salto di oltre 300 m tra due punti, non è una
// geometria utile. Scartandola, l'app disegna la retta tratteggiata come già fa
// per le forme mancanti: meglio nessuna linea che una linea sbagliata.
const FORMA_RAPPORTO_MAX = 5;
const SALTO_TRENO_MAX = 300;

function formaPlausibile(punti, treno) {
  if (!Array.isArray(punti) || punti.length < 2) return false;
  let lunghezza = 0;
  for (let i = 1; i < punti.length; i += 1) {
    const d = distanza(punti[i - 1], punti[i]);
    if (treno && d > SALTO_TRENO_MAX) return false;
    lunghezza += d;
  }
  const aria = distanza(punti[0], punti[punti.length - 1]);
  return !(aria > 50 && lunghezza / aria > FORMA_RAPPORTO_MAX);
}

function percorsoStazioni(rete, ids, coordinate) {
  const punti = [];
  const snap = [];
  for (let i = 0; i < ids.length; i += 1) {
    const c = coordinate.get(ids[i]);
    if (!c) return null;
    snap.push(nodoVicino(rete, c));
  }
  for (let i = 1; i < ids.length; i += 1) {
    if (!snap[i - 1].id || !snap[i].id) return null;
    const esito = dijkstra(rete.grafo, snap[i - 1].id, snap[i].id);
    if (!esito) return null;
    const pezzo = esito.percorso.map((id) => rete.nodi.get(id));
    if (punti.length) pezzo.shift();
    pezzo.forEach((p) => punti.push(p));
  }
  return { punti, snap };
}

/* --- Riparazione ---------------------------------------------------- */

async function main() {
  const orari = leggiJSON(FILE_ORARI);
  const tracciati = leggiJSON(FILE_TRACCIATI);
  const fermate = leggiJSON(FILE_FERMATE).fermate;
  const coordinate = new Map(fermate.map((f) => [f.id, [f.lon, f.lat]]));

  const osm = await scaricaOsm();
  const rete = costruisciGrafo(osm);
  console.log('rete OSM: ' + rete.nodi.size + ' nodi');

  const formeTreno = new Set();
  orari.corse.forEach((corsa, indice) => {
    const forma = tracciati.corse[indice];
    if (forma >= 0 && orari.linee[corsa[0]] && orari.linee[corsa[0]][1] === 2) formeTreno.add(forma);
  });

  let formeCambiate = 0;
  let fermateSistemate = 0;
  let formeScartate = 0;
  const errori = [];
  const dettagli = [];

  for (let k = 0; k < tracciati.forme.length; k += 1) {
    const vecchiaTab = tracciati.posizioni[k] || [];
    const ids = [];
    for (let q = 0; q < vecchiaTab.length; q += 2) ids.push(orari.fermate[vecchiaTab[q]]);
    let punti = decodifica(tracciati.forme[k]);

    const treno = formeTreno.has(k);
    // Le forme ferroviarie del GTFS nazionale sono volutamente rade (pochi punti
    // e salti di chilometri): qui si scartano solo quelle dei bus, mentre per i
    // treni si passa alla ricostruzione sul binario qui sotto. Scartandole prima
    // restavano senza geometria e la mappa non disegnava la tratta.
    if (!treno && !formaPlausibile(punti, false)) {
      tracciati.forme[k] = '';
      tracciati.posizioni[k] = [];
      formeScartate += 1;
      continue;
    }

    if (treno && ids.length >= 2) {
      const esito = percorsoStazioni(rete, ids, coordinate);
      if (!esito || esito.punti.length < 2) {
        errori.push('forma treno ' + k + ': nessun percorso ferroviario per ' + ids.join('→'));
        tracciati.posizioni[k] = vecchiaTab;
        continue;
      }
      // Le stazioni devono restare vicine al binario: se una snap è finita su
      // una linea sbagliata il percorso non serve.
      const lontane = esito.snap.filter((s) => s.metri > 400);
      if (lontane.length) {
        errori.push('forma treno ' + k + ': stazione lontana ' + Math.round(Math.max(...lontane.map((s) => s.metri))) + ' m');
      }
      punti = esito.punti;
      tracciati.forme[k] = polilinea(punti);
      formeCambiate += 1;
      let massimoSalto = 0;
      let lunghezza = 0;
      let doveSalto = null;
      for (let i = 1; i < punti.length; i += 1) {
        const d = distanza(punti[i - 1], punti[i]);
        lunghezza += d;
        if (d > massimoSalto) {
          massimoSalto = d;
          doveSalto = [punti[i - 1], punti[i]];
        }
      }
      const scartoFermate = Math.max(...ids.map((id) => {
        const c = coordinate.get(id);
        return Math.min(...punti.map((p) => distanza(c, p)));
      }));
      dettagli.push({
        forma: k,
        fermate: ids.length,
        punti: punti.length,
        km: +(lunghezza / 1000).toFixed(2),
        salto: Math.round(massimoSalto),
        doveSalto: doveSalto,
        scartoFermate: Math.round(scartoFermate),
        snap: Math.round(Math.max(...esito.snap.map((s) => s.metri)))
      });
    }

    const posizioni = posizioniMonotone(punti, ids, coordinate);
    if (posizioni.length !== ids.length) {
      errori.push('forma ' + k + ': posizioni non calcolate');
      continue;
    }
    const inserite = inserisciProiezioni(punti, ids, posizioni, coordinate);
    tracciati.forme[k] = polilinea(inserite.punti);
    const tab = [];
    ids.forEach((id, i) => tab.push(vecchiaTab[i * 2], inserite.posizioni[i]));
    tracciati.posizioni[k] = tab;
    fermateSistemate += ids.length;
  }

  // Verifica: la tratta disegnata deve partire e finire vicino alle fermate.
  let scarti = 0;
  let scartoMassimo = 0;
  for (let k = 0; k < tracciati.forme.length; k += 1) {
    const tab = tracciati.posizioni[k] || [];
    if (tab.length < 4) continue;
    const punti = decodifica(tracciati.forme[k]);
    [0, tab.length - 2].forEach((q) => {
      const c = coordinate.get(orari.fermate[tab[q]]);
      const v = punti[tab[q + 1]];
      if (!c || !v) return;
      const d = distanza(c, v);
      if (d > 80) scarti += 1;
      if (d > scartoMassimo) scartoMassimo = d;
    });
  }

  console.log('forme ferroviarie ricostruite: ' + formeCambiate + '/' + formeTreno.size);
  if (args.includes('--dettaglio')) {
    dettagli.forEach((d) => console.log('  forma ' + d.forma + ': ' + d.punti + ' punti · ' + d.km +
      ' km · salto max ' + d.salto + ' m' +
      (d.doveSalto ? ' (' + d.doveSalto.map((p) => p.map((v) => v.toFixed(4)).join(',')).join(' → ') + ')' : '') +
      ' · fermate max ' + d.scartoFermate + ' m · snap max ' + d.snap + ' m · ' + d.fermate + ' fermate'));
  }
  console.log('fermate riproiettate: ' + fermateSistemate);
  console.log('forme scartate (rapporto o salto): ' + formeScartate);
  console.log('estremi oltre 80 m: ' + scarti + ' · scarto massimo ' + Math.round(scartoMassimo) + ' m');
  if (errori.length) {
    console.log('errori:');
    errori.slice(0, 20).forEach((e) => console.log('  ' + e));
  }
  if (!scrivi) {
    console.log('prova: nessun file scritto (aggiungi --scrivi)');
    if (errori.length) process.exitCode = 1;
    return;
  }

  tracciati.aggiornato = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(FILE_TRACCIATI, JSON.stringify(tracciati));
  fs.writeFileSync(FILE_TRACCIATI + '.gz', zlib.gzipSync(fs.readFileSync(FILE_TRACCIATI), { level: 9 }));
  console.log('scritto ' + FILE_TRACCIATI);
  if (errori.length) process.exitCode = 1;
}

main().catch((errore) => {
  console.error(errore);
  process.exit(1);
});
