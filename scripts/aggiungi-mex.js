#!/usr/bin/env node
/**
 * aggiungi-mex.js
 *
 * Aggiunge al dataset le corse del people mover Marconi Express (MEX),
 * Bologna Centrale FS – Lazzaretto – Aeroporto, dal GTFS ufficiale TPER:
 *
 *   https://solweb.tper.it/web/tools/open-data/open-data-download.aspx
 *     ?source=solweb.tper.it&filename=gtfsmex&version=YYYYMMDD&format=zip
 *
 * USO
 *   node scripts/aggiungi-mex.js cartella-gtfs-mex \
 *     data/orari.json data/tracciati.json data/fermate.json
 *
 * Il file orari.json deve essere già stato completato con i treni: lo script
 * aggiunge le fermate MEX mancanti, ma non rigenera il dataset bus.
 *
 * Le corse MEX hanno un calendario fatto solo di calendar_dates.txt (un
 * servizio diverso per ogni giorno della settimana, con le date esatte). Il
 * dataset dell'app usa una maschera settimanale più le eccezioni: qui la
 * maschera resta 0 e ogni data del GTFS diventa un'eccezione, così non si
 * inventano giorni di servizio.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RADICE = path.join(__dirname, '..');
const CARTELLA_GTFS = process.argv[2] || path.join(RADICE, '.tmp-dati', 'gtfs-mex');
const FILE_ORARI = process.argv[3] || path.join(RADICE, 'data', 'orari.json');
const FILE_TRACCIATI = process.argv[4] || path.join(RADICE, 'data', 'tracciati.json');
const FILE_FERMATE = process.argv[5] || path.join(RADICE, 'data', 'fermate.json');

const LINEA = 'MEX';
// stop_id GTFS -> fermata dell'app. BFS è la stazione già presente; LAZ e BLQ
// sono fermate nuove perché le omonime fermate bus non sono la monorotaia.
const FERMATE = [
  { gtfs: 'BFS', id: 'TRN001', nome: 'Bologna - Stazione Centrale', tipo: 'entrambi', zona: '500', lat: 44.50720280, lon: 11.34289483 },
  { gtfs: 'LAZ', id: 'TRN043', nome: 'Lazzaretto - Stazione', tipo: 'treno', zona: '500', lat: 44.51792, lon: 11.31785 },
  { gtfs: 'BLQ', id: 'TRN044', nome: 'Bologna - Aeroporto', tipo: 'treno', zona: '500', lat: 44.52876, lon: 11.29440 }
];

function errore(messaggio) {
  console.error('Errore: ' + messaggio);
  process.exit(1);
}

function leggiCsv(percorso) {
  if (!fs.existsSync(percorso)) errore('file GTFS non trovato: ' + percorso);
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
  if (!intestazioni) errore('CSV vuoto: ' + percorso);
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

function scriviJSON(percorso, valore) {
  fs.writeFileSync(percorso, JSON.stringify(valore));
}

function scriviJSONLeggibile(percorso, valore) {
  const originale = fs.readFileSync(percorso, 'utf8');
  const testo = JSON.stringify(valore, null, 2) + '\n';
  fs.writeFileSync(percorso, originale.includes('\r\n') ? testo.replace(/\n/g, '\r\n') : testo);
}

function aggiungiFermate(fermateFile, orari) {
  const perId = new Map(FERMATE.map((f) => [f.id, f]));
  let nuove = 0;
  FERMATE.forEach((fermata) => {
    const esistente = fermateFile.fermate.find((f) => f.id === fermata.id);
    if (!esistente) {
      fermateFile.fermate.push({
        id: fermata.id,
        nome: fermata.nome,
        tipo: fermata.tipo,
        zona: fermata.zona,
        lat: fermata.lat,
        lon: fermata.lon
      });
      nuove += 1;
    }
  });
  FERMATE.forEach((fermata) => {
    if (!orari.fermate.includes(fermata.id)) orari.fermate.push(fermata.id);
    if (!perId.has(fermata.id)) errore('fermata non configurata: ' + fermata.id);
  });
  return nuove;
}

function main() {
  const file = (nome) => path.join(CARTELLA_GTFS, nome);
  const orari = JSON.parse(fs.readFileSync(FILE_ORARI, 'utf8'));
  const tracciati = JSON.parse(fs.readFileSync(FILE_TRACCIATI, 'utf8'));
  const fermateFile = JSON.parse(fs.readFileSync(FILE_FERMATE, 'utf8'));

  if (tracciati.corse.length !== orari.corse.length) {
    errore('tracciati.corse e orari.corse non sono allineati: rigenera entrambi dal dataset bus.');
  }
  if (orari.linee.some((linea) => linea[0] === LINEA)) {
    errore('la linea ' + LINEA + ' è già presente: rigenera il dataset prima di rieseguire lo script.');
  }

  const routes = leggiCsv(file('routes.txt'));
  const route = routes.find((r) => r.route_id === LINEA);
  if (!route) errore('route_id ' + LINEA + ' assente dal GTFS MEX');
  if (parseInt(route.route_type, 10) !== 12) {
    errore('route_type inatteso per ' + LINEA + ': ' + route.route_type);
  }

  const stops = new Map(leggiCsv(file('stops.txt')).map((s) => [s.stop_id, s]));
  const stopGtfs = new Map(FERMATE.map((f) => [f.gtfs, f.id]));
  const coordinate = new Map();
  FERMATE.forEach((f) => {
    const s = stops.get(f.gtfs);
    if (!s) errore('stop_id GTFS assente: ' + f.gtfs);
    const lat = parseFloat(s.stop_lat);
    const lon = parseFloat(s.stop_lon);
    if (!isFinite(lat) || !isFinite(lon)) errore('coordinate non valide per ' + f.gtfs);
    coordinate.set(f.id, [lat, lon]);
  });

  const trips = new Map(leggiCsv(file('trips.txt'))
    .filter((t) => t.route_id === LINEA)
    .map((t) => [t.trip_id, t]));
  if (!trips.size) errore('nessuna corsa MEX nel GTFS');

  const passaggi = new Map();
  leggiCsv(file('stop_times.txt')).forEach((r) => {
    if (!trips.has(r.trip_id)) return;
    if (!passaggi.has(r.trip_id)) passaggi.set(r.trip_id, []);
    passaggi.get(r.trip_id).push(r);
  });

  // Le uniche sequenze ammesse sono i due versi della linea.
  const sequenze = new Set([
    FERMATE.map((f) => f.id).join('|'),
    FERMATE.slice().reverse().map((f) => f.id).join('|')
  ]);
  const valide = [];
  trips.forEach((trip, tripId) => {
    const righe = (passaggi.get(tripId) || []).slice()
      .sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    const ids = righe.map((r) => stopGtfs.get(r.stop_id)).filter(Boolean);
    if (ids.length !== 3 || !sequenze.has(ids.join('|'))) return;
    if (righe.some((r) => r.pickup_type === '1' || r.drop_off_type === '1')) return;
    const tempi = righe.map((r) => secondi(r.departure_time || r.arrival_time));
    if (tempi.some((t) => !isFinite(t))) return;
    for (let i = 1; i < tempi.length; i += 1) if (tempi[i] <= tempi[i - 1]) return;
    valide.push({
      trip,
      fermate: ids,
      tempi,
      servizio: trip.service_id,
      shape: trip.shape_id
    });
  });
  if (!valide.length) errore('nessuna corsa MEX valida: fermate o orari inattesi');
  if (valide.length !== trips.size) {
    errore('corse MEX scartate: ' + (trips.size - valide.length) + '/' + trips.size);
  }

  const dateServizio = new Map();
  leggiCsv(file('calendar_dates.txt')).forEach((r) => {
    if (r.exception_type !== '1') return;
    if (!dateServizio.has(r.service_id)) dateServizio.set(r.service_id, []);
    dateServizio.get(r.service_id).push(r.date);
  });

  const serviziUsati = Array.from(new Set(valide.map((v) => v.servizio))).sort();
  const indiceServizio = new Map();
  const servizi = [];
  serviziUsati.forEach((serviceId) => {
    const date = (dateServizio.get(serviceId) || []).slice().sort();
    if (!date.length) errore('servizio MEX senza date: ' + serviceId);
    indiceServizio.set(serviceId, orari.servizi.length + servizi.length);
    servizi.push([0, parseInt(date[0], 10), parseInt(date[date.length - 1], 10)]);
  });

  const indiceLinea = orari.linee.length;
  // L'app usa 2 per le linee ferroviarie (RAPTOR, cambi, badge e mappa);
  // MEX è una monorotaia, non un autobus, quindi resta in questa famiglia.
  orari.linee.push([LINEA, 2]);
  servizi.forEach((servizio) => orari.servizi.push(servizio));
  const nuoveFermate = aggiungiFermate(fermateFile, orari);

  serviziUsati.forEach((serviceId) => {
    const indice = indiceServizio.get(serviceId);
    (dateServizio.get(serviceId) || []).forEach((data) => {
      if (!orari.eccezioni[data]) orari.eccezioni[data] = { a: [], r: [] };
      if (!orari.eccezioni[data].a.includes(indice)) orari.eccezioni[data].a.push(indice);
    });
  });

  const formeGrezze = new Map();
  leggiCsv(file('shapes.txt')).forEach((r) => {
    const lat = parseFloat(r.shape_pt_lat);
    const lon = parseFloat(r.shape_pt_lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    if (!formeGrezze.has(r.shape_id)) formeGrezze.set(r.shape_id, []);
    formeGrezze.get(r.shape_id).push({
      ordine: parseInt(r.shape_pt_sequence, 10) || 0,
      punto: [lat, lon]
    });
  });

  const forme = new Map();
  function formaPer(shapeId, ids) {
    const chiave = shapeId + '|' + ids.join('-');
    if (forme.has(chiave)) return forme.get(chiave);
    const grezza = (formeGrezze.get(shapeId) || []).slice()
      .sort((a, b) => a.ordine - b.ordine)
      .map((v) => v.punto);
    const punti = semplifica(grezza, 2);
    if (punti.length < 2) errore('forma MEX non valida: ' + shapeId);
    let da = 0;
    const posizioni = [];
    ids.forEach((id) => {
      const posizione = proietta(punti, coordinate.get(id), da);
      posizioni.push(id, posizione);
      da = posizione;
    });
    const indice = tracciati.forme.length;
    tracciati.forme.push(polilinea(punti));
    tracciati.posizioni.push(posizioni.map((valore, i) => {
      if (i % 2 === 0) return orari.fermate.indexOf(valore);
      return valore;
    }));
    forme.set(chiave, indice);
    return indice;
  }

  const nuoveForme = new Set();
  valide.forEach((corsa) => {
    const forma = formaPer(corsa.shape, corsa.fermate);
    nuoveForme.add(forma);
  });

  valide.forEach((corsa) => {
    const indiceFermata = corsa.fermate.map((id) => orari.fermate.indexOf(id));
    if (indiceFermata.some((i) => i < 0)) errore('fermata MEX non presente negli orari');
    const voce = [
      indiceLinea,
      indiceServizio.get(corsa.servizio),
      indiceFermata[0],
      corsa.tempi[0]
    ];
    for (let i = 1; i < indiceFermata.length; i += 1) {
      voce.push(indiceFermata[i] - indiceFermata[i - 1]);
      voce.push(corsa.tempi[i] - corsa.tempi[i - 1]);
    }
    orari.corse.push(voce);
    tracciati.corse.push(forme.get(corsa.shape + '|' + corsa.fermate.join('-')));
  });

  if (tracciati.corse.length !== orari.corse.length) {
    errore('allineamento corse/forme fallito dopo MEX');
  }

  orari.aggiornato = new Date().toISOString().slice(0, 10);
  tracciati.aggiornato = orari.aggiornato;
  fermateFile.aggiornato = orari.aggiornato;
  scriviJSON(FILE_ORARI, orari);
  fs.writeFileSync(FILE_ORARI + '.gz', zlib.gzipSync(fs.readFileSync(FILE_ORARI), { level: 9 }));
  scriviJSON(FILE_TRACCIATI, tracciati);
  fs.writeFileSync(FILE_TRACCIATI + '.gz', zlib.gzipSync(fs.readFileSync(FILE_TRACCIATI), { level: 9 }));
  scriviJSONLeggibile(FILE_FERMATE, fermateFile);

  console.log('Fatto.');
  console.log('  fermate MEX   ' + nuoveFermate + ' nuove (' + FERMATE.map((f) => f.id).join(', ') + ')');
  console.log('  servizi MEX   ' + servizi.length);
  console.log('  corse MEX     ' + valide.length + ' (' + valide.filter((c) => c.fermate[0] === 'TRN001').length + ' andata, ' +
    valide.filter((c) => c.fermate[0] === 'TRN044').length + ' ritorno)');
  console.log('  forme MEX     ' + nuoveForme.size);
  console.log('  corse totali  ' + orari.corse.length);
  console.log('  file          ' + FILE_ORARI + ' · ' + (fs.statSync(FILE_ORARI).size / 1024 / 1024).toFixed(2) + ' MB');
}

if (require.main === module) main();
