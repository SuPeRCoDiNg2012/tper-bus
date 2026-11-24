#!/usr/bin/env node
/**
 * preprocess-orari.js
 *
 * Converte il GTFS ufficiale TPER (rete bus Bologna, file "gommagtfsbo")
 * nel dataset compatto usato dall'app per calcolare i percorsi:
 *
 *   data/orari.json
 *
 * USO
 *   node scripts/preprocess-orari.js percorso/della/cartella-gtfs data/orari.json
 *
 * La cartella deve contenere i file estratti dallo zip GTFS:
 * stops.txt, routes.txt, trips.txt, stop_times.txt, calendar.txt, calendar_dates.txt
 *
 * Il dataset prodotto contiene solo ciò che serve al calcolo:
 *  - indice delle fermate (stessi codici di data/fermate.json)
 *  - linee (numero e tipo)
 *  - servizi (maschera giorni + validità)
 *  - eccezioni di calendario (aggiunte/rimozioni per data)
 *  - corse come sequenza di fermate e orari, con tempi in secondi dalla mezzanotte
 *
 * Nessuna dipendenza esterna: solo Node.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function leggiCsv(percorso) {
  const testo = fs.readFileSync(percorso, 'utf8').replace(/^\uFEFF/, '');
  const righe = [];
  let campo = '';
  let riga = [];
  let traVirgolette = false;
  for (let i = 0; i < testo.length; i += 1) {
    const c = testo[i];
    if (traVirgolette) {
      if (c === '"') {
        if (testo[i + 1] === '"') { campo += '"'; i += 1; }
        else traVirgolette = false;
      } else campo += c;
    } else if (c === '"') traVirgolette = true;
    else if (c === ',') { riga.push(campo); campo = ''; }
    else if (c === '\n') { riga.push(campo); righe.push(riga); riga = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo.length || riga.length) { riga.push(campo); righe.push(riga); }
  const intestazioni = righe.shift();
  return righe
    .filter((r) => r.length === intestazioni.length && r.some((v) => v !== ''))
    .map((r) => {
      const oggetto = {};
      intestazioni.forEach((nome, indice) => { oggetto[nome.trim()] = r[indice]; });
      return oggetto;
    });
}

function secondi(orario) {
  const parti = orario.split(':');
  return parseInt(parti[0], 10) * 3600 + parseInt(parti[1], 10) * 60 + parseInt(parti[2] || '0', 10);
}

function maschera(riga) {
  const giorni = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let valore = 0;
  giorni.forEach((giorno, indice) => {
    if (riga[giorno] === '1') valore |= 1 << indice; // 0 = lunedì … 6 = domenica
  });
  return valore;
}

/* --- Geometria delle linee (shapes.txt) ------------------------------- */

// Semplificazione Douglas-Peucker in metri: toglie i punti che non cambiano
// la forma del tracciato oltre la tolleranza, alleggerendo il file.
function semplifica(punti, tolleranzaMetri) {
  if (punti.length < 3) return punti;
  const lat0 = punti[0][0];
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const xy = punti.map((p) => [p[1] * mLon, p[0] * mLat]);
  const tenere = new Uint8Array(punti.length);
  tenere[0] = 1;
  tenere[punti.length - 1] = 1;

  const pila = [[0, punti.length - 1]];
  const tolleranza2 = tolleranzaMetri * tolleranzaMetri;
  while (pila.length) {
    const [inizio, fine] = pila.pop();
    const [x1, y1] = xy[inizio];
    const [x2, y2] = xy[fine];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lunghezza2 = dx * dx + dy * dy;
    let massimo = 0;
    let indice = -1;
    for (let i = inizio + 1; i < fine; i += 1) {
      const [x, y] = xy[i];
      let distanza2;
      if (lunghezza2 === 0) {
        distanza2 = (x - x1) * (x - x1) + (y - y1) * (y - y1);
      } else {
        const t = ((x - x1) * dx + (y - y1) * dy) / lunghezza2;
        const px = x1 + t * dx;
        const py = y1 + t * dy;
        distanza2 = (x - px) * (x - px) + (y - py) * (y - py);
      }
      if (distanza2 > massimo) { massimo = distanza2; indice = i; }
    }
    if (massimo > tolleranza2 && indice > 0) {
      tenere[indice] = 1;
      pila.push([inizio, indice], [indice, fine]);
    }
  }

  const risultato = [];
  for (let i = 0; i < punti.length; i += 1) if (tenere[i]) risultato.push(punti[i]);
  return risultato;
}

// Polilinea codificata (formato Google, precisione 1e5): stringa compatta
// invece di migliaia di coppie [lon, lat].
function polilinea(punti) {
  let uscita = '';
  let latPrec = 0;
  let lonPrec = 0;
  const fattore = 1e5;
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
    const lat = Math.round(punto[0] * fattore);
    const lon = Math.round(punto[1] * fattore);
    uscita += coppia(lat - latPrec) + coppia(lon - lonPrec);
    latPrec = lat;
    lonPrec = lon;
  });
  return uscita;
}

// Posizioni delle fermate lungo la forma, monotone e scelte sul segmento più
// vicino (non solo sul vertice). La vecchia ricerca "solo in avanti" faceva
// finire molte fermate di una linea ad anello sullo stesso vertice, anche a
// chilometri di distanza. Il DP impone l'ordine e, per le fermate ripetute,
// un secondo passaggio sempre più avanti.
function posizioniMonotone(punti, indici, elencoFermate, coordFermate) {
  const n = punti.length;
  const m = indici.length;
  if (n < 2 || m < 1) return [];

  function distanzaSegmento(coord, a, b) {
    const coseno = Math.cos((coord[0] * Math.PI) / 180);
    const ax = a[1] * coseno;
    const ay = a[0];
    const dx = b[1] * coseno - ax;
    const dy = b[0] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((coord[1] * coseno - ax) * dx + (coord[0] - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx - coord[1] * coseno, ay + t * dy - coord[0]);
  }

  const costi = indici.map((indiceFermata) => {
    const c = coordFermate.get(elencoFermate[indiceFermata]);
    const riga = new Float64Array(n).fill(Infinity);
    if (!c) return riga;
    for (let j = 0; j < n; j += 1) {
      let minima = Infinity;
      if (j > 0) minima = Math.min(minima, distanzaSegmento(c, punti[j - 1], punti[j]));
      if (j < n - 1) minima = Math.min(minima, distanzaSegmento(c, punti[j], punti[j + 1]));
      riga[j] = minima;
    }
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

  const ultima = new Map();
  for (let i = 0; i < m; i += 1) {
    const id = elencoFermate[indici[i]];
    let minimo = i > 0 ? posizioni[i - 1] : 0;
    if (ultima.has(id)) minimo = Math.max(minimo, ultima.get(id) + 1);
    if (posizioni[i] < minimo) {
      let migliore = -1;
      let distanzaMinima = Infinity;
      for (let k = minimo; k < n; k += 1) {
        if (costi[i][k] < distanzaMinima) { distanzaMinima = costi[i][k]; migliore = k; }
      }
      posizioni[i] = migliore >= 0 ? migliore : n - 1;
    }
    ultima.set(id, posizioni[i]);
  }
  return posizioni;
}

function leggiForme(file) {
  if (!fs.existsSync(file)) return null;
  const forme = new Map();
  leggiCsv(file).forEach((riga) => {
    const lat = parseFloat(riga.shape_pt_lat);
    const lon = parseFloat(riga.shape_pt_lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    if (!forme.has(riga.shape_id)) forme.set(riga.shape_id, []);
    forme.get(riga.shape_id).push({ ordine: parseInt(riga.shape_pt_sequence, 10) || 0, punto: [lat, lon] });
  });
  const punti = new Map();
  forme.forEach((elenco, id) => {
    elenco.sort((a, b) => a.ordine - b.ordine);
    const puliti = [];
    elenco.forEach((voce) => {
      const ultimo = puliti[puliti.length - 1];
      if (!ultimo || ultimo[0] !== voce.punto[0] || ultimo[1] !== voce.punto[1]) puliti.push(voce.punto);
    });
    if (puliti.length >= 2) punti.set(id, puliti);
  });
  return punti;
}

function main() {
  const cartella = process.argv[2];
  const uscita = process.argv[3] || path.join('data', 'orari.json');
  if (!cartella) {
    console.error('Uso: node scripts/preprocess-orari.js cartella-gtfs [data/orari.json]');
    process.exit(1);
  }

  const file = (nome) => path.join(cartella, nome);
  const fermate = leggiCsv(file('stops.txt'));
  const linee = leggiCsv(file('routes.txt'));
  const corse = leggiCsv(file('trips.txt'));
  const passaggi = leggiCsv(file('stop_times.txt'));
  const calendario = leggiCsv(file('calendar.txt'));
  const eccezioni = leggiCsv(file('calendar_dates.txt'));
  const formeGrezze = leggiForme(file('shapes.txt'));

  const indiceFermata = new Map();
  const elencoFermate = [];
  const coordFermate = new Map();
  fermate.forEach((f) => {
    indiceFermata.set(f.stop_id, elencoFermate.length);
    elencoFermate.push(f.stop_id);
    coordFermate.set(f.stop_id, [parseFloat(f.stop_lat), parseFloat(f.stop_lon)]);
  });

  const indiceLinea = new Map();
  const elencoLinee = [];
  linee.forEach((l) => {
    indiceLinea.set(l.route_id, elencoLinee.length);
    elencoLinee.push([l.route_short_name || l.route_long_name || l.route_id, parseInt(l.route_type, 10) || 3]);
  });

  const indiceServizio = new Map();
  const elencoServizi = [];
  calendario.forEach((s) => {
    indiceServizio.set(s.service_id, elencoServizi.length);
    elencoServizi.push([maschera(s), parseInt(s.start_date, 10), parseInt(s.end_date, 10)]);
  });

  const mappaEccezioni = {};
  eccezioni.forEach((e) => {
    const data = e.date;
    if (!mappaEccezioni[data]) mappaEccezioni[data] = { a: [], r: [] };
    const indice = indiceServizio.get(e.service_id);
    if (indice === undefined) return;
    if (e.exception_type === '1') mappaEccezioni[data].a.push(indice);
    else mappaEccezioni[data].r.push(indice);
  });

  // Raggruppa i passaggi per corsa mantenendo l'ordine di stop_sequence.
  const perCorsa = new Map();
  passaggi.forEach((p) => {
    if (!perCorsa.has(p.trip_id)) perCorsa.set(p.trip_id, []);
    perCorsa.get(p.trip_id).push(p);
  });

  const elencoCorse = [];
  const idForme = [];              // indice forma -> shape_id
  const indiceForme = new Map();   // shape_id -> indice forma
  const formaPerCorsa = [];        // stessa lunghezza di elencoCorse
  const sequenzaForme = [];        // per forma: fermate della prima corsa che la usa
  let connessioni = 0;
  let scartate = 0;

  corse.forEach((corsa) => {
    const sequenza = perCorsa.get(corsa.trip_id);
    if (!sequenza || sequenza.length < 2) { scartate += 1; return; }
    const linea = indiceLinea.get(corsa.route_id);
    const servizio = indiceServizio.get(corsa.service_id);
    if (linea === undefined || servizio === undefined) { scartate += 1; return; }

    sequenza.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    const fermateCorsa = [];
    const orariCorsa = [];
    sequenza.forEach((passaggio) => {
      const indice = indiceFermata.get(passaggio.stop_id);
      if (indice === undefined) return;
      fermateCorsa.push(indice);
      orariCorsa.push(secondi(passaggio.departure_time || passaggio.arrival_time));
    });
    if (fermateCorsa.length < 2) { scartate += 1; return; }

    connessioni += fermateCorsa.length - 1;
    // [linea, servizio, fermata0, tempo0, deltaFermata1, deltaTempo1, …]
    const voce = [linea, servizio, fermateCorsa[0], orariCorsa[0]];
    for (let i = 1; i < fermateCorsa.length; i += 1) {
      voce.push(fermateCorsa[i] - fermateCorsa[i - 1]);
      voce.push(orariCorsa[i] - orariCorsa[i - 1]);
    }
    elencoCorse.push(voce);

    let forma = -1;
    if (formeGrezze && corsa.shape_id && formeGrezze.has(corsa.shape_id)) {
      if (!indiceForme.has(corsa.shape_id)) {
        indiceForme.set(corsa.shape_id, idForme.length);
        idForme.push(corsa.shape_id);
        sequenzaForme.push(fermateCorsa);
      }
      forma = indiceForme.get(corsa.shape_id);
    }
    formaPerCorsa.push(forma);
  });

  const oggi = new Date();
  const dataset = {
    aggiornato: oggi.toISOString().slice(0, 10),
    fermate: elencoFermate,
    linee: elencoLinee,
    servizi: elencoServizi,
    eccezioni: mappaEccezioni,
    corse: elencoCorse
  };

  fs.mkdirSync(path.dirname(uscita), { recursive: true });
  fs.writeFileSync(uscita, JSON.stringify(dataset));

  // Tracciati: geometria reale di ogni linea, allineata alle corse di orari.json.
  let tracciati = null;
  if (formeGrezze) {
    const ordine = [];
    const rimappa = new Map();
    let puntiGrezzi = 0;
    for (let i = 0; i < idForme.length; i += 1) {
      const grezza = formeGrezze.get(idForme[i]);
      puntiGrezzi += grezza.length;
      rimappa.set(i, ordine.length);
      // 2 m: le shapes TPER hanno già un punto ogni ~16 m, una tolleranza più
      // alta taglierebbe le curve e la linea sembrerebbe spezzata.
      ordine.push(semplifica(grezza, 2));
    }
    // Per ogni forma: la fermata (indice in orari.fermate) e il punto della
    // forma che le corrisponde. È così che il browser sa dove tagliare il
    // tracciato senza proiezioni approssimate.
    const posizioni = [];
    for (let i = 0; i < idForme.length; i += 1) {
      const sequenza = sequenzaForme[i] || [];
      const scelte = posizioniMonotone(ordine[i], sequenza, elencoFermate, coordFermate);
      const vettore = [];
      sequenza.forEach((indiceFermata, k) => {
        if (scelte[k] === undefined) return;
        vettore.push(indiceFermata, scelte[k]);
      });
      posizioni.push(vettore);
    }

    tracciati = {
      aggiornato: oggi.toISOString().slice(0, 10),
      forme: ordine.map((punti) => polilinea(punti)),
      corse: formaPerCorsa.map((indice) => (indice >= 0 ? rimappa.get(indice) : -1)),
      posizioni: posizioni
    };
    const uscitaTracciati = path.join(path.dirname(uscita), 'tracciati.json');
    fs.writeFileSync(uscitaTracciati, JSON.stringify(tracciati));
    fs.writeFileSync(uscitaTracciati + '.gz', zlib.gzipSync(fs.readFileSync(uscitaTracciati), { level: 9 }));
    const puntiTenuti = ordine.reduce((somma, punti) => somma + punti.length, 0);
    console.log('  tracciati  ' + tracciati.forme.length + ' linee · ' +
      puntiTenuti + '/' + puntiGrezzi + ' punti · ' + uscitaTracciati);
  }

  const dimensione = fs.statSync(uscita).size;
  console.log('Fatto.');
  console.log('  fermate    ' + elencoFermate.length);
  console.log('  linee      ' + elencoLinee.length);
  console.log('  corse      ' + elencoCorse.length + (scartate ? ' (' + scartate + ' scartate)' : ''));
  console.log('  connessioni ' + connessioni);
  console.log('  file       ' + uscita + ' · ' + (dimensione / 1024 / 1024).toFixed(2) + ' MB');
}

main();
