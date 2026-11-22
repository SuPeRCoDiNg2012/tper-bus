/**
 * preprocess-gtfs.js
 *
 * Script gratuito (Node.js, nessuna dipendenza esterna) che legge il feed GTFS
 * ufficiale di TPER e genera il file "linee-per-fermata.json" usato dall'app.
 *
 * Il GTFS completo è troppo pesante per essere scaricato e processato nel
 * browser ad ogni visita: lo si elabora UNA VOLTA (o quando TPER aggiorna il
 * feed) con questo script, e si pubblica solo il JSON risultante, molto più
 * leggero.
 *
 * COME USARLO
 * 1) Scarica lo ZIP del GTFS TPER (gomma/bus) dalla pagina open data ufficiale:
 *      https://solweb.tper.it/web/tools/open-data/open-data-download.aspx
 *    Estrai lo ZIP in una cartella, ad es. ./gtfs-tper/
 *    (Dentro troverai: stops.txt, routes.txt, trips.txt, stop_times.txt, ecc.)
 *
 * 2) Esegui:
 *      node scripts/preprocess-gtfs.js ./gtfs-tper ./data/linee-per-fermata.json
 *
 * 3) Il file generato ha la struttura:
 *      { "id_fermata": ["linea1", "linea2", ...] }
 *
 * Nessuna libreria esterna richiesta: usa solo i moduli nativi di Node.js
 * (fs, path, readline), quindi non servono "npm install" né account di alcun
 * tipo. Node.js stesso è gratuito e open source (nodejs.org).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function leggiCsv(filePath) {
  const righe = [];
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let intestazione = null;
  for await (const riga of rl) {
    if (riga.trim() === '') continue;
    const campi = parseCsvRiga(riga);
    if (!intestazione) {
      intestazione = campi;
      continue;
    }
    const obj = {};
    intestazione.forEach((chiave, i) => { obj[chiave.trim()] = (campi[i] || '').trim(); });
    righe.push(obj);
  }
  return righe;
}

// Parser CSV minimale (gestisce i campi tra virgolette con virgole interne)
function parseCsvRiga(riga) {
  const risultato = [];
  let corrente = '';
  let dentroVirgolette = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (c === '"') {
      dentroVirgolette = !dentroVirgolette;
    } else if (c === ',' && !dentroVirgolette) {
      risultato.push(corrente);
      corrente = '';
    } else {
      corrente += c;
    }
  }
  risultato.push(corrente);
  return risultato;
}

async function main() {
  const cartellaGtfs = process.argv[2] || './gtfs-tper';
  const outputPath = process.argv[3] || './data/linee-per-fermata.json';

  const stopTimesPath = path.join(cartellaGtfs, 'stop_times.txt');
  const tripsPath = path.join(cartellaGtfs, 'trips.txt');
  const routesPath = path.join(cartellaGtfs, 'routes.txt');

  for (const p of [stopTimesPath, tripsPath, routesPath]) {
    if (!fs.existsSync(p)) {
      console.error(`File GTFS mancante: ${p}`);
      console.error('Verifica di aver estratto correttamente lo ZIP del feed TPER.');
      process.exit(1);
    }
  }

  console.log('Lettura routes.txt...');
  const routes = await leggiCsv(routesPath);
  const nomeLineaPerRouteId = new Map();
  routes.forEach(r => {
    const nome = r.route_short_name || r.route_long_name || r.route_id;
    nomeLineaPerRouteId.set(r.route_id, nome);
  });

  console.log('Lettura trips.txt...');
  const trips = await leggiCsv(tripsPath);
  const routeIdPerTripId = new Map();
  trips.forEach(t => { routeIdPerTripId.set(t.trip_id, t.route_id); });

  console.log('Lettura stop_times.txt (può richiedere qualche minuto su feed grandi)...');
  const stopTimes = await leggiCsv(stopTimesPath);

  const lineePerFermata = {};
  stopTimes.forEach(st => {
    const routeId = routeIdPerTripId.get(st.trip_id);
    const nomeLinea = nomeLineaPerRouteId.get(routeId);
    if (!nomeLinea || !st.stop_id) return;
    if (!lineePerFermata[st.stop_id]) lineePerFermata[st.stop_id] = new Set();
    lineePerFermata[st.stop_id].add(nomeLinea);
  });

  const output = {};
  Object.keys(lineePerFermata).forEach(id => {
    output[id] = Array.from(lineePerFermata[id]).sort();
  });

  fs.writeFileSync(outputPath, JSON.stringify({
    aggiornato: new Date().toISOString().slice(0, 10),
    fonte: 'Generato da feed GTFS TPER ufficiale tramite scripts/preprocess-gtfs.js',
    linee: output
  }, null, 2));

  console.log(`Fatto. Scritte ${Object.keys(output).length} fermate in ${outputPath}`);
}

main().catch(err => {
  console.error('Errore durante il preprocessing:', err);
  process.exit(1);
});
