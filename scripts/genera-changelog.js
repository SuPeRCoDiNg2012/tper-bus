'use strict';
/*
 * Rigenera changelog.html leggendo i commit del repository, raggruppati per giorno.
 * Uso: npm run changelog
 *
 * I messaggi troppo telegrafici si riscrivono in `sostituzioni`:
 * chiave = oggetto esatto del commit, valore = testo da mostrare nella pagina.
 * I commit non elencati compaiono con il loro oggetto originale.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const radice = path.resolve(__dirname, '..');
const out = path.join(radice, 'changelog.html');
const REPO = 'SuPeRCoDiNg2012/tper-bus';

const sostituzioni = {
  'TPER Zone Calc: PWA per zone, prezzi e percorso bus a Bologna':
    'Primo commit: TPER Zone Calc, una PWA per zone, prezzi e percorso bus a Bologna',
  v3: 'Aggiunge treni, tariffe e tempi a piedi, con i primi test automatici',
  'Aggiunge promemoria feriale, voce, mappa offline e preferiti personali':
    'Aggiunge promemoria feriale, ricerca a voce, mappa offline e preferiti personali',
  'Chiarisce nel menu che le notifiche non sono push a app chiusa':
    'Chiarisce nel menu che le notifiche non sono push ad app chiusa',
  'Unisci arrivi live e programmati in un solo elenco con i minuti':
    'Unisce gli arrivi live e programmati in un solo elenco con i minuti',
  'Correggi prima fermata, arrivo dopo mezzanotte e rotazione':
    'Corregge prima fermata, arrivo dopo mezzanotte e rotazione',
  'Rigenera la trascrizione del progetto con uno script':
    'Rigenera con uno script la trascrizione del progetto (documentazione interna)',
  "Aggiungi l'indice completo delle funzioni":
    "Aggiunge FUNZIONI.md, l'indice completo delle funzioni (documentazione interna)",
  'Completa il paragrafo C: prestazioni, PWA, accessibilita e primo avvio':
    'Completa il paragrafo C della relazione: prestazioni, PWA, accessibilità e primo avvio (documentazione interna)',
  'Correggi il buffer bus-bus nel changelog':
    'Corregge il buffer bus-bus nel changelog (documentazione)'
};

const mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const righe = execFileSync('git', ['log', '--date=short', '--pretty=format:%ad%x1f%h%x1f%s'], {
  cwd: radice, encoding: 'utf8'
}).trim().split('\n').filter(Boolean).map((riga) => {
  const [data, hash, soggetto] = riga.split('\x1f');
  return { data, hash, soggetto };
});

if (!righe.length) {
  throw new Error('nessun commit trovato in ' + radice);
}

const usate = new Set();
for (const c of righe) {
  if (Object.prototype.hasOwnProperty.call(sostituzioni, c.soggetto)) {
    usate.add(c.soggetto);
    c.testo = sostituzioni[c.soggetto];
  } else {
    c.testo = c.soggetto;
  }
}
for (const chiave of Object.keys(sostituzioni)) {
  if (!usate.has(chiave)) {
    console.warn('nota: sostituzione mai usata -> ' + chiave);
  }
}

function giorno(iso) {
  const [a, m, g] = iso.split('-').map(Number);
  return g + ' ' + mesi[m - 1] + ' ' + a;
}

/* "dal 22 al 28 novembre 2026" quando mese e anno coincidono, altrimenti le date per esteso. */
function intervallo(prima, ultima) {
  if (prima === ultima) return giorno(prima);
  const [a1, m1, g1] = prima.split('-').map(Number);
  const [a2, m2, g2] = ultima.split('-').map(Number);
  if (a1 === a2 && m1 === m2) return g1 + ' al ' + g2 + ' ' + mesi[m1 - 1] + ' ' + a1;
  return giorno(prima) + ' al ' + giorno(ultima);
}

function esc(testo) {
  return testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const perGiorno = new Map();
for (const c of righe) {
  if (!perGiorno.has(c.data)) perGiorno.set(c.data, []);
  perGiorno.get(c.data).push(c);
}

const sezioni = [...perGiorno.entries()].map(([data, voci]) => {
  const elenco = voci.map((v) =>
    '    <li>' + esc(v.testo) +
    ' <a class="commit" href="https://github.com/' + REPO + '/commit/' + v.hash +
    '" target="_blank" rel="noopener">' + v.hash + '</a></li>'
  ).join('\n');
  return '  <section>\n    <h2>' + giorno(data) + '</h2>\n    <ul class="voci">\n' + elenco + '\n    </ul>\n  </section>';
}).join('\n');

const prima = righe[righe.length - 1].data;
const ultima = righe[0].data;
const totale = righe.length;

const pagina = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Changelog — Muovi Bologna</title>
<meta name="theme-color" content="#C1121F">
<meta name="robots" content="index,follow">
<link rel="stylesheet" href="legale.css">
<style>
  .voci { list-style: none; padding: 0; margin: 0; }
  .voci li { padding: 7px 0; border-bottom: 1px solid var(--bordo); font-size: 15px; }
  .voci li:last-child { border-bottom: 0; }
  .commit { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    color: var(--testo-2); text-decoration: none; margin-left: 6px; white-space: nowrap; }
  .commit:hover { color: var(--rosso); text-decoration: underline; }
  section { margin-top: 22px; }
  h2 { margin-bottom: 2px; }
</style>
</head>
<body>
<header>
  <a href="./">&larr; Torna all'app</a>
  <h1>Changelog</h1>
</header>
<main>
  <p class="nota">Tutte le modifiche dall'inizio: ${totale} commit dal ${intervallo(prima, ultima)}, uno per voce. La sigla accanto apre il commit su GitHub. È la storia del codice, non un riassunto scritto dopo: le voci sono i messaggi dei commit.</p>
  <p class="nota">This log is in Italian, the language of the commit history it comes from.</p>
${sezioni}
  <footer>
    <a href="./">App</a>
    <a href="privacy.html">Privacy</a>
    <a href="termini.html">Termini</a>
    <a href="cookie.html">Cookie</a>
    <a href="note-legali.html">Note legali</a>
  </footer>
</main>
</body>
</html>
`;

fs.writeFileSync(out, pagina);
console.log('scritto ' + path.relative(radice, out) + ' con ' + totale + ' voci');
