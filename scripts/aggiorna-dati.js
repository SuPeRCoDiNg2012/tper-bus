#!/usr/bin/env node
/**
 * aggiorna-dati.js
 *
 * Rifà da capo il dataset dell'app con le fonti ufficiali e lo lascia in
 * `data/` pronto da committare. È lo stesso giro che fa ogni notte il workflow
 * `.github/workflows/aggiorna-dati.yml`.
 *
 * FASI
 *   1. fermate bus     export Opendatasoft del Comune di Bologna; se non
 *                      risponde, CKAN regionale e infine il servizio XML TPER
 *                      OpenDataLineeFermate (stessa granularità fermata+linea)
 *   2. conversione     scripts/converti-fermate-autobus.py
 *   3. GTFS TPER       versione corrente letta da SolWeb, oppure VERSIONE_GTFS
 *   4. orari e colori  scripts/preprocess-orari.js + estrai-colori-linee.py
 *   5. treni           GTFS nazionale (URL_GTFS_TRENI) e PDF S2A/S1 (URL_PDF_TRENI, URL_PDF_S1)
 *   6. geometrie       scripts/ricostruisci-tracciati.js --scrivi (Overpass)
 *   7. gzip, controlli di sanità, confronto con i dati precedenti
 *
 * SICUREZZA
 * Prima di toccare `data/` salva una copia in `.tmp-dati/prima`. Se una fase
 * fallisce, se il dataset nuovo perde più del 10% delle fermate o delle corse,
 * se manca la voce di un treno o se `npm test` non passa, ripristina la copia
 * ed esce con errore: non si pubblicano dati a metà. Se il contenuto è identico
 * a parte la data, ripristina e non scrive nulla, così la cronologia Git non
 * cresce a vuoto.
 *
 * REQUISITI
 *   Node.js 18+, Python 3, `unzip`, `pdftotext` (pacchetto poppler-utils) e
 *   rete. Su Ubuntu: `sudo apt-get install -y poppler-utils unzip`.
 *
 * USO
 *   node scripts/aggiorna-dati.js
 *   VERSIONE_GTFS=20261201 node scripts/aggiorna-dati.js
 *
 * VARIABILI D'AMBIENTE (tutte opzionali, servono quando una fonte cambia URL)
 *   URL_FERMATE       JSON delle fermate (salta la scoperta CKAN/ODS)
 *   URL_GTFS_TPER     zip GTFS TPER (salta la lettura della versione)
 *   VERSIONE_GTFS     versione GTFS TPER nel formato YYYYMMDD
 *   URL_GTFS_TRENI    zip GTFS nazionale Trenitalia
 *   URL_PDF_TRENI     PDF degli orari ferroviari locali S2A
 *   URL_PDF_S1        PDF degli orari ferroviari locali S1 Porretta
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const RADICE = path.join(__dirname, '..');
const DATA = path.join(RADICE, 'data');
const TMP = path.join(RADICE, '.tmp-dati');
const PRIMA = path.join(TMP, 'prima');

const UA = 'MuoviBologna/1.0 (aggiornamento dati)';
const CKAN_FERMATE = 'https://dati.emilia-romagna.it/api/3/action/package_show?id=tper-fermate-autobus';
const ODS_FERMATE = 'https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/tper-fermate-autobus/exports/json';
const ODS_FERMATE_V2 = 'https://opendata.comune.bologna.it/api/v2/catalog/datasets/tper-fermate-autobus/exports/json';
const FERMATE_TPER = 'https://solwsweb.tper.it/web-services/open-data.asmx/OpenDataLineeFermate';
const DETTAGLIO_GTFS = 'https://solweb.tper.it/web/tools/open-data/open-data-detail.aspx?filename=gommagtfsbo';
const BASE_DOWNLOAD_GTFS = 'https://solweb.tper.it/web/tools/open-data/open-data-download.aspx';
const GTFS_TRENI_PREDEFINITO = 'https://github.com/deryclem/trenitalia-gtfs/raw/main/gtfs-trenitalia.zip';
const PDF_TRENI_PREDEFINITO = 'https://s3.eu-south-1.amazonaws.com/static.tper.it/orari/20251213treni/tper_trbovi.pdf';
const PDF_S1_PREDEFINITO = 'https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S1_Porretta-Bologna-Pianoro.pdf';

// File che compongono il dataset pubblicato: sono quelli salvati e ripristinati.
const FILE_DATI = [
  'fermate.json',
  'linee-per-fermata.json',
  'orari.json',
  'orari.json.gz',
  'tracciati.json',
  'tracciati.json.gz',
  'linee-colori.json'
];

const SOGLIA_RIDUZIONE = 0.9;

/* ------------------------------------------------------------------ *
 * Funzioni pure (coperte da tests/aggiorna-dati.test.js)
 * ------------------------------------------------------------------ */

/** Versione GTFS dalla pagina di dettaglio SolWeb ("Versione: 20261123"). */
function versioneDaDettaglio(html) {
  const testo = String(html || '');
  const diretta = testo.match(/versione[^0-9]{0,30}(\d{8})/i);
  if (diretta) return diretta[1];
  const dalLink = testo.match(/version=(\d{8})/i);
  return dalLink ? dalLink[1] : null;
}

/** URL di download del GTFS TPER per una versione YYYYMMDD. */
function urlGtfs(versione) {
  return BASE_DOWNLOAD_GTFS +
    '?source=solweb.tper.it&filename=gommagtfsbo&version=' + versione + '&format=zip';
}

/**
 * Risorsa JSON "piatta" del dataset CKAN, oppure null.
 * Il dataset espone anche JSON-LD, JSON Lines, GeoJSON e RDF: quelli non
 * vanno bene, il convertitore si aspetta un elenco di record con `codice`.
 */
function risorsaJsonCkan(risposta) {
  const risorse = (risposta && risposta.result && risposta.result.resources) || [];
  const trovata = risorse.find((r) => {
    const formato = String((r && r.format) || '').toLowerCase();
    const url = String((r && r.url) || '').toLowerCase();
    if (!url) return false;
    if (/jsonl|jsonld|geojson|ndjson/.test(formato + ' ' + url)) return false;
    return formato === 'json' || /\/json($|\?)/.test(url) || /\.json($|\?)/.test(url);
  });
  return trovata ? trovata.url : null;
}

/** Il file scaricato è l'elenco di record fermata+linea che serve allo script? */
function sembraDatasetFermate(dati) {
  if (!Array.isArray(dati) || dati.length < 5000) return false;
  const primo = dati[0];
  return Boolean(primo) && primo.codice !== undefined && primo.codice_zona !== undefined;
}

/** Decodifica le poche entità XML usate nei campi TPER. */
function decodificaXml(testo) {
  return String(testo || '')
    .replace(/&#(\d+);/g, (_, codice) => String.fromCodePoint(Number(codice)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codice) => String.fromCodePoint(parseInt(codice, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Estrae i record fermata+linea dal XML OpenDataLineeFermate di TPER. */
function recordFermateDaXml(xml) {
  const record = [];
  const tabelle = String(xml || '').match(/<Table\b[^>]*>[\s\S]*?<\/Table>/gi) || [];
  const campo = (blocco, nome) => {
    const trovato = blocco.match(new RegExp('<' + nome + '\\b[^>]*>([\\s\\S]*?)<\\/' + nome + '>', 'i'));
    return trovato ? decodificaXml(trovato[1]).trim() : '';
  };
  for (const blocco of tabelle) {
    const codice = campo(blocco, 'codice_fermata');
    const linea = campo(blocco, 'codice_linea');
    const zona = campo(blocco, 'codice_zona');
    if (!codice || !linea || !zona) continue;
    const latTesto = campo(blocco, 'latitudine');
    const lonTesto = campo(blocco, 'longitudine');
    const lat = Number(latTesto);
    const lon = Number(lonTesto);
    record.push({
      codice,
      codice_linea: linea,
      codice_zona: Number(zona),
      denominazione: campo(blocco, 'denominazione'),
      ubicazione: campo(blocco, 'ubicazione'),
      comune: campo(blocco, 'comune'),
      geopoint: latTesto && lonTesto && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
    });
  }
  return record;
}

/** Il dataset nuovo è accettabile rispetto a quello vecchio? */
function riduzioneAccettabile(vecchio, nuovo, soglia) {
  const limite = soglia == null ? SOGLIA_RIDUZIONE : soglia;
  if (!Number.isFinite(vecchio) || vecchio <= 0) return true;
  return Number.isFinite(nuovo) && nuovo >= Math.floor(vecchio * limite);
}

/** Copia di un dataset senza i campi che cambiano a ogni esecuzione. */
function senzaData(valore) {
  if (Array.isArray(valore)) return valore.map(senzaData);
  if (!valore || typeof valore !== 'object') return valore;
  const copia = {};
  Object.keys(valore).sort().forEach((chiave) => {
    if (chiave === 'aggiornato' || chiave === 'fonte' || chiave === 'generato') return;
    copia[chiave] = senzaData(valore[chiave]);
  });
  return copia;
}

/** Due dataset sono lo stesso contenuto, a parte la data di aggiornamento? */
function stessoContenuto(vecchio, nuovo) {
  if (!vecchio || !nuovo) return false;
  return JSON.stringify(senzaData(vecchio)) === JSON.stringify(senzaData(nuovo));
}

const API = {
  versioneDaDettaglio, urlGtfs, risorsaJsonCkan, sembraDatasetFermate,
  riduzioneAccettabile, senzaData, stessoContenuto, recordFermateDaXml,
  fondiFermatePrecedenti
};
module.exports = API;

/* ------------------------------------------------------------------ *
 * Utilità di esecuzione
 * ------------------------------------------------------------------ */

function passo(testo) {
  console.log('\n== ' + testo);
}

function percorsoData(nome) {
  return path.join(DATA, nome);
}

function leggiJSON(percorso) {
  return JSON.parse(fs.readFileSync(percorso, 'utf8'));
}

function esiste(percorso) {
  return fs.existsSync(percorso);
}

function esegui(comando, argomenti) {
  console.log('$ ' + comando + ' ' + argomenti.join(' '));
  const esito = spawnSync(comando, argomenti, { cwd: RADICE, stdio: 'inherit' });
  if (esito.error) throw new Error(comando + ' non disponibile: ' + esito.error.message);
  if (esito.status !== 0) throw new Error(comando + ' è uscito con codice ' + esito.status);
}

async function scarica(url, destinazione, minimoByte, timeoutMs) {
  if (!url) throw new Error('URL mancante');
  const risposta = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs || 180000)
  });
  if (!risposta.ok) throw new Error('HTTP ' + risposta.status + ' su ' + url);
  const dati = Buffer.from(await risposta.arrayBuffer());
  const minimo = minimoByte == null ? 1024 : minimoByte;
  if (dati.length < minimo) {
    throw new Error('risposta troppo piccola (' + dati.length + ' byte) da ' + url);
  }
  fs.mkdirSync(path.dirname(destinazione), { recursive: true });
  fs.writeFileSync(destinazione, dati);
  console.log('  scaricati ' + Math.round(dati.length / 1024) + ' KB → ' + path.relative(RADICE, destinazione));
  return dati;
}

function pausa(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

/** Riprova un download: un errore di rete o un 5xx non deve fermare la notte. */
async function scaricaConTentativi(url, destinazione, minimoByte, tentativi, timeoutMs) {
  const numero = tentativi == null ? 2 : tentativi;
  let ultimo = null;
  for (let tentativo = 1; tentativo <= numero; tentativo += 1) {
    try {
      return await scarica(url, destinazione, minimoByte, timeoutMs);
    } catch (errore) {
      ultimo = errore;
      if (tentativo < numero) {
        console.log('  tentativo ' + tentativo + ' fallito (' + errore.message + '), riprovo');
        await pausa(1500 * tentativo);
      }
    }
  }
  throw ultimo;
}

/** Scarica il XML TPER e lo converte nella forma piatta attesa dal convertitore. */
async function scaricaFermateTper(destinazione) {
  const xml = await scaricaTestoConTentativi(FERMATE_TPER, 120000);
  const record = recordFermateDaXml(xml);
  if (!sembraDatasetFermate(record)) {
    throw new Error('XML TPER senza un elenco fermata+linea utilizzabile');
  }
  fs.mkdirSync(path.dirname(destinazione), { recursive: true });
  fs.writeFileSync(destinazione, JSON.stringify(record));
  console.log('  scaricati ' + record.length + ' record fermata+linea → ' + path.relative(RADICE, destinazione));
  return record;
}

async function scaricaTesto(url, ms) {
  const risposta = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(ms || 45000)
  });
  if (!risposta.ok) throw new Error('HTTP ' + risposta.status + ' su ' + url);
  return risposta.text();
}

async function scaricaTestoConTentativi(url, ms, tentativi) {
  const numero = tentativi == null ? 2 : tentativi;
  let ultimo = null;
  for (let tentativo = 1; tentativo <= numero; tentativo += 1) {
    try {
      return await scaricaTesto(url, ms);
    } catch (errore) {
      ultimo = errore;
      if (tentativo < numero) {
        console.log('  tentativo ' + tentativo + ' fallito (' + errore.message + '), riprovo');
        await pausa(1500 * tentativo);
      }
    }
  }
  throw ultimo;
}

function scompatta(zip, cartella) {
  fs.mkdirSync(cartella, { recursive: true });
  console.log('$ unzip -o ' + path.relative(RADICE, zip) + ' -d ' + path.relative(RADICE, cartella));
  const esito = spawnSync('unzip', ['-o', '-q', zip, '-d', cartella], { encoding: 'utf8' });
  if (esito.error) throw new Error('unzip non disponibile: ' + esito.error.message);
  if (esito.status !== 0) throw new Error('unzip: ' + (esito.stderr || '').trim());
}

/* ------------------------------------------------------------------ *
 * Copia di sicurezza del dataset attuale
 * ------------------------------------------------------------------ */

function salvaCopia() {
  fs.rmSync(PRIMA, { recursive: true, force: true });
  fs.mkdirSync(PRIMA, { recursive: true });
  FILE_DATI.forEach((nome) => {
    if (esiste(percorsoData(nome))) fs.copyFileSync(percorsoData(nome), path.join(PRIMA, nome));
  });
}

function ripristina() {
  if (!esiste(PRIMA)) return false;
  FILE_DATI.forEach((nome) => {
    const copia = path.join(PRIMA, nome);
    if (esiste(copia)) fs.copyFileSync(copia, percorsoData(nome));
  });
  return true;
}

/**
 * Il XML TPER non contiene tutte le fermate storiche del dataset ODS. Se si
 * usa come ripiego, rimette le fermate bus precedenti che mancano: meglio
 * aggiornare orari e treni con qualche fermata vecchia che perdere 700 fermate.
 */
function fondiFermatePrecedenti(percorsoFermate, percorsoLinee) {
  if (!esiste(percorsoFermate) || !esiste(percorsoLinee)) return;
  const nuoveFermate = leggiJSON(percorsoFermate);
  const nuoveLinee = leggiJSON(percorsoLinee);
  const vecchieFermate = esiste(path.join(PRIMA, 'fermate.json')) ? leggiJSON(path.join(PRIMA, 'fermate.json')) : null;
  const vecchieLinee = esiste(path.join(PRIMA, 'linee-per-fermata.json')) ? leggiJSON(path.join(PRIMA, 'linee-per-fermata.json')) : null;
  if (!vecchieFermate || !Array.isArray(vecchieFermate.fermate)) return;

  const presenti = new Set(nuoveFermate.fermate.map((f) => String(f.id)));
  const mancanti = vecchieFermate.fermate.filter((f) => f.tipo === 'bus' && !presenti.has(String(f.id)));
  if (!mancanti.length) return;

  nuoveFermate.fermate.push(...mancanti);
  nuoveFermate.fermate.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it'));
  nuoveFermate.fonte = String(nuoveFermate.fonte || '') + '; fallback TPER: fermate precedenti mantenute';
  if (vecchieLinee && vecchieLinee.linee) {
    mancanti.forEach((f) => {
      const linee = vecchieLinee.linee[f.id];
      if (Array.isArray(linee) && linee.length) nuoveLinee.linee[f.id] = linee;
    });
    nuoveLinee.fonte = String(nuoveLinee.fonte || '') + '; fallback TPER: linee precedenti mantenute';
  }
  fs.writeFileSync(percorsoFermate, JSON.stringify(nuoveFermate, null, 2));
  fs.writeFileSync(percorsoLinee, JSON.stringify(nuoveLinee, null, 2));
  console.log('  fallback: mantenute ' + mancanti.length + ' fermate bus precedenti');
}

/* ------------------------------------------------------------------ *
 * Fasi
 * ------------------------------------------------------------------ */

async function faseFermate() {
  passo('Fermate bus');
  const file = path.join(TMP, 'fermate-grezze.json');

  // Candidati in ordine: URL esplicito, export Opendatasoft (v2.1 e v2),
  // poi CKAN regionale e infine il XML diretto TPER. Si tiene il primo che
  // contiene davvero i record fermata+linea.
  const candidati = [];
  if (process.env.URL_FERMATE) candidati.push({ nome: 'URL_FERMATE', url: process.env.URL_FERMATE });
  else {
    candidati.push({ nome: 'Opendatasoft Comune di Bologna', url: ODS_FERMATE });
    candidati.push({ nome: 'Opendatasoft Comune di Bologna (v2)', url: ODS_FERMATE_V2 });
  }

  let grezze = null;
  let usatoTper = false;
  const provati = new Set();
  for (const candidato of candidati) {
    if (provati.has(candidato.url)) continue;
    provati.add(candidato.url);
    try {
      console.log('  fonte: ' + candidato.nome);
      await scaricaConTentativi(candidato.url, file, 500000, 2, 90000);
      const letto = leggiJSON(file);
      if (!sembraDatasetFermate(letto)) {
        throw new Error('contenuto inatteso (non è l\'elenco dei record fermata+linea)');
      }
      grezze = letto;
      break;
    } catch (errore) {
      console.log('  ' + candidato.nome + ' scartato: ' + errore.message);
    }
  }

  // Il CKAN regionale è lento o irraggiungibile: lo si interroga solo dopo
  // che gli export ODS hanno fallito, non a ogni esecuzione.
  if (!grezze && !process.env.URL_FERMATE) {
    try {
      const json = JSON.parse(await scaricaTesto(CKAN_FERMATE, 12000));
      const url = risorsaJsonCkan(json);
      if (!url) {
        console.log('  CKAN: nessuna risorsa JSON piatta, salto');
      } else if (provati.has(url)) {
        console.log('  CKAN: stessa risorsa già provata, salto');
      } else {
        provati.add(url);
        console.log('  fonte: CKAN Regione');
        await scaricaConTentativi(url, file, 500000, 2, 90000);
        const letto = leggiJSON(file);
        if (!sembraDatasetFermate(letto)) {
          throw new Error('contenuto inatteso (non è l\'elenco dei record fermata+linea)');
        }
        grezze = letto;
      }
    } catch (errore) {
      console.log('  CKAN non utilizzabile (' + errore.message + ')');
    }
  }

  // Ultima risorsa: il servizio open data di TPER, che non passa da CKAN né
  // da Opendatasoft. Il XML contiene gli stessi campi fermata+linea.
  if (!grezze && !process.env.URL_FERMATE) {
    try {
      console.log('  fonte: TPER OpenDataLineeFermate');
      grezze = await scaricaFermateTper(file);
      usatoTper = true;
    } catch (errore) {
      console.log('  TPER OpenDataLineeFermate scartato: ' + errore.message);
    }
  }
  if (!grezze) throw new Error('nessuna fonte delle fermate utilizzabile');
  console.log('  record fermata+linea: ' + grezze.length);

  esegui('python3', [
    path.join('scripts', 'converti-fermate-autobus.py'),
    path.relative(RADICE, file),
    path.join('data', 'fermate.json'),
    path.join('data', 'linee-per-fermata.json')
  ]);
  if (usatoTper) fondiFermatePrecedenti(percorsoData('fermate.json'), percorsoData('linee-per-fermata.json'));
}

async function faseGtfs() {
  passo('GTFS TPER');
  const zip = path.join(TMP, 'gtfs-tper.zip');
  const cartella = path.join(TMP, 'gtfs-tper');

  if (process.env.URL_GTFS_TPER) {
    await scaricaConTentativi(process.env.URL_GTFS_TPER, zip, 1000000);
  } else {
    let versione = (process.env.VERSIONE_GTFS || '').trim();
    if (versione && !/^\d{8}$/.test(versione)) throw new Error('VERSIONE_GTFS non valida: ' + versione);
    if (!versione) {
      const html = await scaricaTestoConTentativi(DETTAGLIO_GTFS, 45000);
      versione = versioneDaDettaglio(html);
      if (!versione) throw new Error('versione GTFS non trovata nella pagina SolWeb');
    }
    console.log('  versione GTFS: ' + versione);
    await scaricaConTentativi(urlGtfs(versione), zip, 1000000);
  }

  fs.rmSync(cartella, { recursive: true, force: true });
  scompatta(zip, cartella);

  esegui('node', [
    path.join('scripts', 'preprocess-orari.js'),
    path.relative(RADICE, cartella),
    path.join('data', 'orari.json')
  ]);

  esegui('python3', [
    path.join('scripts', 'estrai-colori-linee.py'),
    path.join(path.relative(RADICE, cartella), 'routes.txt'),
    path.join('data', 'linee-colori.json')
  ]);
}

async function faseTreni() {
  passo('Treni');
  const urlTreni = process.env.URL_GTFS_TRENI || GTFS_TRENI_PREDEFINITO;
  const zipTreni = path.join(TMP, 'gtfs-treni.zip');
  const cartellaTreni = path.join(TMP, 'gtfs-treni');
  await scaricaConTentativi(urlTreni, zipTreni, 1000000);
  fs.rmSync(cartellaTreni, { recursive: true, force: true });
  scompatta(zipTreni, cartellaTreni);

  esegui('node', [
    path.join('scripts', 'aggiungi-treni.js'),
    path.relative(RADICE, cartellaTreni),
    path.join('data', 'orari.json'),
    path.join('data', 'tracciati.json')
  ]);

  const pdf = path.join(TMP, 'treni-locali.pdf');
  await scaricaConTentativi(process.env.URL_PDF_TRENI || PDF_TRENI_PREDEFINITO, pdf, 10000);
  esegui('node', [
    path.join('scripts', 'aggiungi-treni-locali.js'),
    '--pdf', path.relative(RADICE, pdf),
    '--scrivi'
  ]);

  const pdfS1 = path.join(TMP, 'treni-s1.pdf');
  await scaricaConTentativi(process.env.URL_PDF_S1 || PDF_S1_PREDEFINITO, pdfS1, 10000);
  esegui('node', [
    path.join('scripts', 'aggiungi-s1.js'),
    '--pdf', path.relative(RADICE, pdfS1),
    '--scrivi'
  ]);

  esegui('node', [path.join('scripts', 'ricostruisci-tracciati.js'), '--scrivi']);
}

function faseTest() {
  passo('Test dei dati');
  // Stesso comando di `npm test`, senza dipendere da npm (che su Windows è un .cmd).
  esegui(process.execPath, ['--test', 'tests']);
}

function faseGzip() {
  passo('Compressione');
  ['orari.json', 'tracciati.json'].forEach((nome) => {
    const contenuto = fs.readFileSync(percorsoData(nome));
    fs.writeFileSync(percorsoData(nome + '.gz'), zlib.gzipSync(contenuto, { level: 9 }));
    console.log('  ' + nome + '.gz: ' + Math.round(fs.statSync(percorsoData(nome + '.gz')).size / 1024) + ' KB');
  });
}

/* ------------------------------------------------------------------ *
 * Controlli di sanità
 * ------------------------------------------------------------------ */

function controlla(vecchieMisure) {
  passo('Controlli sui dati nuovi');
  const fermate = leggiJSON(percorsoData('fermate.json'));
  const orari = leggiJSON(percorsoData('orari.json'));
  const tracciati = leggiJSON(percorsoData('tracciati.json'));

  const problemi = [];
  if (!riduzioneAccettabile(vecchieMisure.fermate, fermate.fermate.length)) {
    problemi.push('fermate: ' + vecchieMisure.fermate + ' → ' + fermate.fermate.length);
  }
  if (!riduzioneAccettabile(vecchieMisure.corse, orari.corse.length)) {
    problemi.push('corse: ' + vecchieMisure.corse + ' → ' + orari.corse.length);
  }
  if (!riduzioneAccettabile(vecchieMisure.forme, tracciati.forme.length)) {
    problemi.push('tracciati: ' + vecchieMisure.forme + ' → ' + tracciati.forme.length);
  }
  if (!fermate.fermate.some((f) => f.id === 'TRN001')) problemi.push('manca la stazione TRN001 (treni non unite?)');
  if (!orari.fermate.includes('TRN037')) problemi.push('manca Porretta Terme (S1 non unita?)');
  if (!fermate.fermate.some((f) => f.id && f.id.startsWith('TRN'))) problemi.push('nessuna stazione ferroviaria nel dataset');

  console.log('  fermate ' + fermate.fermate.length + ' · corse ' + orari.corse.length +
    ' · forme ' + tracciati.forme.length);
  if (problemi.length) throw new Error('dataset non plausibile:\n  - ' + problemi.join('\n  - '));
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  fs.mkdirSync(TMP, { recursive: true });

  const vecchieMisure = { fermate: 0, corse: 0, forme: 0 };
  const vecchi = {};
  FILE_DATI.forEach((nome) => {
    if (!esiste(percorsoData(nome)) || nome.endsWith('.gz')) return;
    try {
      vecchi[nome] = leggiJSON(percorsoData(nome));
    } catch (errore) {
      console.log('attenzione: ' + nome + ' illeggibile (' + errore.message + ')');
    }
  });
  if (vecchi['fermate.json']) vecchieMisure.fermate = vecchi['fermate.json'].fermate.length;
  if (vecchi['orari.json']) vecchieMisure.corse = vecchi['orari.json'].corse.length;
  if (vecchi['tracciati.json']) vecchieMisure.forme = vecchi['tracciati.json'].forme.length;

  salvaCopia();
  console.log('Copia dei dati attuali in ' + path.relative(RADICE, PRIMA));

  try {
    await faseFermate();
    await faseGtfs();
    await faseTreni();
    faseGzip();
    controlla(vecchieMisure);
  } catch (errore) {
    ripristina();
    console.error('\nPipeline interrotta: ' + errore.message);
    console.error('I dati precedenti sono stati ripristinati: niente da pubblicare.');
    process.exit(1);
  }

  const uguali = FILE_DATI
    .filter((nome) => !nome.endsWith('.gz'))
    .every((nome) => !vecchi[nome] || stessoContenuto(vecchi[nome], leggiJSON(percorsoData(nome))));

  if (uguali) {
    ripristina();
    console.log('\nNessuna modifica reale ai dati (cambia solo la data): non scrivo nulla.');
    return;
  }

  // I test leggono il dataset nuovo: se qualcosa non torna si torna indietro,
  // esattamente come per una fonte che non risponde.
  try {
    faseTest();
  } catch (errore) {
    ripristina();
    console.error('\nTest falliti sui dati nuovi: i dati precedenti sono stati ripristinati.');
    process.exit(1);
  }

  console.log('\nDati aggiornati in data/. Ora: npm run bump e commit.');
}

if (require.main === module) {
  main().catch((errore) => {
    console.error(errore && errore.stack ? errore.stack : errore);
    process.exit(1);
  });
}
