'use strict';

/* Server statico minimo per i test end-to-end: nessuna dipendenza, così
 * `npm run e2e` funziona anche su una macchina appena clonata. Serve solo la
 * cartella dell'app, su 127.0.0.1, con i MIME che il browser si aspetta. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RADICE = path.resolve(__dirname, '..');
const PORTA = Number(process.env.PORTA_E2E || 8124);

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.gz': 'application/gzip',
  '.woff2': 'font/woff2'
};

const server = http.createServer((richiesta, risposta) => {
  const url = new URL(richiesta.url, 'http://127.0.0.1');
  let percorso = decodeURIComponent(url.pathname);
  if (percorso.endsWith('/')) percorso += 'index.html';
  const file = path.join(RADICE, percorso);
  // Niente uscite dalla cartella dell'app.
  if (!file.startsWith(RADICE)) {
    risposta.writeHead(403).end('no');
    return;
  }
  fs.readFile(file, (errore, dati) => {
    if (errore) {
      risposta.writeHead(404, { 'content-type': 'text/plain' }).end('non trovato');
      return;
    }
    risposta.writeHead(200, {
      'content-type': TIPI[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    risposta.end(dati);
  });
});

server.listen(PORTA, '127.0.0.1', () => {
  console.log('e2e su http://127.0.0.1:' + PORTA);
});
