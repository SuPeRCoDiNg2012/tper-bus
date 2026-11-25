// sw.js — Service Worker di Muovi Bologna
// Cache-first per gli asset statici dell'app, stale-while-revalidate per i JSON dati.
// Le richieste verso altri domini (mappa, relay degli orari live) non vengono intercettate:
// gli orari in tempo reale non devono mai arrivare dalla cache.

const CACHE_STATICA = 'muovi-bologna-static-v118';
const CACHE_DATI = 'muovi-bologna-data-v118';

const ASSET_STATICI = [
  './',
  './index.html',
  './app.js',
  './utilita.js',
  './routing.js',
  './icone.js',
  './vista-percorso.js',
  './tariffe.js',
  './piedi.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const ASSET_DATI = [
  './data/fermate.json',
  './data/linee-per-fermata.json',
  './data/linee-colori.json',
  './data/orari.json',
  './data/orari.json.gz',
  './data/tracciati.json',
  './data/tracciati.json.gz'
];

// Le cache si accumulavano una per versione finché nessuno premeva "Aggiorna":
// qui si tengono solo la versione scaricata e quella ancora in uso.
function versioneCache(nome) {
  const trovata = String(nome).match(/-v(\d+)$/);
  return trovata ? Number(trovata[1]) : 0;
}

function pulisciCacheVecchie() {
  const attuale = versioneCache(CACHE_STATICA);
  return caches.keys().then((nomi) => Promise.all(
    nomi
      .filter((n) => versioneCache(n) && versioneCache(n) < attuale - 1)
      .map((n) => caches.delete(n))
  ));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' salta la cache HTTP del browser: senza, una nuova
    // versione del service worker poteva installare i file vecchi.
    caches.open(CACHE_STATICA).then((cache) =>
      cache.addAll(ASSET_STATICI.map((url) => new Request(url, { cache: 'reload' })))
    ).then(pulisciCacheVecchie)
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

// Notifiche locali: le mostra l'app con registration.showNotification(); il
// tocco riapre gli orari della fermata che le ha generate. Il gestore `push`
// non ha ancora un mittente: senza un server non arriva nulla, ma se un giorno
// si aggiunge un backend l'app è già pronta a riceverlo.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const fermata = (event.notification.data && event.notification.data.fermata) || '';
  const destinazione = './' + (fermata ? '?fermata=' + encodeURIComponent(fermata) : '');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clienti) => {
      const aperto = clienti.find((c) => c.url.indexOf(self.location.origin) === 0);
      if (aperto) {
        aperto.focus();
        if (fermata) aperto.postMessage({ tipo: 'fermata', id: fermata });
        return null;
      }
      return self.clients.openWindow(destinazione);
    })
  );
});

self.addEventListener('push', (event) => {
  let dati = {};
  try { dati = event.data ? event.data.json() : {}; } catch (errore) { dati = {}; }
  event.waitUntil(self.registration.showNotification(dati.titolo || 'Muovi Bologna', {
    body: dati.corpo || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { fermata: dati.fermata || '' }
  }));
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
  // Tutti i moduli dell'app vanno in network-first: se uno solo restasse
  // cache-first, un aggiornamento darebbe app.js nuovo con icone.js vecchio.
  const isApp = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app.js') || url.pathname.endsWith('/routing.js') ||
    url.pathname.endsWith('/utilita.js') || url.pathname.endsWith('/vista-percorso.js') ||
    url.pathname.endsWith('/icone.js') || url.pathname.endsWith('/tariffe.js') ||
    url.pathname.endsWith('/piedi.js') || url.pathname.endsWith('/manifest.json');
  if (isApp) {
    event.respondWith(
      // no-cache rivalida sempre: il network-first non basta se il browser
      // risponde dalla propria cache HTTP con l'app.js di ieri.
      fetch(event.request, { cache: 'no-cache' })
        .then((rispostaRete) => {
          const copia = rispostaRete.clone();
          caches.open(CACHE_STATICA).then((cache) => cache.put(event.request, copia)).catch(() => {});
          return rispostaRete;
        })
        .catch(() => caches.open(CACHE_STATICA).then((cache) =>
          cache.match(event.request).then((r) => r || cache.match('./index.html'))))
    );
    return;
  }

  // Solo la cache della versione che sta servendo: caches.match() guarda in
  // tutte, compresa quella appena installata dalla versione in attesa, e
  // mescolerebbe file di due versioni diverse.
  event.respondWith(
    caches.open(CACHE_STATICA).then((cache) =>
      cache.match(event.request).then((rispostaCache) => {
        if (rispostaCache) return rispostaCache;
        if (event.request.mode === 'navigate') {
          return cache.match('./index.html').then((r) => r || fetch(event.request));
        }
        return fetch(event.request);
      })
    )
  );
});
