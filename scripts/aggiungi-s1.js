#!/usr/bin/env node
/**
 * aggiungi-s1.js
 *
 * Aggiunge al dataset le corse della linea S1 Bologna–Porretta Terme,
 * estratte dal PDF ufficiale TPER/SFM:
 *
 *   https://www.sfmbo.it/Engine/RAServeFile.php/f/Orari/Orario_linea_S1_Porretta-Bologna-Pianoro.pdf
 *
 * USO
 *   node scripts/aggiungi-s1.js --pdf .tmp-pdf/s1.pdf
 *   node scripts/aggiungi-s1.js --testo .tmp-pdf/s1-table.txt
 *   node scripts/aggiungi-s1.js --testo ... --scrivi
 *
 * Senza --scrivi non tocca i dati: stampa il riepilogo e le validazioni.
 * Con --scrivi aggiorna data/orari.json(.gz) e data/tracciati.json(.gz).
 *
 * Il PDF elenca le fermate da Bologna a Porretta e oltre verso Pistoia.
 * Vengono importate solo le corse che servono sia Bologna C.le sia Porretta
 * Terme, troncate a Porretta: le fermate oltre Porretta (Pistoia) non sono
 * nell'app. Le corse con nota 7 (sospese nei festivi e nei prefestivi) restano
 * fuori perché la periodicità non è rappresentabile con i servizi settimanali.
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
const PDF_PREDEFINITO = path.join(RADICE, '.tmp-pdf', 's1.pdf');
const TESTO_PREDEFINITO = path.join(RADICE, '.tmp-pdf', 's1-table.txt');

const ARGS = process.argv.slice(2);
const SCRIVI = ARGS.includes('--scrivi');
const indicePdf = ARGS.indexOf('--pdf');
const indiceTesto = ARGS.indexOf('--testo');
const PDF = indicePdf >= 0 && ARGS[indicePdf + 1] ? ARGS[indicePdf + 1] : PDF_PREDEFINITO;
const TESTO = indiceTesto >= 0 && ARGS[indiceTesto + 1] ? ARGS[indiceTesto + 1] : null;

const VALIDITA = { inizio: 20260614, fine: 20261212 };
const MASCHERA_TUTTI_I_GIORNI = 127;
const LINEA = 'REG';

// Stazioni della S1 tra Bologna e Porretta, nell'ordine di andata.
const STAZIONI = [
  { nome: 'Bologna Centrale', id: 'TRN001' },
  { nome: 'Bologna Borgo Panigale', id: 'TRN012' },
  { nome: 'Casteldebole', id: 'TRN013' },
  { nome: 'Casalecchio Garibaldi', id: 'TRN004' },
  { nome: 'Casalecchio di Reno', id: 'TRN027' },
  { nome: 'Borgonuovo', id: 'TRN028' },
  { nome: 'Pontecchio Marconi', id: 'TRN029' },
  { nome: 'Sasso Marconi', id: 'TRN007' },
  { nome: 'Lama di Reno', id: 'TRN030' },
  { nome: 'Marzabotto', id: 'TRN008' },
  { nome: 'Pian di Venola', id: 'TRN031' },
  { nome: 'Pioppe di Salvaro', id: 'TRN032' },
  { nome: 'Vergato', id: 'TRN033' },
  { nome: 'Carbona', id: 'TRN034' },
  { nome: 'Riola', id: 'TRN035' },
  { nome: 'Silla', id: 'TRN036' },
  { nome: 'Porretta Terme', id: 'TRN037' }
];

// Oltre Porretta: servono solo a riconoscere le righe, poi vengono scartate.
const ALTRE_STAZIONI = [
  { nome: 'Ponte della Venturina', id: 'X62' },
  { nome: 'Molino del Pallone', id: 'X66' },
  { nome: 'Biagioni Lagacci', id: 'X69' },
  { nome: 'Pracchia', id: 'X74' },
  { nome: 'S. Mommè', id: 'X77' },
  { nome: 'Castagno', id: 'X79' },
  { nome: 'Corbezzi', id: 'X81' },
  { nome: 'Pistoia Ovest', id: 'X97' },
  { nome: 'Pistoia', id: 'X99' }
];

const NOMI = [...STAZIONI, ...ALTRE_STAZIONI].sort((a, b) => b.nome.length - a.nome.length);

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
    errore('PDF non trovato: ' + PDF + '\nScaricalo dalla pagina SFMBO della linea S1 o passa --pdf/--testo.');
  }
  const uscita = path.join(RADICE, '.tmp-pdf', 's1-table.txt');
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

function secondi(testo) {
  const parti = String(testo || '').split('.');
  if (parti.length < 2) return NaN;
  return parseInt(parti[0], 10) * 3600 + parseInt(parti[1], 10) * 60;
}

function posizioniCodici(riga) {
  const codice = /\b[A-Z]?\d{4,5}\b/g;
  const risultati = [];
  let match;
  while ((match = codice.exec(riga))) {
    if (match.index > 20) risultati.push({ posizione: match.index, codice: match[0] });
  }
  return risultati;
}

function posizioniSimboli(riga) {
  const simbolo = /\b[0L]\b/g;
  const risultati = [];
  let match;
  while ((match = simbolo.exec(riga))) {
    risultati.push({ posizione: match.index, simbolo: match[0] });
  }
  return risultati;
}

function posizioniNote(riga) {
  if (posizioniCodici(riga).length >= 2) return [];
  const nota = /\d/g;
  const risultati = [];
  let match;
  while ((match = nota.exec(riga))) {
    risultati.push({ posizione: match.index, nota: match[0] });
  }
  return risultati;
}

function nomeFermata(parte) {
  for (const stazione of NOMI) {
    if (parte.includes(stazione.nome)) return stazione;
  }
  return null;
}

function leggiPagina(righe) {
  const intestazioni = [];
  righe.forEach((riga, indice) => {
    const codici = posizioniCodici(riga);
    if (codici.length >= 3) intestazioni.push({ indice, codici });
  });

  const blocchi = [];
  intestazioni.forEach((voce) => {
    if (blocchi.length && voce.indice - blocchi[blocchi.length - 1].indice < 8) return;
    blocchi.push(voce);
  });

  const risultato = [];
  blocchi.forEach((blocco, indiceBlocco) => {
    const fine = indiceBlocco + 1 < blocchi.length ? blocchi[indiceBlocco + 1].indice : righe.length;
    let rigaSimboli = null;
    for (let j = blocco.indice - 1; j >= Math.max(-1, blocco.indice - 5); j -= 1) {
      if (/\b[0L]\b/.test(righe[j])) { rigaSimboli = righe[j]; break; }
    }
    const simboli = rigaSimboli ? posizioniSimboli(rigaSimboli) : [];

    let rigaKm = null;
    for (let j = blocco.indice; j < Math.min(righe.length, blocco.indice + 15); j += 1) {
      if (righe[j].includes('Km')) { rigaKm = j; break; }
    }
    if (rigaKm === null) return;

    const note = [];
    for (let j = blocco.indice + 1; j < rigaKm; j += 1) {
      posizioniNote(righe[j]).forEach((voce) => note.push(voce));
    }

    const colonne = blocco.codici.map((codice) => {
      let simbolo = '?';
      if (simboli.length) {
        const vicino = simboli.reduce((migliore, voce) => (
          Math.abs(voce.posizione - codice.posizione) < Math.abs(migliore.posizione - codice.posizione) ? voce : migliore
        ));
        if (Math.abs(vicino.posizione - codice.posizione) <= 6) simbolo = vicino.simbolo;
      }
      const noteColonna = note
        .filter((voce) => Math.abs(voce.posizione - codice.posizione) <= 8)
        .map((voce) => voce.nota)
        .join('');
      return { posizione: codice.posizione, codice: codice.codice, simbolo, note: noteColonna, tempi: new Map() };
    });
    colonne.forEach((colonna, indice) => {
      colonna.inizio = Math.max(0, colonna.posizione - 2);
      colonna.fine = indice + 1 < colonne.length ? colonne[indice + 1].posizione - 2 : Infinity;
    });

    const posizioneKm = righe[rigaKm].indexOf('Km');
    for (let li = rigaKm + 1; li < fine; li += 1) {
      const riga = righe[li];
      const segmento = riga.slice(posizioneKm, posizioneKm + 4);
      if (!/^\s*\d{1,2}\s/.test(segmento)) continue;

      const orario = /\b\d{1,2}\.\d{2}\b/g;
      let primo = null;
      let match;
      while ((match = orario.exec(riga))) {
        if (match.index > posizioneKm + 20) { primo = match; break; }
      }
      if (!primo) continue;

      const fermata = nomeFermata(riga.slice(posizioneKm, primo.index));
      if (!fermata) continue;

      orario.lastIndex = primo.index;
      while ((match = orario.exec(riga))) {
        if (match.index < primo.index) continue;
        const colonna = colonne.find((c) => (
          c.simbolo !== '0' &&
          match.index >= c.inizio &&
          match.index < c.fine &&
          !/[\|·]/.test(riga.slice(c.inizio, c.fine))
        ));
        if (!colonna) continue;
        const esistente = colonna.tempi.get(fermata.id);
        if (!esistente) {
          colonna.tempi.set(fermata.id, { seconda: secondi(match[0]), riga: li });
        }
      }
    }

    risultato.push(colonne);
  });

  return risultato;
}

function sequenzaValida(fermate, direzione) {
  const canonica = direzione === 'andata' ? STAZIONI.map((s) => s.id) : STAZIONI.map((s) => s.id).reverse();
  let j = 0;
  for (const id of fermate) {
    while (j < canonica.length && canonica[j] !== id) j += 1;
    if (j >= canonica.length) return false;
  }
  return true;
}

function estraiCorse(testo) {
  const pagine = testo.replace(/\r/g, '').split('\f');
  const corse = [];
  const scartate = [];

  // Le tabelle S1 occupano le pagine 6-9 del PDF (indice 6-9 nel testo).
  for (let pagina = 6; pagina <= 9 && pagina < pagine.length; pagina += 1) {
    const righe = pagine[pagina].split('\n');
    leggiPagina(righe).forEach((colonne) => {
      colonne.forEach((colonna) => {
        if (colonna.simbolo !== 'L') return;
        if (colonna.note.includes('7')) {
          scartate.push({ codice: colonna.codice, motivo: 'nota 7 (sospesa nei festivi/prefestivi)' });
          return;
        }
        const sequenza = [...colonna.tempi.entries()].sort((a, b) => a[1].riga - b[1].riga);
        const ids = sequenza.map(([id]) => id);
        if (!ids.includes('TRN001') || !ids.includes('TRN037')) return;
        const da = ids.indexOf('TRN001');
        const a = ids.indexOf('TRN037');
        const parte = da < a ? sequenza.slice(da, a + 1) : sequenza.slice(a, da + 1);
        if (parte.length < 2) return;

        const fermate = parte.map(([id]) => id);
        const tempi = parte.map(([, voce]) => voce.seconda);
        if (tempi.some((t) => !Number.isFinite(t))) return;
        for (let i = 1; i < tempi.length; i += 1) {
          if (tempi[i] <= tempi[i - 1]) {
            scartate.push({ codice: colonna.codice, motivo: 'orari non crescenti' });
            return;
          }
        }
        const direzione = da < a ? 'andata' : 'ritorno';
        if (!sequenzaValida(fermate, direzione)) {
          scartate.push({ codice: colonna.codice, motivo: 'sequenza fermate fuori ordine' });
          return;
        }
        corse.push({ codice: colonna.codice, direzione, fermate, tempi });
      });
    });
  }

  const viste = new Set();
  const uniche = [];
  corse.forEach((corsa) => {
    const chiave = corsa.fermate.join('-') + '|' + corsa.tempi.join(',');
    if (viste.has(chiave)) return;
    viste.add(chiave);
    uniche.push(corsa);
  });
  return { corse: uniche, lette: corse.length, scartate };
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
  const testo = estraiTesto();
  const { corse, lette, scartate } = estraiCorse(testo);
  if (!corse.length) errore('nessuna corsa S1 valida estratta.');

  console.log('Linea S1 Bologna–Porretta Terme');
  console.log('  corse lette      ' + lette);
  console.log('  corse valide     ' + corse.length + ' (dopo aver tolto le copie identiche)');
  console.log('  andata           ' + corse.filter((c) => c.direzione === 'andata').length);
  console.log('  ritorno          ' + corse.filter((c) => c.direzione === 'ritorno').length);
  console.log('  periodo          ' + VALIDITA.inizio + '–' + VALIDITA.fine + ' (tutti i giorni)');
  if (scartate.length) {
    console.log('  escluse          ' + scartate.length);
    scartate.forEach((c) => console.log('    ' + c.codice + ': ' + c.motivo));
  }
  console.log('');

  if (!SCRIVI) {
    console.log('Prova: nessun file scritto (aggiungi --scrivi).');
    return;
  }

  const orari = leggiJSON(FILE_ORARI);
  const tracciati = leggiJSON(FILE_TRACCIATI);
  const fermate = leggiJSON(FILE_FERMATE).fermate;
  const coordinate = new Map(fermate.map((f) => [f.id, [f.lon, f.lat]]));

  if (orari.fermate.includes('TRN037')) {
    errore('Porretta è già presente in data/orari.json: rigenera il dataset bus prima di rieseguire lo script.');
  }
  if (tracciati.corse.length !== orari.corse.length) {
    errore('orari.corse e tracciati.corse non sono allineati.');
  }

  const indiceFermata = new Map(orari.fermate.map((id, i) => [id, i]));
  STAZIONI.forEach((stazione) => {
    if (!indiceFermata.has(stazione.id)) {
      indiceFermata.set(stazione.id, orari.fermate.length);
      orari.fermate.push(stazione.id);
    }
  });

  let indiceLinea = orari.linee.findIndex((linea) => linea[0] === LINEA && linea[1] === 2);
  if (indiceLinea < 0) {
    indiceLinea = orari.linee.length;
    orari.linee.push([LINEA, 2]);
  }

  let indiceServizio = orari.servizi.findIndex((servizio) => (
    servizio[0] === MASCHERA_TUTTI_I_GIORNI &&
    servizio[1] === VALIDITA.inizio &&
    servizio[2] === VALIDITA.fine
  ));
  if (indiceServizio < 0) {
    indiceServizio = orari.servizi.length;
    orari.servizi.push([MASCHERA_TUTTI_I_GIORNI, VALIDITA.inizio, VALIDITA.fine]);
  }

  corse.forEach((corsa) => {
    const indici = corsa.fermate.map((id) => indiceFermata.get(id));
    const voce = [indiceLinea, indiceServizio, indici[0], corsa.tempi[0]];
    for (let i = 1; i < indici.length; i += 1) {
      voce.push(indici[i] - indici[i - 1]);
      voce.push(corsa.tempi[i] - corsa.tempi[i - 1]);
    }
    orari.corse.push(voce);

    const punti = corsa.fermate.map((id) => coordinate.get(id));
    if (punti.some((punto) => !punto)) errore('coordinate mancanti per una stazione S1.');
    const indiceForma = tracciati.forme.length;
    const tabella = [];
    indici.forEach((indice, i) => tabella.push(indice, i));
    tracciati.forme.push(polilinea(punti));
    tracciati.posizioni.push(tabella);
    tracciati.corse.push(indiceForma);
  });

  if (tracciati.corse.length !== orari.corse.length) errore('allineamento corse/forme fallito.');

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
