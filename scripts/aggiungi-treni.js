#!/usr/bin/env node
/**
 * aggiungi-treni.js
 *
 * Unisce al dataset bus le corse ferroviarie del GTFS nazionale Trenitalia
 * (fonte: NAP / CC BY 4.0) che collegano le stazioni presenti nell'app.
 *
 * USO
 *   node scripts/aggiungi-treni.js cartella-gtfs-trenitalia data/orari.json data/tracciati.json
 *
 * Il file orari.json deve essere ancora quello generato da preprocess-orari.js:
 * lo script rifiuta di girare due volte sullo stesso dataset per non duplicare
 * le corse. Le stazioni ferroviarie vengono aggiunte con gli stessi codici
 * TRN... usati in data/fermate.json.
 *
 * Nota: il GTFS nazionale copre Bologna C.le, Imola, l'intero ramo
 * Bologna–Pianoro (via San Vitale, Mazzini, San Ruffillo, Rastignano e
 * Musiano) e la sola stazione di Porretta Terme. Le linee locali di
 * Trenitalia Tper (Vignola, Casalecchio, Porretta con le fermate intermedie,
 * Ferrara) non hanno un GTFS aperto e restano fuori da questa unione.
 *
 * Nessuna dipendenza esterna: solo Node.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const STAZIONI = [
  { codice: '830005043', id: 'TRN001' }, // Bologna C.le
  { codice: '830005054', id: 'TRN010' }, // Imola
  { codice: '830005131', id: 'TRN011' }, // Pianoro
  { codice: '830005081', id: 'TRN038' }, // Bologna San Vitale
  { codice: '830005140', id: 'TRN039' }, // Bologna Mazzini
  { codice: '830005130', id: 'TRN040' }, // Bologna San Ruffillo
  { codice: '830005138', id: 'TRN041', coordinate: [44.4432202, 11.3574417] }, // Rastignano
  { codice: '830005139', id: 'TRN042' }  // Musiano - Pian di Macina
];

const TOLLERANZA_FORMA = 8; // metri

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
  const parti = String(orario || '').split(':');
  if (parti.length < 2) return NaN;
  return parseInt(parti[0], 10) * 3600 + parseInt(parti[1], 10) * 60 + parseInt(parti[2] || '0', 10);
}

function maschera(riga) {
  const giorni = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let valore = 0;
  giorni.forEach((giorno, indice) => {
    if (riga[giorno] === '1') valore |= 1 << indice;
  });
  return valore;
}

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
      if (lunghezza2 === 0) distanza2 = (x - x1) * (x - x1) + (y - y1) * (y - y1);
      else {
        const t = ((x - x1) * dx + (y - y1) * dy) / lunghezza2;
        distanza2 = (x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2;
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

function proietta(punti, coord, da) {
  let migliore = da;
  let minima = Infinity;
  for (let i = da; i < punti.length; i += 1) {
    const dLat = punti[i][0] - coord[0];
    const dLon = punti[i][1] - coord[1];
    const distanza = dLat * dLat + dLon * dLon;
    if (distanza < minima) { minima = distanza; migliore = i; }
  }
  return migliore;
}

function nomeLinea(route) {
  const corto = String(route.route_short_name || '').trim();
  const suffisso = corto.includes('_') ? corto.split('_').pop() : corto;
  if (suffisso && !/^\d+$/.test(suffisso)) return suffisso;
  const lungo = String(route.route_long_name || '').trim();
  const nomi = {
    'Regionale': 'REG',
    'Regionale Veloce': 'RV',
    'Intercity': 'IC',
    'InterCityNotte': 'ICN',
    'Frecciarossa': 'FR',
    'Frecciargento': 'FA',
    'Frecciabianca': 'FB',
    'Eurocity': 'EC',
    'Euronight': 'EN',
    'Metropolitano': 'MET'
  };
  return nomi[lungo] || lungo || corto || 'TRENO';
}

function main() {
  const cartella = process.argv[2] || '.tmp-treni/gtfs';
  const orariPath = process.argv[3] || path.join('data', 'orari.json');
  const tracciatiPath = process.argv[4] || path.join('data', 'tracciati.json');
  const file = (nome) => path.join(cartella, nome);

  const orari = JSON.parse(fs.readFileSync(orariPath, 'utf8'));
  const tracciati = JSON.parse(fs.readFileSync(tracciatiPath, 'utf8'));
  if (orari.fermate.some((id) => /^TRN/.test(id))) {
    console.error('orari.json contiene già stazioni TRN: rigenera prima il dataset bus con preprocess-orari.js.');
    process.exit(1);
  }
  if (tracciati.corse.length !== orari.corse.length) {
    console.error('tracciati.corse e orari.corse non sono allineati: rigenera entrambi dal GTFS bus.');
    process.exit(1);
  }

  const baseFermate = orari.fermate.length;
  const baseLinee = orari.linee.length;
  const baseServizi = orari.servizi.length;
  const baseCorse = orari.corse.length;

  const stops = leggiCsv(file('stops.txt'));
  const targetPerCodice = new Map(STAZIONI.map((s) => [s.codice, s.id]));
  const targetPerStopId = new Map();
  const coordinate = new Map();
  stops.forEach((r) => {
    const id = targetPerCodice.get(r.stop_code);
    if (!id) return;
    targetPerStopId.set(r.stop_id, id);
    const lat = parseFloat(r.stop_lat);
    const lon = parseFloat(r.stop_lon);
    if (r.location_type === '1' && isFinite(lat) && isFinite(lon)) coordinate.set(id, [lat, lon]);
  });
  stops.forEach((r) => {
    if (r.parent_station && targetPerStopId.has(r.parent_station)) {
      targetPerStopId.set(r.stop_id, targetPerStopId.get(r.parent_station));
    }
  });
  STAZIONI.forEach((s) => {
    if (coordinate.has(s.id)) return;
    const r = stops.find((x) => x.stop_code === s.codice);
    if (r) coordinate.set(s.id, [parseFloat(r.stop_lat), parseFloat(r.stop_lon)]);
  });
  // Il GTFS ha una coordinata errata per Rastignano (la sposta vicino a
  // Musiano): l'override mantiene la proiezione della forma nell'ordine giusto.
  STAZIONI.forEach((s) => {
    if (s.coordinate) coordinate.set(s.id, s.coordinate);
  });
  if (STAZIONI.some((s) => !coordinate.has(s.id))) {
    console.error('Coordinate mancanti per una stazione ferroviaria.');
    process.exit(1);
  }

  const routes = new Map(leggiCsv(file('routes.txt')).map((r) => [r.route_id, r]));
  const trips = new Map(leggiCsv(file('trips.txt')).map((r) => [r.trip_id, r]));

  const passaggi = new Map();
  leggiCsv(file('stop_times.txt')).forEach((r) => {
    const target = targetPerStopId.get(r.stop_id);
    if (!target) return;
    if (!passaggi.has(r.trip_id)) passaggi.set(r.trip_id, []);
    passaggi.get(r.trip_id).push({
      seq: parseInt(r.stop_sequence, 10) || 0,
      target: target,
      arrivo: r.arrival_time,
      partenza: r.departure_time,
      salita: r.pickup_type,
      discesa: r.drop_off_type
    });
  });

  const valide = [];
  passaggi.forEach((righe, tripId) => {
    const trip = trips.get(tripId);
    if (!trip) return;
    const route = routes.get(trip.route_id);
    if (!route || parseInt(route.route_type, 10) !== 2) return;
    righe.sort((a, b) => a.seq - b.seq);
    const sequenza = [];
    let vietata = false;
    righe.forEach((r) => {
      if (r.salita === '1') { vietata = true; return; }
      if (sequenza.length && sequenza[sequenza.length - 1].target === r.target) return;
      sequenza.push(r);
    });
    if (vietata || sequenza.length < 2) return;
    const tempi = sequenza.map((r, i) => secondi(i === sequenza.length - 1 ? (r.arrivo || r.partenza) : (r.partenza || r.arrivo)));
    if (tempi.some((t) => !isFinite(t))) return;
    for (let i = 1; i < tempi.length; i += 1) if (tempi[i] <= tempi[i - 1]) return;
    valide.push({ trip: trip, route: route, sequenza: sequenza, tempi: tempi });
  });

  if (!valide.length) {
    console.error('Nessuna corsa ferroviaria utile trovata nel GTFS.');
    process.exit(1);
  }

  const calendario = new Map();
  leggiCsv(file('calendar.txt')).forEach((r) => calendario.set(r.service_id, r));
  const serviziUsati = new Set(valide.map((v) => v.trip.service_id));
  const eccezioniPerServizio = new Map();
  leggiCsv(file('calendar_dates.txt')).forEach((r) => {
    if (!serviziUsati.has(r.service_id)) return;
    if (!eccezioniPerServizio.has(r.service_id)) eccezioniPerServizio.set(r.service_id, []);
    eccezioniPerServizio.get(r.service_id).push(r);
  });

  const indiceServizio = new Map();
  const servizi = [];
  serviziUsati.forEach((serviceId) => {
    const cal = calendario.get(serviceId);
    const eccezioni = eccezioniPerServizio.get(serviceId) || [];
    let inizio;
    let fine;
    let mask;
    if (cal) {
      mask = maschera(cal);
      inizio = parseInt(cal.start_date, 10);
      fine = parseInt(cal.end_date, 10);
    } else {
      const dateAggiunte = eccezioni
        .filter((e) => e.exception_type === '1')
        .map((e) => parseInt(e.date, 10))
        .filter((n) => isFinite(n))
        .sort((a, b) => a - b);
      if (!dateAggiunte.length) return;
      mask = 0;
      inizio = dateAggiunte[0];
      fine = dateAggiunte[dateAggiunte.length - 1];
    }
    indiceServizio.set(serviceId, servizi.length);
    servizi.push([mask, inizio, fine]);
  });

  const corseUtili = valide.filter((v) => indiceServizio.has(v.trip.service_id));
  if (!corseUtili.length) {
    console.error('Nessuna corsa con calendario valido.');
    process.exit(1);
  }

  const indiceFermata = new Map();
  STAZIONI.forEach((s) => {
    if (corseUtili.some((v) => v.sequenza.some((r) => r.target === s.id))) {
      indiceFermata.set(s.id, orari.fermate.length);
      orari.fermate.push(s.id);
    }
  });

  const indiceLinea = new Map();
  const linee = [];
  corseUtili.forEach((v) => {
    const routeId = v.route.route_id;
    if (indiceLinea.has(routeId)) return;
    indiceLinea.set(routeId, baseLinee + linee.length);
    linee.push([nomeLinea(v.route), 2]);
  });
  linee.forEach((linea) => orari.linee.push(linea));

  eccezioniPerServizio.forEach((eccezioni, serviceId) => {
    const indice = indiceServizio.get(serviceId);
    if (indice === undefined) return;
    eccezioni.forEach((e) => {
      const data = e.date;
      if (!orari.eccezioni[data]) orari.eccezioni[data] = { a: [], r: [] };
      const elenco = e.exception_type === '1' ? orari.eccezioni[data].a : orari.eccezioni[data].r;
      const valore = baseServizi + indice;
      if (!elenco.includes(valore)) elenco.push(valore);
    });
  });
  servizi.forEach((servizio) => orari.servizi.push(servizio));

  const corse = corseUtili.map((v) => {
    const fermate = v.sequenza.map((r) => indiceFermata.get(r.target));
    const voce = [indiceLinea.get(v.route.route_id), baseServizi + indiceServizio.get(v.trip.service_id), fermate[0], v.tempi[0]];
    for (let i = 1; i < fermate.length; i += 1) {
      voce.push(fermate[i] - fermate[i - 1]);
      voce.push(v.tempi[i] - v.tempi[i - 1]);
    }
    return { voce: voce, viaggio: v, fermate: fermate };
  });
  corse.forEach((c) => orari.corse.push(c.voce));

  // Tracciati ferroviari: solo le forme usate dalle corse incluse.
  const formeUsate = new Set(corse.map((c) => c.viaggio.trip.shape_id).filter(Boolean));
  const puntiForma = new Map();
  if (formeUsate.size) {
    const grezzi = new Map();
    leggiCsv(file('shapes.txt')).forEach((r) => {
      if (!formeUsate.has(r.shape_id)) return;
      const lat = parseFloat(r.shape_pt_lat);
      const lon = parseFloat(r.shape_pt_lon);
      if (!isFinite(lat) || !isFinite(lon)) return;
      if (!grezzi.has(r.shape_id)) grezzi.set(r.shape_id, []);
      grezzi.get(r.shape_id).push({ ordine: parseInt(r.shape_pt_sequence, 10) || 0, punto: [lat, lon] });
    });
    grezzi.forEach((elenco, shapeId) => {
      elenco.sort((a, b) => a.ordine - b.ordine);
      const puliti = [];
      elenco.forEach((voce) => {
        const ultimo = puliti[puliti.length - 1];
        if (!ultimo || ultimo[0] !== voce.punto[0] || ultimo[1] !== voce.punto[1]) puliti.push(voce.punto);
      });
      if (puliti.length >= 2) puntiForma.set(shapeId, semplifica(puliti, TOLLERANZA_FORMA));
    });
  }

  const forme = [];
  const posizioni = [];
  const indiceForma = new Map();
  const formaPerCorsa = [];
  corse.forEach((c) => {
    const shapeId = c.viaggio.trip.shape_id;
    let forma = -1;
    if (shapeId && puntiForma.has(shapeId)) {
      const chiave = shapeId + '|' + c.fermate.join('-');
      if (!indiceForma.has(chiave)) {
        const punti = puntiForma.get(shapeId);
        const tabella = [];
        let precedente = 0;
        let ok = true;
        c.viaggio.sequenza.forEach((r, i) => {
          const coord = coordinate.get(r.target);
          const posizione = proietta(punti, coord, precedente);
          if (i > 0 && posizione <= precedente) { ok = false; return; }
          tabella.push(c.fermate[i], posizione);
          precedente = posizione;
        });
        if (!ok || tabella.length < 4 || tabella[1] >= tabella[tabella.length - 1]) {
          indiceForma.set(chiave, -1);
        } else {
          const inizio = tabella[1];
          const fine = tabella[tabella.length - 1];
          const tagliata = punti.slice(inizio, fine + 1);
          const tabellaTagliata = tabella.map((valore, i) => (i % 2 === 0 ? valore : valore - inizio));
          indiceForma.set(chiave, tracciati.forme.length + forme.length);
          forme.push(polilinea(tagliata));
          posizioni.push(tabellaTagliata);
        }
      }
      forma = indiceForma.get(chiave);
    }
    formaPerCorsa.push(forma);
  });
  forme.forEach((forma) => tracciati.forme.push(forma));
  posizioni.forEach((posizione) => tracciati.posizioni.push(posizione));
  formaPerCorsa.forEach((forma) => tracciati.corse.push(forma));
  if (tracciati.corse.length !== orari.corse.length) {
    console.error('Errore: tracciati.corse non allineato dopo l\'unione.');
    process.exit(1);
  }

  orari.aggiornato = new Date().toISOString().slice(0, 10);
  tracciati.aggiornato = orari.aggiornato;
  fs.writeFileSync(orariPath, JSON.stringify(orari));
  fs.writeFileSync(orariPath + '.gz', zlib.gzipSync(fs.readFileSync(orariPath), { level: 9 }));
  fs.writeFileSync(tracciatiPath, JSON.stringify(tracciati));
  fs.writeFileSync(tracciatiPath + '.gz', zlib.gzipSync(fs.readFileSync(tracciatiPath), { level: 9 }));

  console.log('Fatto.');
  console.log('  fermate bus   ' + baseFermate);
  console.log('  fermate treno ' + (orari.fermate.length - baseFermate) + ' (' + STAZIONI.map((s) => s.id).join(', ') + ')');
  console.log('  linee treno   ' + linee.length);
  console.log('  corse treno   ' + corse.length);
  console.log('  forme treno   ' + forme.length + '/' + corse.length);
  console.log('  corse totali  ' + orari.corse.length);
  console.log('  file          ' + orariPath + ' · ' + (fs.statSync(orariPath).size / 1024 / 1024).toFixed(2) + ' MB');
}

main();
