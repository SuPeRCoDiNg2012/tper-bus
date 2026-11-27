#!/usr/bin/env node
/**
 * aggiungi-treni-locali.js
 *
 * Aggiunge al dataset le corse locali TPER della linea S2A Bologna-Vignola
 * (Bologna Centrale - Casalecchio - Vignola), estratte dal PDF ufficiale:
 *
 *   https://s3.eu-south-1.amazonaws.com/static.tper.it/orari/20251213treni/tper_trbovi.pdf
 *
 * USO
 *   node scripts/aggiungi-treni-locali.js --pdf .tmp-pdf/vignola.pdf
 *   node scripts/aggiungi-treni-locali.js --testo .tmp-pdf/vignola-table.txt
 *   node scripts/aggiungi-treni-locali.js --testo ... --scrivi
 *
 * Senza --scrivi non tocca i dati: stampa il riepilogo e le validazioni.
 * Con --scrivi aggiorna data/orari.json(.gz) e data/tracciati.json(.gz).
 *
 * La S1 Bologna–Porretta è gestita da scripts/aggiungi-s1.js, che legge il
 * PDF ufficiale con un parser dedicato; questo script resta solo sulla S2A.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const RADICE = path.join(__dirname, '..');
const FILE_ORARI = path.join(RADICE, 'data', 'orari.json');
const FILE_TRACCIATI = path.join(RADICE, 'data', 'tracciati.json');
const FILE_FERMATE = path.join(RADICE, 'data', 'fermate.json');
const PDF_PREDEFINITO = path.join(RADICE, '.tmp-pdf', 'vignola.pdf');
const TESTO_PREDEFINITO = path.join(RADICE, '.tmp-pdf', 'vignola-table.txt');

const ARGS = process.argv.slice(2);
const SCRIVI = ARGS.includes('--scrivi');
const indicePdf = ARGS.indexOf('--pdf');
const indiceTesto = ARGS.indexOf('--testo');
const PDF = indicePdf >= 0 && ARGS[indicePdf + 1] ? ARGS[indicePdf + 1] : PDF_PREDEFINITO;
const TESTO = indiceTesto >= 0 && ARGS[indiceTesto + 1] ? ARGS[indiceTesto + 1] : null;

const VALIDITA = { inizio: 20251214, fine: 20261212 };
const LINEA = 'S2A';
const FESTIVITA = [
  20251225, 20251226, 20260101, 20260106, 20260405, 20260406,
  20260425, 20260501, 20260602, 20260815, 20261101, 20261208
];

const STAZIONI = [
  { nome: 'Bologna Centrale', id: 'TRN001' },
  { nome: 'Bologna Borgo Panigale', id: 'TRN012' },
  { nome: 'Casteldebole', id: 'TRN013' },
  { nome: 'Casalecchio Garibaldi', id: 'TRN004' },
  { nome: 'Casalecchio Ceretolo', id: 'TRN014' },
  { nome: 'Casalecchio Palasport', id: 'TRN015' },
  { nome: 'Riale', id: 'TRN016' },
  { nome: 'Pilastrino', id: 'TRN017' },
  { nome: 'Zola Centro', id: 'TRN018' },
  { nome: 'Zola Chiesa', id: 'TRN019' },
  { nome: 'Ponte Ronca', id: 'TRN020' },
  { nome: 'Via Lunga', id: 'TRN021' },
  { nome: 'Crespellano', id: 'TRN022' },
  { nome: 'Muffa', id: 'TRN023' },
  { nome: 'Bazzano', id: 'TRN024' },
  { nome: 'Savignano Mulino', id: 'TRN025' },
  { nome: 'Savignano Centro', id: 'TRN026' },
  { nome: 'Vignola', id: 'TRN009' }
];

const NOMI_ANDATA = STAZIONI.map((s) => s.nome);
const NOMI_RITORNO = NOMI_ANDATA.slice().reverse();

function errore(messaggio) {
  console.error('Errore: ' + messaggio);
  process.exit(1);
}

function leggiJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function estraiTesto() {
  if (TESTO) {
    if (!fs.existsSync(TESTO)) errore('file di testo non trovato: ' + TESTO);
    return fs.readFileSync(TESTO, 'utf8');
  }
  if (!fs.existsSync(PDF)) {
    errore('PDF non trovato: ' + PDF + '\nScaricalo dalla pagina TPER della linea Bologna-Vignola o passa --pdf/--testo.');
  }
  const uscita = path.join(RADICE, '.tmp-pdf', 'vignola-table.txt');
  fs.mkdirSync(path.dirname(uscita), { recursive: true });
  const esito = spawnSync('pdftotext', ['-table', '-enc', 'UTF-8', PDF, uscita], { encoding: 'utf8' });
  if (esito.error) {
    errore('pdftotext non disponibile (' + esito.error.message + '). Estrai il PDF e passa --testo.');
  }
  if (esito.status !== 0) {
    errore('pdftotext non è riuscito a leggere il PDF: ' + (esito.stderr || '').trim());
  }
  return fs.readFileSync(uscita, 'utf8');
}

function nomeFermata(riga) {
  const testo = riga.trimStart();
  for (const stazione of STAZIONI) {
    if (!testo.startsWith(stazione.nome)) continue;
    const resto = testo.slice(stazione.nome.length);
    if (!resto || /^\s/.test(resto)) return stazione.nome;
  }
  return null;
}

function trovaIntestazioni(righe) {
  const indice = righe.findIndex((riga) => /900\d\d/.test(riga));
  if (indice < 0) errore('intestazione dei treni non trovata nella tabella.');
  const riga = righe[indice];
  const colonne = [];
  const regex = /\b(?:900\d\d|B5\d{3})\b/g;
  let match;
  while ((match = regex.exec(riga))) {
    const dopo = riga.slice(match.index + match[0].length);
    const nota = /^\s+([1-6])\b/.exec(dopo);
    colonne.push({
      codice: match[0],
      inizio: match.index,
      nota: nota ? Number(nota[1]) : 0
    });
  }
  if (!colonne.length) errore('nessuna colonna treno trovata.');
  return { indice, colonne };
}

function secondiRaw(testo) {
  const parti = testo.split(':');
  return { ore: Number(parti[0]), minuti: Number(parti[1]) };
}

/**
 * Corregge l'unico errore noto dell'estrazione: a volte una nota si attacca
 * all'ora e produce "122:07" al posto di "12:07". La scelta del candidato
 * viene fatta solo se una delle cifre può essere tolta e resta un orario
 * compreso tra i due passaggi vicini; altrimenti la corsa viene scartata.
 */
function interpretaTempi(passaggi, etichetta) {
  const risultati = passaggi.map((p) => ({ ...p, ore: p.raw.ore, minuti: p.raw.minuti }));
  for (let i = 0; i < risultati.length; i += 1) {
    const voce = risultati[i];
    if (voce.ore <= 23 && voce.minuti <= 59) continue;
    if (voce.minuti > 59) errore(etichetta + ': minuti non validi in ' + voce.testo);
    const cifre = String(voce.ore);
    const candidati = [];
    for (let k = 0; k < cifre.length; k += 1) {
      const ore = Number(cifre.slice(0, k) + cifre.slice(k + 1));
      if (ore <= 23 && !candidati.includes(ore)) candidati.push(ore);
    }
    const precedente = risultati[i - 1] ? risultati[i - 1].ore * 3600 + risultati[i - 1].minuti * 60 : -Infinity;
    const successivo = risultati[i + 1] ? risultati[i + 1].ore * 3600 + risultati[i + 1].minuti * 60 : Infinity;
    const validi = candidati
      .map((ore) => ore * 3600 + voce.minuti * 60)
      .filter((sec) => sec > precedente && sec < successivo);
    if (!validi.length) errore(etichetta + ': orario non interpretabile "' + voce.testo + '"');
    const scelto = validi.sort((a, b) => a - b)[0];
    voce.ore = Math.floor(scelto / 3600);
    voce.minuti = Math.floor((scelto % 3600) / 60);
    console.log('  corretto ' + etichetta + ': ' + voce.testo + ' → ' + voce.ore + ':' + String(voce.minuti).padStart(2, '0'));
  }
  return risultati.map((v) => v.ore * 3600 + v.minuti * 60);
}

function serviziPer(nota, tipo) {
  if (tipo === 'festivi') return [[96, VALIDITA.inizio, VALIDITA.fine]];
  if (nota === 0) return [[63, VALIDITA.inizio, VALIDITA.fine]];
  if (nota === 1) {
    return [
      [63, VALIDITA.inizio, 20260801],
      [63, 20260831, VALIDITA.fine]
    ];
  }
  if (nota === 2) {
    return [
      [63, VALIDITA.inizio, 20260613],
      [63, 20260914, VALIDITA.fine]
    ];
  }
  if (nota === 3) return null; // periodicità estiva con sabati soppressi: non importata
  if (nota === 4) return [[31, VALIDITA.inizio, VALIDITA.fine]];
  if (nota === 5) return [[96, VALIDITA.inizio, VALIDITA.fine]];
  if (nota === 6) return [[48, VALIDITA.inizio, VALIDITA.fine]];
  return null;
}

function leggiSezioni(testo) {
  const righe = testo.replace(/\r/g, '').split('\n');
  const sezioni = [];
  let corrente = null;
  righe.forEach((riga) => {
    if (/Bologna\s+Vignola\s+Feriali/.test(riga)) {
      corrente = { tipo: 'feriali', direzione: 'andata', righe: [] };
      sezioni.push(corrente);
      return;
    }
    if (/Vignola\s+Bologna\s+Feriali/.test(riga)) {
      corrente = { tipo: 'feriali', direzione: 'ritorno', righe: [] };
      sezioni.push(corrente);
      return;
    }
    if (/Bologna\s+Vignola\s+Festivi/.test(riga)) {
      corrente = { tipo: 'festivi', direzione: 'entrambe', righe: [] };
      sezioni.push(corrente);
      return;
    }
    if (corrente) corrente.righe.push(riga);
  });
  return sezioni;
}

function righePerFermata(righe, ordine, lato) {
  const mappa = new Map();
  const visti = [];
  righe.forEach((riga) => {
    const parte = lato ? riga.slice(lato[0], lato[1]) : riga;
    const nome = nomeFermata(parte);
    if (!nome) return;
    if (mappa.has(nome)) errore('fermata duplicata nella tabella: ' + nome);
    mappa.set(nome, parte);
    visti.push(nome);
  });
  if (visti.length !== ordine.length || visti.some((nome, i) => nome !== ordine[i])) {
    errore('sequenza fermate inattesa: ' + visti.join(' → '));
  }
  return mappa;
}

function tempiDaRiga(riga) {
  return [...riga.matchAll(/\d{1,3}:\d{2}/g)].map((m) => ({ testo: m[0], posizione: m.index, raw: secondiRaw(m[0]) }));
}

function colonnaPerPosizione(posizione, colonne) {
  for (let i = 0; i < colonne.length; i += 1) {
    const fine = i + 1 < colonne.length ? colonne[i + 1].inizio : Infinity;
    if (posizione >= colonne[i].inizio && posizione < fine) return i;
  }
  if (posizione < colonne[0].inizio) return 0;
  return colonne.length - 1;
}

function creaCorse(sezione, righeFermate, colonne, ordine, direzione) {
  const corse = [];
  colonne.forEach((colonna, indiceColonna) => {
    if (!/^900/.test(colonna.codice)) return; // B5xxx = bus sostitutivi
    const passaggi = [];
    ordine.forEach((nome) => {
      const riga = righeFermate.get(nome);
      const tempi = tempiDaRiga(riga);
      const trovato = tempi.find((t) => colonnaPerPosizione(t.posizione, colonne) === indiceColonna);
      if (trovato) passaggi.push({ id: STAZIONI.find((s) => s.nome === nome).id, testo: trovato.testo, raw: trovato.raw });
    });
    if (passaggi.length < 2) return;
    // Alcune corse sono parziali (per esempio Bologna-Bazzano): si tengono,
    // ma il capolinea Bologna deve restare al posto giusto.
    if (direzione === 'andata' && passaggi[0].id !== 'TRN001') return;
    if (direzione === 'ritorno' && passaggi[passaggi.length - 1].id !== 'TRN001') return;
    const tempi = interpretaTempi(passaggi, colonna.codice);
    for (let i = 1; i < tempi.length; i += 1) {
      if (tempi[i] <= tempi[i - 1]) {
        errore(colonna.codice + ': orari non crescenti (' + passaggi[i - 1].testo + ' → ' + passaggi[i].testo + ')');
      }
      if (tempi[i] - tempi[i - 1] > 30 * 60) {
        errore(colonna.codice + ': salto di ' + Math.round((tempi[i] - tempi[i - 1]) / 60) + ' minuti tra due fermate');
      }
    }
    corse.push({
      codice: colonna.codice,
      nota: colonna.nota,
      tipo: sezione.tipo,
      direzione,
      passaggi: passaggi.map((p, i) => ({ id: p.id, secondi: tempi[i] })),
      fermate: passaggi.map((p) => p.id)
    });
  });
  return corse;
}

function leggiFeriali(sezione) {
  const { indice, colonne } = trovaIntestazioni(sezione.righe);
  const ordine = sezione.direzione === 'andata' ? NOMI_ANDATA : NOMI_RITORNO;
  const righeFermate = righePerFermata(sezione.righe.slice(indice + 1), ordine);
  return creaCorse(sezione, righeFermate, colonne, ordine, sezione.direzione);
}

function leggiFestivi(sezione) {
  const { indice, colonne } = trovaIntestazioni(sezione.righe);
  const sinistra = [];
  const destra = [];
  colonne.forEach((colonna) => (colonna.inizio < 110 ? sinistra : destra).push(colonna));
  if (sinistra.length !== 5 || destra.length !== 5) errore('colonne festive inattese.');
  const righe = sezione.righe.slice(indice + 1);
  const mappaSinistra = righePerFermata(righe, NOMI_ANDATA, [0, 110]);
  const mappaDestra = righePerFermata(righe, NOMI_RITORNO, [110, Infinity]);
  const corse = [];
  [['andata', sinistra, mappaSinistra], ['ritorno', destra, mappaDestra]].forEach(([direzione, cols, mappa]) => {
    cols.forEach((colonna, indiceColonna) => {
      const passaggi = [];
      (direzione === 'andata' ? NOMI_ANDATA : NOMI_RITORNO).forEach((nome) => {
        const tempi = tempiDaRiga(mappa.get(nome));
        if (!tempi[indiceColonna]) return;
        passaggi.push({ id: STAZIONI.find((s) => s.nome === nome).id, testo: tempi[indiceColonna].testo, raw: tempi[indiceColonna].raw });
      });
      if (passaggi.length !== 5 && passaggi.length !== 18) {
        errore(colonna.codice + ': numero di fermate festive inatteso (' + passaggi.length + ')');
      }
      const tempi = interpretaTempi(passaggi, colonna.codice);
      for (let i = 1; i < tempi.length; i += 1) {
        if (tempi[i] <= tempi[i - 1]) errore(colonna.codice + ': orari festivi non crescenti');
      }
      corse.push({
        codice: colonna.codice,
        nota: 0,
        tipo: 'festivi',
        direzione,
        passaggi: passaggi.map((p, i) => ({ id: p.id, secondi: tempi[i] })),
        fermate: passaggi.map((p) => p.id)
      });
    });
  });
  return corse;
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

function main() {
  const orari = leggiJSON(FILE_ORARI);
  const tracciati = leggiJSON(FILE_TRACCIATI);
  const fermate = leggiJSON(FILE_FERMATE).fermate;

  if (orari.linee.some((linea) => linea[0] === LINEA)) {
    errore('la linea ' + LINEA + ' è già presente nel dataset: rigenera da capo per non duplicarla.');
  }
  if (tracciati.corse.length !== orari.corse.length) {
    errore('orari.corse e tracciati.corse non sono allineati.');
  }

  const testo = estraiTesto();
  const sezioni = leggiSezioni(testo);
  if (sezioni.length !== 3) errore('sezioni attese 3 (andata, ritorno, festivi), trovate ' + sezioni.length);

  const corse = [];
  sezioni.forEach((sezione) => {
    if (sezione.tipo === 'feriali') corse.push(...leggiFeriali(sezione));
    else corse.push(...leggiFestivi(sezione));
  });
  if (!corse.length) errore('nessuna corsa valida estratta.');

  const coordinate = new Map(fermate.map((f) => [f.id, [f.lon, f.lat]]));
  if (corse.some((c) => c.fermate.some((id) => !coordinate.has(id)))) {
    errore('coordinate mancanti per una stazione Vignola.');
  }

  const indiceLinea = orari.linee.length;
  const baseServizi = orari.servizi.length;
  const baseFermate = orari.fermate.length;
  const indiceFermata = new Map(orari.fermate.map((id, i) => [id, i]));
  STAZIONI.forEach((s) => {
    if (!indiceFermata.has(s.id)) {
      indiceFermata.set(s.id, orari.fermate.length);
      orari.fermate.push(s.id);
    }
  });

  const indiceServizio = new Map();
  const servizi = [];
  const servizio = (mask, inizio, fine) => {
    const chiave = mask + '|' + inizio + '|' + fine;
    if (!indiceServizio.has(chiave)) {
      indiceServizio.set(chiave, baseServizi + servizi.length);
      servizi.push([mask, inizio, fine]);
    }
    return indiceServizio.get(chiave);
  };

  const forme = new Map();
  const creaForma = (sequenza) => {
    const chiave = sequenza.join('-');
    if (forme.has(chiave)) return forme.get(chiave);
    const punti = sequenza.map((id) => coordinate.get(id));
    const tabella = [];
    sequenza.forEach((id, i) => tabella.push(indiceFermata.get(id), i));
    const indice = tracciati.forme.length;
    tracciati.forme.push(polilinea(punti));
    tracciati.posizioni.push(tabella);
    forme.set(chiave, indice);
    return indice;
  };

  const nuove = [];
  const saltate = [];
  const serviziFeriali = new Set();
  let servizioFestivo = null;
  corse.forEach((corsa) => {
    const serviziCorsa = serviziPer(corsa.nota, corsa.tipo);
    if (!serviziCorsa) {
      saltate.push(corsa);
      return;
    }
    serviziCorsa.forEach(([mask, inizio, fine]) => {
      const s = servizio(mask, inizio, fine);
      if (corsa.tipo === 'festivi') servizioFestivo = s;
      else serviziFeriali.add(s);
      const fermateCorsa = corsa.fermate.map((id) => indiceFermata.get(id));
      const voce = [indiceLinea, s, fermateCorsa[0], corsa.passaggi[0].secondi];
      for (let i = 1; i < fermateCorsa.length; i += 1) {
        voce.push(fermateCorsa[i] - fermateCorsa[i - 1]);
        voce.push(corsa.passaggi[i].secondi - corsa.passaggi[i - 1].secondi);
      }
      orari.corse.push(voce);
      nuove.push({ corsa, forma: creaForma(corsa.fermate) });
    });
  });

  if (!nuove.length) errore('nessuna corsa aggiungibile.');

  orari.linee.push([LINEA, 2]);
  servizi.forEach((s) => orari.servizi.push(s));
  nuove.forEach((n) => tracciati.corse.push(n.forma));

  if (servizioFestivo !== null) {
    FESTIVITA.forEach((data) => {
      const chiave = String(data);
      if (!orari.eccezioni[chiave]) orari.eccezioni[chiave] = { a: [], r: [] };
      const voce = orari.eccezioni[chiave];
      if (!voce.a.includes(servizioFestivo)) voce.a.push(servizioFestivo);
      serviziFeriali.forEach((s) => {
        if (!voce.r.includes(s)) voce.r.push(s);
      });
    });
  }

  if (tracciati.corse.length !== orari.corse.length) errore('allineamento corse/forme fallito.');

  const perServizio = {};
  nuove.forEach(({ corsa }) => {
    const chiave = corsa.tipo + '/' + corsa.direzione + (corsa.nota ? ' nota ' + corsa.nota : '');
    perServizio[chiave] = (perServizio[chiave] || 0) + 1;
  });

  console.log('Linea ' + LINEA + ' Bologna-Vignola');
  console.log('  corse lette      ' + corse.length);
  console.log('  corse aggiunte   ' + nuove.length + ' (con eventuali doppie fasce stagionali)');
  console.log('  servizi aggiunti ' + servizi.length);
  console.log('  festività        ' + FESTIVITA.length + ' (servizio festivo attivo, feriali sospesi)');
  console.log('  fermate aggiunte ' + (orari.fermate.length - baseFermate));
  Object.keys(perServizio).sort().forEach((k) => console.log('  ' + k + ': ' + perServizio[k]));
  if (saltate.length) {
    console.log('  escluse          ' + saltate.length + ' corse con nota 3 (periodicità estiva con sabati soppressi)');
    saltate.forEach((c) => console.log('    ' + c.codice + ' ' + c.direzione + ' (nota 3)'));
  }
  console.log('');
  console.log('FALLBACK PORRETTA: nessuna corsa S1 importata.');
  console.log('  Il PDF S1/Trenitalia Tper ha colonne con periodicità e note grafiche');
  console.log('  non verificabili con affidabilità; il pianificatore non inventa orari.');
  console.log('  Fonte S1: https://www.sfmbo.it/sfm/La_rete/S1_Porretta_Bologna_Pianoro');
  console.log('');

  if (!SCRIVI) {
    console.log('Prova: nessun file scritto (aggiungi --scrivi).');
    return;
  }

  orari.aggiornato = new Date().toISOString().slice(0, 10);
  tracciati.aggiornato = orari.aggiornato;
  fs.writeFileSync(FILE_ORARI, JSON.stringify(orari));
  fs.writeFileSync(FILE_ORARI + '.gz', zlib.gzipSync(fs.readFileSync(FILE_ORARI), { level: 9 }));
  fs.writeFileSync(FILE_TRACCIATI, JSON.stringify(tracciati));
  fs.writeFileSync(FILE_TRACCIATI + '.gz', zlib.gzipSync(fs.readFileSync(FILE_TRACCIATI), { level: 9 }));
  console.log('Scritto ' + FILE_ORARI + ' e ' + FILE_TRACCIATI + '.');
  console.log('Ora esegui: node scripts/ricostruisci-tracciati.js --scrivi');
}

main();
