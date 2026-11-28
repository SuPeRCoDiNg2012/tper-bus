// sw.js — Service Worker di Muovi Bologna
// Cache-first per gli asset statici dell'app, stale-while-revalidate per i JSON dati.
// Le richieste verso altri domini (mappa, relay degli orari live) non vengono intercettate:
// gli orari in tempo reale non devono mai arrivare dalla cache.

const CACHE_STATICA = 'muovi-bologna-static-v225';
const CACHE_DATI = 'muovi-bologna-data-v225';
// Mappa: cache non versionata, così la zona salvata sopravvive agli aggiornamenti
// dell'app. Non entra in pulisciCacheVecchie (che guarda solo i nomi -vN).
const CACHE_MAPPA = 'muovi-bologna-mappa';
const MAPPA_HOST = 'tiles.openfreemap.org';
const MAPPA_MAX = 900;

const ASSET_STATICI = [
  './',
  './index.html',
  './app.min.js',
  './utilita.js',
  './routing.js',
  './posizioni.js',
  './intelligenza.js'
  './linee.js',
  './icone.js',
  './push.js',
  './lingua.js',
  './vista-percorso.js',
  './tariffe.js',
  './piedi.js',
  './manifest.json',
  './privacy.html',
  './termini.html',
  './cookie.html',
  './note-legali.html',
  './changelog.html',
  './legale.css',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/marchio.svg',
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

// Potatura: nella cache statica restano le voci della versione in uso. I file
// che non esistono più (rinominati o rimossi) occupavano spazio per sempre.
const PATH_STATICI = new Set(ASSET_STATICI.map((p) => new URL(p, self.location.href).pathname));

function potaturaCache() {
  return caches.open(CACHE_STATICA).then((cache) =>
    cache.keys().then((richieste) => Promise.all(
      richieste
        .filter((richiesta) => !PATH_STATICI.has(new URL(richiesta.url).pathname))
        .map((richiesta) => cache.delete(richiesta))
    ))
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' salta la cache HTTP del browser: senza, una nuova
    // versione del service worker poteva installare i file vecchi.
    // allSettled e non addAll: un singolo asset mancante (un'icona, una pagina)
    // faceva fallire tutta l'installazione e l'app restava senza cache offline.
    caches.open(CACHE_STATICA).then((cache) =>
      Promise.allSettled(ASSET_STATICI.map((url) =>
        cache.add(new Request(url, { cache: 'reload' }))
      )).then((esiti) => {
        const falliti = esiti.filter((esito) => esito.status === 'rejected');
        if (falliti.length) console.warn('[sw] asset non in cache:', falliti.length);
      })
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
        .filter((n) => n !== CACHE_STATICA && n !== CACHE_DATI && n !== CACHE_MAPPA)
        .map((n) => caches.delete(n))
    )).then(potaturaCache)
  );
  self.clients.claim();
});

// Notifiche locali: le mostra l'app con registration.showNotification(); il
// tocco riapre gli orari della fermata che le ha generate. Le stesse notifiche
// arrivano dal Worker (push/worker.js) quando l'app è chiusa, con lo stesso
// `tag`: se sono tutte e due in viaggio, la seconda sostituisce la prima.
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
  // Spedita dal Worker (push/worker.js) quando l'app è chiusa: stessa forma
  // delle notifiche locali, così il tocco apre gli orari della fermata.
  event.waitUntil(self.registration.showNotification(dati.titolo || 'Muovi Bologna', {
    body: dati.corpo || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: dati.tag || 'muovi-bologna-push',
    renotify: true,
    data: { fermata: dati.fermata || '' }
  }));
});

// Potatura della cache mappa: si tengono i tasselli più recenti. Senza, la
// mappa scaricata in mesi di uso poteva occupare centinaia di MB.
function potaMappa(cache) {
  return cache.keys().then((chiavi) => Promise.all(
    chiavi.slice(0, Math.max(0, chiavi.length - MAPPA_MAX)).map((richiesta) => cache.delete(richiesta))
  ));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Mappa vettoriale: cache-first. Quello che si è già visto non si riscarica
  // (meno dati) e la zona salvata si apre anche senza rete.
  if (url.hostname === MAPPA_HOST) {
    event.respondWith(
      caches.open(CACHE_MAPPA).then((cache) =>
        cache.match(event.request).then((rispostaCache) => {
          if (rispostaCache) return rispostaCache;
          return fetch(event.request).then((rispostaRete) => {
            if (rispostaRete && (rispostaRete.ok || rispostaRete.type === 'opaque')) {
              const copia = rispostaRete.clone();
              cache.put(event.request, copia).then(() => potaMappa(cache)).catch(() => {});
            }
            return rispostaRete;
          }).catch(() => rispostaCache || Response.error());
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  const isDato = ASSET_DATI.some((p) => url.pathname.endsWith(p.replace('./', '/')));

  if (isDato) {
    event.respondWith(
      caches.open(CACHE_DATI).then((cache) =>
        cache.match(event.request).then((rispostaCache) => {
          // no-cache: la rivalidazione non deve accontentarsi della copia
          // nella cache HTTP del browser, o i dati aggiornati non arriverebbero.
          const fetchPromise = fetch(event.request, { cache: 'no-cache' })
            .then((rispostaRete) => {
              // Solo risposte buone in cache: un 404 o un 500 salvato qui
              // restava servito per giorni come se fosse un dato valido.
              if (rispostaRete && rispostaRete.ok) cache.put(event.request, rispostaRete.clone());
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
          url.pathname.endsWith('/app.js') || url.pathname.endsWith('/app.min.js') || url.pathname.endsWith('/routing.js') ||
      url.pathname.endsWith('/posizioni.js') ||
    url.pathname.endsWith('/utilita.js') || url.pathname.endsWith('/vista-percorso.js') ||
    url.pathname.endsWith('/icone.js') || url.pathname.endsWith('/push.js') ||
    url.pathname.endsWith('/lingua.js') || url.pathname.endsWith('/tariffe.js') ||
    url.pathname.endsWith('/piedi.js') || url.pathname.endsWith('/manifest.json') ||
    url.pathname.endsWith('/privacy.html') || url.pathname.endsWith('/changelog.html');
  if (isApp) {
    event.respondWith(
      // no-cache rivalida sempre: il network-first non basta se il browser
      // risponde dalla propria cache HTTP con l'app.js di ieri.
      fetch(event.request, { cache: 'no-cache' })
        .then((rispostaRete) => {
          if (rispostaRete && rispostaRete.ok) {
            const copia = rispostaRete.clone();
            caches.open(CACHE_STATICA).then((cache) => cache.put(event.request, copia)).catch(() => {});
          }
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
        // Una navigazione sconosciuta va in rete (così un URL inesistente
        // risponde 404 davvero) e solo offline ripiega sull'app.
        if (event.request.mode === 'navigate') {
          return fetch(event.request).catch(() => cache.match('./index.html').then((r) => r || Response.error()));
        }
        return fetch(event.request);
      })
    )
  );
});
