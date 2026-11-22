// sw.js — Service Worker di TPER Zone Calc
// Cache-first per gli asset statici dell'app, stale-while-revalidate per i JSON dati.
// Le richieste verso altri domini (mappa, relay degli orari live) non vengono intercettate:
// gli orari in tempo reale non devono mai arrivare dalla cache.

const CACHE_STATICA = 'tper-zone-calc-static-v15';
const CACHE_DATI = 'tper-zone-calc-data-v15';

const ASSET_STATICI = [
  './',
  './index.html',
  './app.js',
  './routing.js',
  './vista-percorso.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

const ASSET_DATI = [
  './data/fermate.json',
  './data/linee-per-fermata.json',
  './data/orari.json',
  './data/orari.json.gz',
  './data/tracciati.json',
  './data/tracciati.json.gz'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATICA).then((cache) => cache.addAll(ASSET_STATICI))
  );
  // La nuova versione resta in attesa finché l'utente non tocca "Aggiorna":
  // così si evita di servire metà app vecchia e metà nuova.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomi) => Promise.all(
      nomi
        .filter((n) => n !== CACHE_STATICA && n !== CACHE_DATI)
        .map((n) => caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  const isDato = ASSET_DATI.some((p) => url.pathname.endsWith(p.replace('./', '/')));

  if (isDato) {
    event.respondWith(
      caches.open(CACHE_DATI).then((cache) =>
        cache.match(event.request).then((rispostaCache) => {
          // no-cache: la rivalidazione non deve accontentarsi della copia
          // nella cache HTTP del browser, o i dati aggiornati non arriverebbero.
          const fetchPromise = fetch(event.request, { cache: 'no-cache' })
            .then((rispostaRete) => {
              cache.put(event.request, rispostaRete.clone());
              return rispostaRete;
            })
            .catch(() => rispostaCache);
          return rispostaCache || fetchPromise;
        })
      )
    );
    return;
  }

  // Network-first per l'app (così un aggiornamento si vede al primo ricaricamento),
  // con la copia in cache come fallback offline.
  const isApp = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/app.js') || url.pathname.endsWith('/routing.js') || url.pathname.endsWith('/vista-percorso.js');
  if (isApp) {
    event.respondWith(
      fetch(event.request)
        .then((rispostaRete) => {
          const copia = rispostaRete.clone();
          caches.open(CACHE_STATICA).then((cache) => cache.put(event.request, copia)).catch(() => {});
          return rispostaRete;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((rispostaCache) => {
      return rispostaCache || fetch(event.request).catch(() => caches.match('./index.html'));
    })
  );
});
