'use strict';

// Genera `trascrizione.md`: una fotografia leggibile del progetto, con tutti i
// file di codice e documentazione riportati per intero. Serve per passare il
// progetto a un'altra persona o a un altro strumento senza zippare la cartella.
//
// Uso (dalla cartella del progetto):
//   node scripts/genera-trascrizione.js           # file grandi riassunti
//   node scripts/genera-trascrizione.js --tutto   # anche i file grandi per intero
//
// I file con estensione binaria (immagini, archivi) non sono riportati: se ne
// indicano presenza e dimensione, perché non sono testo leggibile.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const USCITA = path.join(ROOT, 'trascrizione.md');
const TUTTO = process.argv.includes('--tutto');
const SOGLIA_GRANDE = 200 * 1024;
const DA_SALTARE = new Set(['.git', 'node_modules']);

const ESTENSIONI_BINARIE = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
  '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.otf',
  '.mp3', '.mp4', '.webm', '.apk', '.aab', '.so', '.exe'
]);

const LINGUE = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.py': 'python',
  '.svg': 'xml',
  '.xml': 'xml',
  '.sh': 'bash',
  '.txt': 'text'
};

const data = () => new Date().toLocaleString('it-IT', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

// I dataset in `data/` sono grandi e poco leggibili: si riassumono. Il codice
// resta sempre per intero, anche quando supera la soglia (app.js, ~256 KB).
const daRiassumere = (rel, dimensione) =>
  dimensione > SOGLIA_GRANDE && (rel.startsWith('data/') || dimensione > 1024 * 1024);

function git(comando) {
  try {
    return execFileSync('git', comando, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

// Preferisce `git ls-files`: rispetta .gitignore e non include gli artefatti
// temporanei (`.tmp-*`) né le cartelle di lavoro locali.
function elencoFile() {
  const tracciati = git(['ls-files', '-z']);
  if (tracciati) {
    return tracciati.split('\0').filter(Boolean);
  }
  const trovati = [];
  (function cammina(cartella) {
    for (const voce of fs.readdirSync(cartella, { withFileTypes: true })) {
      if (voce.isDirectory()) {
        if (DA_SALTARE.has(voce.name) || voce.name.startsWith('.')) continue;
        cammina(path.join(cartella, voce.name));
      } else {
        trovati.push(path.relative(ROOT, path.join(cartella, voce.name)).split(path.sep).join('/'));
      }
    }
  })(ROOT);
  return trovati.sort();
}

function lingua(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (rel === '.gitignore' || rel === '.gitattributes') return '';
  if (Object.prototype.hasOwnProperty.call(LINGUE, ext)) return LINGUE[ext];
  return '';
}

function recinto(testo, lang) {
  let tacche = '```';
  while (testo.includes(tacche)) tacche += '`';
  return tacche + lang + '\n' + testo.replace(/\s+$/, '') + '\n' + tacche;
}

function descriviJson(testo) {
  try {
    const j = JSON.parse(testo);
    if (Array.isArray(j)) return ['array di ' + j.length + ' elementi'];
    if (j === null || typeof j !== 'object') return ['valore ' + typeof j];
    return Object.keys(j).map((k) => {
      const v = j[k];
      if (Array.isArray(v)) return '`' + k + '`: ' + v.length + ' elementi';
      return '`' + k + '`: ' + (v === null ? 'null' : typeof v);
    });
  } catch {
    return ['JSON non interpretabile (file troncato o corrotto)'];
  }
}

function riassuntoGrande(rel, contenuto, dimensione) {
  const hash = crypto.createHash('sha256').update(contenuto).digest('hex').slice(0, 16);
  const righe = [
    'File testuale di ' + dimensione.toLocaleString('it-IT') + ' byte: riassunto, non riportato per intero.',
    '',
    '- Byte: ' + dimensione + ' · righe: ' + contenuto.toString('utf8').split('\n').length,
    '- SHA-256 (primi 16): `' + hash + '`'
  ];
  if (path.extname(rel).toLowerCase() === '.json') {
    righe.push('', 'Contenuto:');
    for (const riga of descriviJson(contenuto.toString('utf8'))) righe.push('- ' + riga);
  }
  righe.push('', 'Per includerlo per intero: `node scripts/genera-trascrizione.js --tutto`.');
  return righe.join('\n');
}

function stato() {
  const righe = [];
  righe.push('- Generato il ' + data() + '.');
  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (commit) {
    const oggetto = git(['log', '-1', '--pretty=%s']);
    righe.push('- Commit di riferimento: `' + commit + '`' + (oggetto ? ' — ' + oggetto : '') + '.');
  }
  const ramo = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (ramo) righe.push('- Ramo: `' + ramo + '`.');
  try {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const v = sw.match(/muovi-bologna-static-(v\d+)/);
    if (v) righe.push('- Versione cache del service worker: `' + v[1] + '`.');
  } catch {
    // sw.js assente: nessuna riga in più
  }
  return righe.join('\n');
}

function genera() {
  const file = elencoFile().filter((rel) => rel !== 'trascrizione.md');
  const indice = [];
  const sezioni = [];
  let inclusi = 0;
  let byteTotali = 0;

  for (const rel of file) {
    const assoluto = path.join(ROOT, rel);
    let contenuto;
    try {
      contenuto = fs.readFileSync(assoluto);
    } catch {
      continue;
    }
    const dimensione = contenuto.length;
    byteTotali += dimensione;
    inclusi += 1;
    const ext = path.extname(rel).toLowerCase();
    const binario = ESTENSIONI_BINARIE.has(ext) || contenuto.subarray(0, 8192).includes(0);

    indice.push('| `' + rel + '` | ' + dimensione.toLocaleString('it-IT') + ' | ' +
      (binario ? 'binario' : 'testo') + ' |');

    let corpo;
    if (binario) {
      const hash = crypto.createHash('sha256').update(contenuto).digest('hex').slice(0, 16);
      corpo = 'File binario, non riportato: ' + dimensione.toLocaleString('it-IT') +
        ' byte, SHA-256 (primi 16) `' + hash + '`.';
    } else if (!TUTTO && daRiassumere(rel, dimensione)) {
      corpo = riassuntoGrande(rel, contenuto, dimensione);
    } else {
      corpo = recinto(contenuto.toString('utf8'), lingua(rel));
    }
    sezioni.push('## `' + rel + '`\n\n' + corpo + '\n');
  }

  const testa = [
    '# Trascrizione del progetto',
    '',
    stato(),
    '',
    'File inclusi: ' + inclusi + ' (' + byteTotali.toLocaleString('it-IT') + ' byte in totale). ' +
      'Esclusi `.git`, `node_modules`, gli artefatti temporanei ignorati da Git e questo file stesso.',
    '',
    TUTTO
      ? 'I file testuali sono riportati integralmente. Per i file binari vengono indicati presenza e dimensione, perché non sono rappresentabili come testo leggibile.'
      : 'Il codice e la documentazione sono riportati integralmente. I dataset in `data/` oltre i 200 KB (e qualsiasi testo oltre 1 MB) sono riassunti con dimensione, impronta SHA-256 e struttura del contenuto. Per i file binari vengono indicati presenza e dimensione.',
    '',
    'Per rigenerare il file: `node scripts/genera-trascrizione.js` (oppure `--tutto` per includere anche i dataset per intero).',
    '',
    '## Indice dei file',
    '',
    '| File | Byte | Tipo |',
    '|---|---|---|'
  ].join('\n') + '\n' + indice.join('\n') + '\n';

  fs.writeFileSync(USCITA, testa + '\n' + sezioni.join('\n'), 'utf8');
  const finale = fs.statSync(USCITA).size;
  console.log('Scritto ' + path.relative(process.cwd(), USCITA) + ': ' + inclusi +
    ' file, ' + finale.toLocaleString('it-IT') + ' byte.');
}

genera();
