/* TPER Zone Calc — logica dell'app
   Dati fermate: open data TPER/Regione Emilia-Romagna
   Orari in tempo reale: web service pubblico HelloBus di TPER */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Configurazione
   * ------------------------------------------------------------------ */
  const URL_FERMATE = './data/fermate.json';
  const URL_LINEE = './data/linee-per-fermata.json';
  const TIMEOUT_FETCH = 10000;
  const K_FERMATE = 'tperzc_fermate_v2';
  const K_LINEE = 'tperzc_linee_v2';
  const K_RECENTI = 'tperzc_recenti_v2';
  const K_TRATTA = 'tperzc_tratta_v2';
  const K_QUANDO = 'tperzc_quando_v1';
  const K_PROXY = 'tperzc_proxy';
  const K_RELAY = 'tperzc_relay';
  const URL_UFFICIALE = 'https://solweb.tper.it/web/tools/zone-calculator.aspx';
  const HELLOBUS = 'https://hellobuswsweb.tper.it/web-services/hellobus.asmx/QueryHellobus';
  const RELAY_PREDEFINITO = 'https://api.allorigins.win/raw?url=';
  const INTERVALLO_LIVE = 30000;

  const ZONE_URBANE = new Set(['500', '501', '502', '503', '504', '505', '506', '507', '508', '509']);
  const TARIFFE_BUS = { 1: 2.30, 2: 2.90, 3: 3.70, 4: 4.50 };
  const TARIFFE_TRENO = { 1: 2.30, 2: 3.10, 3: 3.90 };

  const FERMATE_FALLBACK = [
    { id: 'BO0001', nome: 'Bologna - Piazza Maggiore', tipo: 'bus', zona: '500', lat: 44.494373, lon: 11.343674 },
    { id: 'BO0003', nome: 'Bologna - Stazione Centrale', tipo: 'entrambi', zona: '500', lat: 44.5058, lon: 11.3426 },
    { id: 'BO0010', nome: 'San Lazzaro di Savena - Centro', tipo: 'bus', zona: '501', lat: 44.4735, lon: 11.4053 },
    { id: 'BO0016', nome: 'Casalecchio di Reno - Centro', tipo: 'bus', zona: '507', lat: 44.4775, lon: 11.2827 },
    { id: 'BO0021', nome: 'Zola Predosa - Centro', tipo: 'bus', zona: '571', lat: 44.4919, lon: 11.2199 },
    { id: 'BO0028', nome: 'Sasso Marconi - Centro', tipo: 'bus', zona: '581', lat: 44.4006, lon: 11.2467 },
    { id: 'BO0033', nome: 'Imola - Stazione', tipo: 'treno', zona: '510', lat: 44.3575, lon: 11.7165 }
  ];

  const PRINCIPALI = ['100', '2', '3', '601', '463', '397', 'TRN001', '500135', '500131'];

  /* ------------------------------------------------------------------ *
   * Stato
   * ------------------------------------------------------------------ */
  let fermate = [];
  let lineePerFermata = {};
  let aggiornato = null;
  const sel = { partenza: null, destinazione: null };
  let abbonamento = false;
  let mappa = null;
  const marker = { partenza: null, destinazione: null };
  let statoSheet = 'meta';
  let tabAttivo = 'viaggio';
  let campoAttivo = null;
  let stopLiveRuolo = 'partenza';
  let posizioneUtente = null;
  let eventoInstallazione = null;
  let liveAbort = null;
  let timerLive = null;
  let trascinando = false;
  let sopprimiClick = false;

  const live = { items: [], ts: 0, stato: 'idle', caricamento: false, errore: null, stopId: null };

  const $ = (id) => document.getElementById(id);
  const ICONA_BUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="12.5" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17" stroke="currentColor" stroke-width="1.5"/><circle cx="7.6" cy="18.6" r="1.5" fill="currentColor"/><circle cx="16.4" cy="18.6" r="1.5" fill="currentColor"/></svg>';
  const ICONA_TRENO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="4.5" stroke="currentColor" stroke-width="1.7"/><path d="M5 10h14" stroke="currentColor" stroke-width="1.5"/><circle cx="8.6" cy="19.4" r="1.4" fill="currentColor"/><circle cx="15.4" cy="19.4" r="1.4" fill="currentColor"/></svg>';
  // L'icona pedana vive con il resto della grafica del percorso.
  const ICONA_PEDANA = VistaPercorso.ICONA_PEDANA;
  const ICONA_REFRESH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M20 4.5V10h-5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICONA_INFO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.5v6M12 7.4v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

  /* ------------------------------------------------------------------ *
   * Utility
   * ------------------------------------------------------------------ */
  function esc(valore) {
    return String(valore == null ? '' : valore)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function leggi(chiave) {
    try { return localStorage.getItem(chiave); } catch (e) { return null; }
  }
  function scrivi(chiave, valore) {
    try { localStorage.setItem(chiave, valore); } catch (e) { /* storage non disponibile */ }
  }
  function leggiJSON(chiave) {
    try { return JSON.parse(localStorage.getItem(chiave) || 'null'); } catch (e) { return null; }
  }
  function normalizza(testo) {
    return (testo || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function due(valore) { return String(valore).padStart(2, '0'); }
  function euro(valore) {
    return valore === 0 ? '0,00 €' : valore.toFixed(2).replace('.', ',') + ' €';
  }
  function tipoEtichetta(tipo) {
    return tipo === 'treno' ? 'Treno' : tipo === 'entrambi' ? 'Bus e treno' : 'Bus';
  }
  function iconaTipo(tipo) {
    return tipo === 'treno' ? ICONA_TRENO : ICONA_BUS;
  }
  function classeTipo(tipo) {
    return tipo === 'treno' ? 'treno' : 'bus';
  }
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }
  function orarioCorto(data) {
    return new Date(data).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  function lineaDi(fermata) {
    return (lineePerFermata[fermata.id] || []);
  }
  function metaFermata(f) {
    const linee = lineaDi(f).slice(0, 3).join(' · ');
    return 'Palina ' + f.id + ' · ' + tipoEtichetta(f.tipo) + ' · Zona ' + f.zona + (linee ? ' · ' + linee : '');
  }

  // Codice palina e indirizzo breve: servono a riconoscere la fermata sul posto.
  function riferimentoFermata(f) {
    if (!f) return '';
    return 'Palina ' + f.id + (f.indirizzo ? ' · ' + f.indirizzo : '');
  }
  function mostraToast(messaggio, durata) {
    const toast = $('toast');
    toast.textContent = messaggio;
    toast.hidden = false;
    clearTimeout(mostraToast._timer);
    mostraToast._timer = setTimeout(() => { toast.hidden = true; }, durata || 2600);
  }

  /* ------------------------------------------------------------------ *
   * Dati fermate
   * ------------------------------------------------------------------ */
  function fetchConTimeout(url, ms) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
  }

  async function caricaDati() {
    try {
      const [rispostaFermate, risposteLinee] = await Promise.all([
        fetchConTimeout(URL_FERMATE, TIMEOUT_FETCH),
        fetchConTimeout(URL_LINEE, TIMEOUT_FETCH)
      ]);
      if (!rispostaFermate.ok || !risposteLinee.ok) throw new Error('Risposta non valida');
      const datiFermate = await rispostaFermate.json();
      const datiLinee = await risposteLinee.json();
      fermate = datiFermate.fermate || [];
      lineePerFermata = datiLinee.linee || {};
      aggiornato = datiFermate.aggiornato || null;
      scrivi(K_FERMATE, JSON.stringify(datiFermate));
      scrivi(K_LINEE, JSON.stringify(datiLinee));
    } catch (errore) {
      const cacheFermate = leggiJSON(K_FERMATE);
      const cacheLinee = leggiJSON(K_LINEE);
      if (cacheFermate && cacheFermate.fermate && cacheFermate.fermate.length) {
        fermate = cacheFermate.fermate;
        lineePerFermata = (cacheLinee && cacheLinee.linee) || {};
        aggiornato = cacheFermate.aggiornato || null;
        mostraToast('Offline: uso l\'ultimo elenco fermate salvato');
      } else {
        fermate = FERMATE_FALLBACK;
        lineePerFermata = {};
        mostraToast('Elenco fermate ridotto: connessione non disponibile');
      }
    }
  }

  function fermataPerId(id) {
    return fermate.find((f) => f.id === id) || null;
  }

  function cercaFermate(query) {
    const q = normalizza(query);
    if (q.length < 2) return [];
    const inizio = [];
    const dentro = [];
    fermate.forEach((f) => {
      const nome = normalizza(f.nome);
      if (nome.startsWith(q)) inizio.push(f);
      else if (nome.includes(q)) dentro.push(f);
    });
    return inizio.concat(dentro).slice(0, 14);
  }

  function fermatePrincipali() {
    const trovate = PRINCIPALI.map(fermataPerId).filter(Boolean);
    return trovate.length ? trovate : fermate.slice(0, 8);
  }

  function distanzaMetri(a, b) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function fermateVicine(lat, lon, quantita, escludiId) {
    return fermate
      .filter((f) => f.lat != null && f.lon != null && f.id !== escludiId)
      .map((f) => ({ f: f, d: distanzaMetri({ lat: lat, lon: lon }, f) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, quantita || 6)
      .map((voce) => voce.f);
  }

  // Due pali della stessa fermata hanno lo stesso nome: nell'elenco ne basta uno.
  function senzaDoppioni(elenco) {
    const visti = new Set();
    return elenco.filter((f) => {
      const chiave = normalizza(f.nome);
      if (visti.has(chiave)) return false;
      visti.add(chiave);
      return true;
    });
  }

  function recenti() {
    const ids = leggiJSON(K_RECENTI) || [];
    return ids.map(fermataPerId).filter(Boolean).slice(0, 5);
  }

  function aggiungiRecente(f) {
    const ids = (leggiJSON(K_RECENTI) || []).filter((id) => id !== f.id);
    ids.unshift(f.id);
    scrivi(K_RECENTI, JSON.stringify(ids.slice(0, 8)));
  }

  /* ------------------------------------------------------------------ *
   * Mappa
   * ------------------------------------------------------------------ */
  function creaPin(ruolo) {
    const elemento = document.createElement('div');
    elemento.className = 'pin-mappa';
    elemento.setAttribute('role', 'button');
    elemento.setAttribute('aria-label', ruolo === 'partenza' ? 'Fermata di partenza' : 'Fermata di destinazione');
    elemento.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">' +
      '<path d="M12 22.5s7.3-7.7 7.3-12.7A7.3 7.3 0 0 0 4.7 9.8C4.7 14.8 12 22.5 12 22.5z" fill="' +
      (ruolo === 'partenza' ? '#C1121F' : '#1A1A1A') + '" stroke="#fff" stroke-width="1.3"/>' +
      '<circle cx="12" cy="9.7" r="2.6" fill="#fff"/></svg>';
    elemento.addEventListener('click', (evento) => {
      evento.stopPropagation();
      stopLiveRuolo = ruolo;
      attivaTab('live');
      impostaSheet('meta');
    });
    return elemento;
  }

  function initMappa() {
    const elemento = $('mappa');
    if (!window.maplibregl) {
      elemento.classList.add('senza-mappa');
      elemento.innerHTML = '<p>Mappa non disponibile offline: la ricerca fermate funziona lo stesso.</p>';
      return;
    }
    mappa = new maplibregl.Map({
      container: elemento,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [11.3426, 44.4949],
      zoom: 13,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false
    });
    if (mappa.touchZoomRotate) mappa.touchZoomRotate.disableRotation();
    // Le attribuzioni (OpenFreeMap / OpenMapTiles / OpenStreetMap) arrivano già dallo stile.
    mappa.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    mappa.on('dragstart', () => {
      if (statoSheet !== 'peek') impostaSheet('peek');
    });
    mappa.on('click', chiudiOverlay);
    mappa.on('load', () => {
      aggiungiLivelliPercorso();
      aggiornaMarker();
      inquadra(false);
      disegnaTracciato();
    });
    mappa.on('style.load', aggiungiLivelliPercorso);
    mappa.on('idle', aggiungiLivelliPercorso);
  }

  function aggiornaMarker() {
    if (!mappa) return;
    ['partenza', 'destinazione'].forEach((ruolo) => {
      const f = sel[ruolo];
      if (!f || f.lat == null || f.lon == null) {
        if (marker[ruolo]) { marker[ruolo].remove(); marker[ruolo] = null; }
        return;
      }
      if (marker[ruolo]) {
        marker[ruolo].setLngLat([f.lon, f.lat]);
        return;
      }
      marker[ruolo] = new maplibregl.Marker({ element: creaPin(ruolo), anchor: 'bottom' })
        .setLngLat([f.lon, f.lat])
        .addTo(mappa);
    });
  }

  function inquadra(animato) {
    if (!mappa) return;
    const punti = [];
    if (sel.partenza && sel.partenza.lat != null) punti.push([sel.partenza.lon, sel.partenza.lat]);
    if (sel.destinazione && sel.destinazione.lat != null) punti.push([sel.destinazione.lon, sel.destinazione.lat]);
    // Il pannello inferiore copre metà schermo: tengo i pin nella parte alta.
    const copertura = Math.min(430, Math.round(window.innerHeight * 0.52));
    const durata = animato === false ? 0 : 600;
    if (punti.length === 2) {
      const limiti = new maplibregl.LngLatBounds();
      punti.forEach((punto) => limiti.extend(punto));
      mappa.fitBounds(limiti, {
        padding: { top: 205, bottom: copertura, left: 50, right: 50 },
        maxZoom: 15,
        duration: durata
      });
    } else if (punti.length === 1) {
      mappa.easeTo({
        center: punti[0],
        zoom: 15,
        duration: durata,
        offset: [0, -Math.round(copertura / 2) + 40]
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Tracciato delle linee sulla mappa
   * ------------------------------------------------------------------ */
  let inquadratoPerFermate = null;
  let ultimeFeatures = [];

  // Idempotente e senza dipendere da un singolo evento: lo stile può finire di
  // caricarsi dopo il primo disegno, e isStyleLoaded() non è affidabile qui.
  function aggiungiLivelliPercorso() {
    if (!mappa || mappa.getSource('percorso')) return;
    try {
      creaLivelliPercorso();
    } catch (errore) { /* stile non pronto: si riproverà */ }
  }

  function creaLivelliPercorso() {
    const vuoto = { type: 'FeatureCollection', features: [] };
    mappa.addSource('percorso', { type: 'geojson', data: vuoto });
    mappa.addSource('percorso-fermate', { type: 'geojson', data: vuoto });
    mappa.addSource('percorso-nodi', { type: 'geojson', data: vuoto });
    mappa.addLayer({
      id: 'percorso-piedi',
      type: 'line',
      source: 'percorso',
      filter: ['==', ['get', 'modo'], 'piedi'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1A1A1A', 'line-width': 3, 'line-opacity': 0.45, 'line-dasharray': [1.5, 1.6] }
    });
    mappa.addLayer({
      id: 'percorso-bordo',
      type: 'line',
      source: 'percorso',
      filter: ['all', ['==', ['get', 'modo'], 'bus'], ['!=', ['get', 'ufficiale'], false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 9, 'line-opacity': 0.95 }
    });
    mappa.addLayer({
      id: 'percorso-linea',
      type: 'line',
      source: 'percorso',
      filter: ['all', ['==', ['get', 'modo'], 'bus'], ['!=', ['get', 'ufficiale'], false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#C1121F', 'line-width': 5.5 }
    });
    // Tratti senza geometria GTFS: linea diritta tratteggiata, così si vede
    // subito che non è il percorso reale del bus.
    mappa.addLayer({
      id: 'percorso-supplenza-bordo',
      type: 'line',
      source: 'percorso',
      filter: ['all', ['==', ['get', 'modo'], 'bus'], ['==', ['get', 'ufficiale'], false]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 7, 'line-opacity': 0.9, 'line-dasharray': [2, 1.6] }
    });
    mappa.addLayer({
      id: 'percorso-supplenza',
      type: 'line',
      source: 'percorso',
      filter: ['all', ['==', ['get', 'modo'], 'bus'], ['==', ['get', 'ufficiale'], false]],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#C1121F', 'line-width': 3.5, 'line-dasharray': [2, 1.6] }
    });
    mappa.addLayer({
      id: 'percorso-fermate-punti',
      type: 'circle',
      source: 'percorso-fermate',
      paint: {
        'circle-radius': 3.2,
        'circle-color': '#FFFFFF',
        'circle-stroke-color': '#C1121F',
        'circle-stroke-width': 2
      }
    });
    // Nodi del viaggio: partenza rossa, arrivo nero, cambio come anello bianco
    // con corona esterna, così non si confonde con i pallini delle fermate.
    mappa.addLayer({
      id: 'percorso-nodi-alone',
      type: 'circle',
      source: 'percorso-nodi',
      paint: { 'circle-radius': 9, 'circle-color': '#FFFFFF', 'circle-opacity': 0.92 }
    });
    mappa.addLayer({
      id: 'percorso-nodi-corona',
      type: 'circle',
      source: 'percorso-nodi',
      filter: ['==', ['get', 'ruolo'], 'cambio'],
      paint: {
        'circle-radius': 10.5,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#C1121F',
        'circle-stroke-width': 1.6,
        'circle-stroke-opacity': 0.55
      }
    });
    mappa.addLayer({
      id: 'percorso-nodi-punti',
      type: 'circle',
      source: 'percorso-nodi',
      paint: {
        'circle-radius': ['match', ['get', 'ruolo'], 'cambio', 5.5, 6.5],
        'circle-color': ['match', ['get', 'ruolo'], 'partenza', '#C1121F', 'arrivo', '#1A1A1A', '#FFFFFF'],
        'circle-stroke-width': ['match', ['get', 'ruolo'], 'cambio', 3, 2.5],
        'circle-stroke-color': ['match', ['get', 'ruolo'], 'partenza', '#FFFFFF', 'arrivo', '#FFFFFF', '#C1121F']
      }
    });
  }

  function segmento(modo, coordinate, ufficiale) {
    return {
      type: 'Feature',
      properties: { modo: modo, ufficiale: ufficiale !== false },
      geometry: { type: 'LineString', coordinates: coordinate }
    };
  }

  function nodo(ruolo, coordinate) {
    return { type: 'Feature', properties: { ruolo: ruolo }, geometry: { type: 'Point', coordinates: coordinate } };
  }

  function coordinateFermata(id) {
    const f = fermataPerId(id);
    return f && f.lat != null && f.lon != null ? [f.lon, f.lat] : null;
  }

  /* --- Aggancio alla rete stradale (OSRM) ------------------------------ *
   * Le shapes TPER sono generalizzate: tra due punti il bus segue le strade,
   * quindi il tracciato ufficiale viene agganciato con un map matching. Le
   * geometrie agganciate restano in localStorage; se il servizio non risponde
   * si disegna il tracciato ufficiale, e se manca anche quello la linea dritta.
   * ------------------------------------------------------------------- */
  const URL_SNAP = 'https://router.project-osrm.org/match/v1/driving/';
  const K_SNAP = 'tperzc_snap_v3';
  const SNAP_MAX_PUNTI = 9;   // limite del servizio pubblico
  const SNAP_MAX_RICHIESTE = 40;
  let snapCache = null;
  let snapGenerazione = 0;
  let snapRichieste = 0;

  function snapCaricate() {
    if (snapCache) return snapCache;
    snapCache = new Map();
    const salvate = leggiJSON(K_SNAP);
    if (Array.isArray(salvate)) salvate.forEach((voce) => { if (voce && voce[0] && voce[1]) snapCache.set(voce[0], voce[1]); });
    return snapCache;
  }

  function snapSalvate() {
    if (!snapCache) return;
    const voci = Array.from(snapCache.entries()).slice(-80);
    const testo = JSON.stringify(voci);
    if (testo.length < 1200000) scrivi(K_SNAP, testo);
  }

  // Chianghe legata alle fermate servite dal tratto: se cambia il percorso,
  // cambia anche la geometria stradale attesa.
  function chiaveSnap(tappa, coordinate) {
    const primo = coordinate[0];
    const ultimo = coordinate[coordinate.length - 1];
    return tappa.forma + '|' + coordinate.length + '|' +
      primo[0].toFixed(4) + ',' + primo[1].toFixed(4) + '|' +
      ultimo[0].toFixed(4) + ',' + ultimo[1].toFixed(4);
  }

  function lunghezzaLinea(linea) {
    let totale = 0;
    for (let i = 1; i < linea.length; i += 1) {
      const dx = (linea[i][0] - linea[i - 1][0]) * 83000;
      const dy = (linea[i][1] - linea[i - 1][1]) * 111000;
      totale += Math.sqrt(dx * dx + dy * dy);
    }
    return totale;
  }

  function agganciaPezzo(punti, segnale) {
    const percorso = punti.map((punto) => punto[0].toFixed(5) + ',' + punto[1].toFixed(5)).join(';');
    const raggi = punti.map(() => 25).join(';');
    return fetch(URL_SNAP + percorso + '?geometries=geojson&overview=full&radiuses=' + raggi, {
      signal: segnale
    }).then((risposta) => (risposta.ok ? risposta.json() : null)).then((dati) => {
      if (!dati || dati.code !== 'Ok' || !dati.matchings || !dati.matchings.length) return null;
      const agganciata = dati.matchings[0].geometry && dati.matchings[0].geometry.coordinates;
      return agganciata && agganciata.length > 1 ? agganciata : null;
    }).catch(() => null);
  }

  // Aggancia il tracciato ufficiale alla rete stradale, a pezzi di pochi punti
  // (limite del servizio) e ricucendo il risultato. La forma resta quella del
  // bus: il matching la porta sulle strade senza inventare percorsi.
  async function agganciaTratta(tappa, geometria) {
    if (geometria.length < 3) return null;
    const chiave = chiaveSnap(tappa, geometria);
    const cache = snapCaricate();
    if (cache.has(chiave)) return cache.get(chiave);
    if (!navigator.onLine || snapRichieste >= SNAP_MAX_RICHIESTE) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      let agganciata = [];
      for (let inizio = 0; inizio < geometria.length - 1; inizio += SNAP_MAX_PUNTI - 1) {
        if (snapRichieste >= SNAP_MAX_RICHIESTE) return null;
        snapRichieste += 1;
        const pezzo = geometria.slice(inizio, inizio + SNAP_MAX_PUNTI);
        const risultatoPezzo = await agganciaPezzo(pezzo, controller.signal);
        if (!risultatoPezzo) return null;
        agganciata = agganciata.length ? agganciata.concat(risultatoPezzo.slice(1)) : risultatoPezzo;
        if (inizio + SNAP_MAX_PUNTI >= geometria.length) break;
      }
      if (agganciata.length < 2) return null;
      // Un risultato molto più lungo del tracciato ufficiale è un giro
      // sbagliato: meglio restare sulla forma originale.
      if (lunghezzaLinea(agganciata) > lunghezzaLinea(geometria) * 2 + 300) return null;
      cache.set(chiave, agganciata);
      snapSalvate();
      return agganciata;
    } catch (errore) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function distanzaTra(a, b) {
    return Math.hypot((a[0] - b[0]) * 83000, (a[1] - b[1]) * 111000);
  }

  // La linea deve toccare le fermate di salita e discesa, anche quando il
  // tracciato (ufficiale o agganciato) si ferma qualche metro prima.
  function estendiAgliEstremi(linea, da, a) {
    const copia = linea.slice();
    if (da && distanzaTra(copia[0], da) > 15) copia.unshift(da);
    if (a && distanzaTra(copia[copia.length - 1], a) > 15) copia.push(a);
    return copia;
  }

  // Restituisce, per ogni tratta, i punti e se vengono dal GTFS o sono la
  // supplenza diritta tra le due fermate.
  function geometrieUfficiali(tappe) {
    return tappe.map((tappa) => {
      const geometria = typeof TPERRouting !== 'undefined'
        ? TPERRouting.tratta(tappa.forma, tappa.da, tappa.a, tappa.sequenza)
        : null;
      if (geometria && geometria.length > 1) return { punti: geometria, ufficiale: true };
      const da = coordinateFermata(tappa.da);
      const a = coordinateFermata(tappa.a);
      return da && a ? { punti: [da, a], ufficiale: false } : null;
    });
  }

  // Disegna il percorso. `agganciate` contiene le geometrie stradali già
  // arrivate: al primo giro si disegna l'ufficiale e si chiede il resto.
  function disegnaTracciato(agganciate) {
    if (!mappa) return;
    // Lo stile può finire di caricarsi dopo il primo disegno: i livelli si
    // aggiungono qui appena è pronto, senza dipendere da un solo evento.
    if (!mappa.getSource('percorso')) aggiungiLivelliPercorso();
    const sorgente = mappa.getSource('percorso');
    if (!sorgente) return;
    const sorgenteFermate = mappa.getSource('percorso-fermate');

    const features = [];
    const fermate = [];
    const nodi = [];
    let senzaTracciato = 0;
    const esito = routing.stato === 'ok' ? routing.esito : null;
    if (esito && esito.tappe && esito.tappe.length) {
      const tappe = esito.tappe;
      const ufficiali = geometrieUfficiali(tappe);
      if (sel.partenza && sel.partenza.lat != null && esito.camminoIniziale > 0) {
        const prima = coordinateFermata(tappe[0].da);
        if (prima) features.push(segmento('piedi', [[sel.partenza.lon, sel.partenza.lat], prima]));
      }
      tappe.forEach((tappa, indice) => {
        const voce = ufficiali[indice];
        const agganciata = agganciate && agganciate[indice];
        const geometria = agganciata || (voce && voce.punti);
        const ufficiale = agganciata ? true : !!(voce && voce.ufficiale);
        if (geometria && geometria.length > 1) {
          features.push(segmento('bus', estendiAgliEstremi(geometria, coordinateFermata(tappa.da), coordinateFermata(tappa.a)), ufficiale));
          if (!ufficiale) senzaTracciato += 1;
        } else {
          senzaTracciato += 1;
        }
        const mezzo = tappa.stops || [];
        mezzo.forEach((id, posizione) => {
          if (posizione === 0 || posizione === mezzo.length - 1) return;
          const punto = coordinateFermata(id);
          if (punto) fermate.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: punto } });
        });
      });
      if (sel.destinazione && sel.destinazione.lat != null && esito.camminoFinale > 0) {
        const ultima = coordinateFermata(tappe[tappe.length - 1].a);
        if (ultima) features.push(segmento('piedi', [ultima, [sel.destinazione.lon, sel.destinazione.lat]]));
      }

      // Punti da evidenziare: partenza, ogni cambio e arrivo (una volta sola).
      const primo = coordinateFermata(tappe[0].da);
      const arrivo = coordinateFermata(tappe[tappe.length - 1].a);
      const uguali = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
      if (primo) nodi.push(nodo('partenza', primo));
      tappe.forEach((tappa, indice) => {
        if (indice === 0) return;
        const cambio = coordinateFermata(tappa.da);
        if (!cambio || uguali(cambio, arrivo) || uguali(cambio, primo)) return;
        if (nodi.some((n) => n.properties.ruolo === 'cambio' && uguali(n.geometry.coordinates, cambio))) return;
        nodi.push(nodo('cambio', cambio));
      });
      if (arrivo && !uguali(arrivo, primo)) nodi.push(nodo('arrivo', arrivo));

      // Un solo giro di aggancio per percorso: poi si ridisegna con le strade.
      if (!agganciate) {
        const generazione = ++snapGenerazione;
        const richieste = ufficiali.map((voce, indice) => {
          const tappa = tappe[indice];
          if (!voce || !voce.ufficiale || voce.punti.length < 3 || !(tappa.forma >= 0)) return Promise.resolve(null);
          return agganciaTratta(tappa, voce.punti);
        });
        Promise.all(richieste).then((risultati) => {
          if (generazione !== snapGenerazione || routing.stato !== 'ok') return;
          if (!risultati.some((voce) => voce)) return;
          disegnaTracciato(risultati);
        }).catch(() => { /* resta il tracciato ufficiale */ });
      }
    }
    ultimeFeatures = features;
    sorgente.setData({ type: 'FeatureCollection', features: features });
    if (sorgenteFermate) sorgenteFermate.setData({ type: 'FeatureCollection', features: fermate });
    const sorgenteNodi = mappa.getSource('percorso-nodi');
    if (sorgenteNodi) sorgenteNodi.setData({ type: 'FeatureCollection', features: nodi });
    // Il pannello dichiara quando un tratto non ha il tracciato ufficiale.
    const nota = $('nota-tracciato');
    if (nota) nota.hidden = senzaTracciato === 0;
    // Con le geometrie stradali il percorso può uscire dall'inquadratura
    // calcolata sulla forma ufficiale: si riadatta una volta.
    if (agganciate) inquadraPercorso(500);

    if (!features.length || !sel.partenza || !sel.destinazione) {
      inquadratoPerFermate = null;
      return;
    }
    const chiave = sel.partenza.id + '|' + sel.destinazione.id;
    if (inquadratoPerFermate === chiave) return;
    inquadraPercorso(700);
    inquadratoPerFermate = chiave;
  }

  // Inquadra il percorso disegnato lasciando libera la parte coperta dal
  // pannello: i margini seguono l'altezza reale della finestra.
  function inquadraPercorso(durata) {
    if (!mappa || !ultimeFeatures.length) return;
    const limiti = new maplibregl.LngLatBounds();
    ultimeFeatures.forEach((f) => f.geometry.coordinates.forEach((punto) => limiti.extend(punto)));
    const altezza = window.innerHeight;
    const sotto = Math.round(Math.min(Math.min(430, altezza * 0.52), altezza * 0.5));
    const sopra = Math.round(Math.min(200, altezza * 0.2));
    mappa.fitBounds(limiti, {
      padding: { top: sopra, bottom: sotto, left: 44, right: 44 },
      maxZoom: 16,
      duration: durata == null ? 500 : durata
    });
  }

  /* ------------------------------------------------------------------ *
   * Ricerca e selettore fermate
   * ------------------------------------------------------------------ */
  function voceHTML(f, ruolo) {
    const classe = classeTipo(f.tipo);
    return '<button class="voce" role="option" data-voce="' + esc(f.id) + '" data-ruolo="' + esc(ruolo) + '">' +
      '<span class="voce-ico ' + classe + '">' + iconaTipo(f.tipo) + '</span>' +
      '<span class="voce-testo"><span class="voce-nome">' + esc(f.nome) + '</span>' +
      (f.indirizzo ? '<span class="voce-indirizzo">' + esc(f.indirizzo) + '</span>' : '') +
      '<span class="voce-meta">' + esc(metaFermata(f)) + '</span></span>' +
      '<svg class="voce-freccia" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';
  }

  function gruppiSuggerimenti(campo, query) {
    if (query && query.trim().length >= 2) {
      const risultati = cercaFermate(query);
      return risultati.length ? [{ titolo: 'Risultati', items: risultati }] : [];
    }
    const gruppi = [];
    const usate = recenti();
    if (usate.length) gruppi.push({ titolo: 'Recenti', items: usate });
    let vicine = [];
    if (campo === 'destinazione' && sel.partenza && sel.partenza.lat != null) {
      vicine = fermateVicine(sel.partenza.lat, sel.partenza.lon, 6, sel.partenza.id);
    } else if (posizioneUtente) {
      vicine = fermateVicine(posizioneUtente.lat, posizioneUtente.lon, 6);
    }
    if (vicine.length) {
      gruppi.push({ titolo: campo === 'destinazione' && sel.partenza ? 'Vicine alla partenza' : 'Vicine a te', items: vicine });
    }
    if (!gruppi.length) gruppi.push({ titolo: 'Fermate principali', items: fermatePrincipali() });
    return gruppi;
  }

  function apriSuggerimenti(campo, query) {
    const input = $(campo === 'partenza' ? 'input-partenza' : 'input-destinazione');
    // I suggerimenti compaiono solo per il campo che l'utente sta usando davvero.
    if (document.activeElement !== input) return;
    campoAttivo = campo;
    const gruppi = gruppiSuggerimenti(campo, query);
    const lista = $('overlay-lista');
    $('overlay-titolo').textContent = campo === 'partenza' ? 'Da dove parti' : 'Dove vai';
    if (!gruppi.length) {
      if (!query || query.trim().length < 2) { chiudiOverlay(); return; }
      lista.innerHTML = '<p class="testo-intro" style="padding:16px 8px 12px">Nessuna fermata trovata. Prova con un altro nome.</p>';
    } else {
      lista.innerHTML = gruppi.map((gruppo) => {
        return '<div class="gruppo-titolo">' + esc(gruppo.titolo) + '</div>' +
          gruppo.items.map((f) => voceHTML(f, campo || 'destinazione')).join('');
      }).join('');
    }
    $('overlay-ricerca').hidden = false;
    $('backdrop').hidden = false;
  }

  function chiudiOverlay() {
    const overlay = $('overlay-ricerca');
    const backdrop = $('backdrop');
    if (overlay) overlay.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  function aggiornaPulisci() {
    document.querySelectorAll('[data-pulisci]').forEach((bottone) => {
      const ruolo = bottone.getAttribute('data-pulisci');
      bottone.hidden = !sel[ruolo];
    });
  }

  function impostaInput(ruolo) {
    const input = $(ruolo === 'partenza' ? 'input-partenza' : 'input-destinazione');
    input.value = sel[ruolo] ? sel[ruolo].nome : '';
    aggiornaPulisci();
  }

  function selezionaFermata(ruolo, f) {
    sel[ruolo] = f;
    impostaInput(ruolo);
    aggiungiRecente(f);
    chiudiOverlay();
    aggiornaMarker();
    salvaTratta();
    if (ruolo === 'partenza') {
      stopLiveRuolo = 'partenza';
      inquadra();
      if (!sel.destinazione) {
        impostaSheet('meta');
        renderViaggio();
        setTimeout(() => {
          $('input-destinazione').focus();
          apriSuggerimenti('destinazione', '');
        }, 180);
        return;
      }
    }
    if (sel.partenza && sel.destinazione) {
      stopLiveRuolo = 'partenza';
      inquadra();
      impostaSheet('meta');
      attivaTab('viaggio');
      live.items = [];
      live.ts = 0;
      live.stato = 'idle';
    }
    renderViaggio();
    renderLive();
  }

  function salvaTratta() {
    scrivi(K_TRATTA, JSON.stringify({
      partenza: sel.partenza ? sel.partenza.id : null,
      destinazione: sel.destinazione ? sel.destinazione.id : null
    }));
  }

  function ripristinaTratta() {
    const salvata = leggiJSON(K_TRATTA);
    if (salvata) {
      sel.partenza = salvata.partenza ? fermataPerId(salvata.partenza) : null;
      sel.destinazione = salvata.destinazione ? fermataPerId(salvata.destinazione) : null;
    }
    if (!sel.partenza && !sel.destinazione) {
      const predefinita = fermataPerId('100') || fermate.find((f) => /piazza maggiore/i.test(f.nome)) || fermate[0];
      if (predefinita) sel.partenza = predefinita;
    }
    impostaInput('partenza');
    impostaInput('destinazione');
  }

  /* ------------------------------------------------------------------ *
   * Calcolo zone e prezzo
   * ------------------------------------------------------------------ */
  function isZonaUrbana(zona) { return ZONE_URBANE.has(String(zona)); }

  function avvisoConfine(fermataExtraurbana) {
    const zona = String(fermataExtraurbana.zona);
    if (zona === '571') {
      return 'L\'abbonamento urbano vale fino a Ceretolo - Vivaldi / Riale - Centro (linee 94/83) oppure fino a Casalecchio - Garibaldi (treno per Vignola). Da lì in poi serve l\'integrazione per Zola Predosa.';
    }
    if (zona === '581' || zona === '582') {
      return 'L\'abbonamento urbano copre fino a Casalecchio - Garibaldi. Da lì in poi serve l\'integrazione per raggiungere ' + fermataExtraurbana.nome + '.';
    }
    return 'L\'abbonamento urbano copre la zona 500 e le zone neutre (501–509). Per raggiungere ' + fermataExtraurbana.nome + ' (zona ' + zona + ') serve un\'integrazione extraurbana.';
  }

  function calcola(partenza, destinazione, conAbbonamento) {
    const pUrbana = isZonaUrbana(partenza.zona);
    const dUrbana = isZonaUrbana(destinazione.zona);

    if (pUrbana && dUrbana) {
      return {
        badge: conAbbonamento ? 'verde' : 'rosso',
        titolo: conAbbonamento ? 'Coperto dall\'abbonamento urbano' : 'Biglietto urbano necessario',
        prezzo: conAbbonamento ? 0 : TARIFFE_BUS[1],
        prezzoNota: conAbbonamento ? 'Nessun costo aggiuntivo' : '1 zona · Area Urbana Bologna',
        avviso: null
      };
    }

    if (!pUrbana && !dUrbana) {
      return {
        badge: 'info',
        titolo: 'Tratta complessa',
        prezzo: null,
        prezzoNota: 'Numero di scatti variabile',
        avviso: 'Tratta tra due zone extraurbane: il numero di scatti dipende dal percorso esatto. Usa il calcolatore ufficiale TPER per il prezzo preciso.'
      };
    }

    const extraurbana = pUrbana ? destinazione : partenza;
    const urbana = pUrbana ? partenza : destinazione;
    const trattaTreno = extraurbana.tipo === 'treno' || urbana.tipo === 'treno';
    const tariffe = trattaTreno ? TARIFFE_TRENO : TARIFFE_BUS;

    if (conAbbonamento) {
      return {
        badge: 'arancio',
        titolo: 'Integrazione extraurbana necessaria',
        prezzo: tariffe[1],
        prezzoNota: '1 zona extraurbana oltre all\'abbonamento' + (trattaTreno ? ' · stima treno' : ''),
        avviso: avvisoConfine(extraurbana)
      };
    }

    return {
      badge: 'rosso',
      titolo: 'Biglietto a 2 zone necessario',
      prezzo: tariffe[2],
      prezzoNota: '2 zone' + (trattaTreno ? ' · stima treno, dipende dai km' : ''),
      avviso: null
    };
  }

  /* ------------------------------------------------------------------ *
   * Rendering: tab Viaggio
   * ------------------------------------------------------------------ */
  function aggiornaTestata() {
    const p = sel.partenza;
    const d = sel.destinazione;
    let titolo = 'Pianifica il tuo viaggio';
    let sotto = 'Zone, biglietto e bus in arrivo';
    if (p && !d) {
      titolo = 'Dove vuoi andare?';
      sotto = 'Partenza da ' + nomeBreve(p.nome);
    } else if (p && d) {
      titolo = nomeBreve(p.nome) + ' → ' + nomeBreve(d.nome);
      sotto = 'Zona ' + p.zona + ' → Zona ' + d.zona;
    }
    $('sheet-titolo').textContent = titolo;
    $('sheet-sotto').textContent = sotto;
    document.title = p && d ? titolo + ' · TPER Zone Calc' : 'TPER Zone Calc';
  }

  function htmlBiglietto(r) {
    const prezzo = r.prezzo === null ? '—' : (r.prezzo === 0 ? 'Incluso' : euro(r.prezzo));
    const nota = r.prezzo === 0 ? 'Nessun costo aggiuntivo' : r.prezzoNota;
    return '<div class="biglietto"><div class="biglietto-testo">' +
      '<span class="pill-stato ' + r.badge + '">' + esc(r.titolo) + '</span>' +
      '<span class="biglietto-nota">' + esc(nota) + '</span></div>' +
      '<span class="biglietto-prezzo">' + esc(prezzo) + '</span></div>';
  }

  function htmlRisultato(r) {
    let html = '<div id="blocco-percorso" class="blocco-percorso"></div>' + htmlBiglietto(r) + htmlInterruttore();
    if (r.avviso) {
      html += '<div class="avviso">' + ICONA_INFO + '<span>' + esc(r.avviso) + '</span></div>';
    }
    html += '<div class="azioni">' +
      '<button class="btn btn-primario" data-azione="live">Orari in tempo reale</button>' +
      '<button class="btn btn-secondario" data-azione="inverti">Inverti</button>' +
      '</div>';
    html += '<a class="link-ufficiale" href="' + URL_UFFICIALE + '" target="_blank" rel="noopener">Verifica sul calcolatore ufficiale TPER</a>';
    return html;
  }

  function htmlListaFermate(titolo, elenco, ruolo) {
    if (!elenco.length) return '';
    return '<h2 class="sezione-titolo">' + esc(titolo) + '</h2>' +
      elenco.map((f) => voceHTML(f, ruolo)).join('');
  }

  function htmlInterruttore() {
    return '<div class="riga-interruttore"><div><span class="etichetta">Ho l\'abbonamento urbano</span>' +
      '<span class="sotto">Copre la zona 500 e le zone neutre 501–509</span></div>' +
      '<label class="interruttore"><input type="checkbox" id="check-abbonamento"' + (abbonamento ? ' checked' : '') + ' aria-label="Ho l\'abbonamento urbano"><span class="binario"></span></label></div>';
  }

  // Unico punto in cui il tab Viaggio viene montato: evita di ripetere il
  // binding dell'interruttore abbonamento in ogni percorso di rendering.
  function montaPannelloViaggio(html) {
    $('pane-viaggio').innerHTML = html;
    const check = $('check-abbonamento');
    if (check) {
      check.addEventListener('change', () => {
        abbonamento = check.checked;
        renderViaggio();
      });
    }
  }

  function renderViaggio() {
    const risultato = (sel.partenza && sel.destinazione) ? calcola(sel.partenza, sel.destinazione, abbonamento) : null;
    aggiornaTestata();
    aggiornaChipAbbonamento();

    if (risultato) {
      montaPannelloViaggio(htmlRisultato(risultato));
      disegnaPercorso();
      calcolaPercorso();
      return;
    }

    let html = '<p class="testo-intro">' +
      (sel.partenza ? 'Scegli dove andare: mostro le fermate più vicine e il prezzo del biglietto.' : 'Cerca una fermata o tocca la mappa per iniziare.') +
      '</p>';
    if (sel.partenza && sel.partenza.lat != null) {
      const vicine = senzaDoppioni(fermateVicine(sel.partenza.lat, sel.partenza.lon, 10, sel.partenza.id)
        .filter((f) => f.nome !== sel.partenza.nome)).slice(0, 6);
      html += htmlListaFermate('Vicine a ' + nomeBreve(sel.partenza.nome), vicine, 'destinazione');
    } else {
      html += htmlListaFermate('Fermate vicine a te', posizioneUtente ? senzaDoppioni(fermateVicine(posizioneUtente.lat, posizioneUtente.lon, 8)).slice(0, 6) : fermatePrincipali(), 'destinazione');
    }
    montaPannelloViaggio(html + htmlInterruttore());
  }

  function aggiornaChipAbbonamento() {
    const chip = $('chip-abbonamento');
    chip.setAttribute('aria-pressed', abbonamento ? 'true' : 'false');
  }

  /* ------------------------------------------------------------------ *
   * Percorso con gli orari programmati (GTFS TPER)
   * ------------------------------------------------------------------ */
  const URL_ORARI_GZ = './data/orari.json.gz';
  const URL_ORARI = './data/orari.json';
  const URL_TRACC_GZ = './data/tracciati.json.gz';
  const URL_TRACC = './data/tracciati.json';
  // Giorno e ora scelti sopravvivono al ricaricamento: senza, ogni apertura
  // riparte da "adesso" (e la domenica finisce su "nessun collegamento").

  // Una data vecchia non serve più: si riparte da oggi invece di riaprire su un
  // giorno passato con orari che non interessano.
  const GIORNI_RICORDATI = 7;

  // Il formato non basta: "2026-99-99" o "25:70" hanno la forma giusta ma non
  // esistono, quindi si verifica che la data torni indietro identica.
  function dataDaGiorno(valore) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valore || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const valida = d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
    return valida ? d : null;
  }


  function orarioValido(valore) {
    const m = /^(\d{2}):(\d{2})$/.exec(valore || '');
    return !!m && +m[1] < 24 && +m[2] < 60;
  }

  function leggiQuando() {
    const salvato = leggiJSON(K_QUANDO) || {};
    const data = dataDaGiorno(salvato.giorno);
    // Confronto per giorni di calendario, non per ore trascorse: altrimenti
    // "7 giorni fa" verrebbe scartato già la sera stessa.
    const mezzanotte = new Date();
    mezzanotte.setHours(0, 0, 0, 0);
    // Le date future restano (si può pianificare in anticipo); quelle più
    // vecchie di una settimana vengono lasciate perdere.
    // Arrotondato: nei giorni di cambio ora legale la differenza non è un
    // multiplo esatto di 24 ore.
    const recente = data && Math.round((mezzanotte - data) / 86400000) <= GIORNI_RICORDATI;
    return {
      giorno: recente ? salvato.giorno : '',
      orario: orarioValido(salvato.orario) ? salvato.orario : ''
    };
  }

  function salvaQuando() {
    scrivi(K_QUANDO, JSON.stringify({ giorno: routing.giorno || '', orario: routing.orario || '' }));
  }

  const routing = {
    stato: 'idle', esito: null, errore: null, chiave: null, richiesta: 0, piedi: null,
    ...leggiQuando()
  };

  function oraAdesso() {
    const d = new Date();
    return hhmm(d.getHours() * 3600 + d.getMinutes() * 60);
  }

  function isoDi(d) {
    return d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate());
  }

  function oggiISO() { return isoDi(new Date()); }

  // Prima di disegnare o calcolare, data e ora devono avere un valore.
  function assicuraQuando() {
    if (!routing.orario) routing.orario = oraAdesso();
    if (!routing.giorno) routing.giorno = oggiISO();
  }

  // Unico punto di modifica di giorno/ora: stato, campi visibili, cache del
  // risultato e ricalcolo. Prima era ripetuto in quattro gestori diversi.
  function aggiornaQuando(giorno, orario) {
    routing.giorno = giorno || oggiISO();
    routing.orario = orario || oraAdesso();
    routing.chiave = null;
    salvaQuando();
    const campoData = $('input-data');
    const campoOra = $('input-ora');
    if (campoData) campoData.value = routing.giorno;
    if (campoOra) campoOra.value = routing.orario;
    calcolaPercorso();
  }

  function dataDaGiornoEOra(giorno, ora) {
    const d = new Date();
    const g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(giorno || '');
    if (g) d.setFullYear(parseInt(g[1], 10), parseInt(g[2], 10) - 1, parseInt(g[3], 10));
    const t = /^(\d{2}):(\d{2})$/.exec(ora || '');
    if (t) d.setHours(parseInt(t[1], 10), parseInt(t[2], 10), 0, 0);
    return d;
  }

  function hhmm(secondi) {
    const s = ((secondi % 86400) + 86400) % 86400;
    return due(Math.floor(s / 3600)) + ':' + due(Math.floor((s % 3600) / 60));
  }

  function minuti(secondi) { return Math.max(1, Math.round(secondi / 60)); }

  function nomeFermata(id) {
    const f = fermataPerId(id);
    return f ? f.nome : String(id);
  }

  // Nei percorsi "Bologna - " è rumore: la città è la stessa per tutte le fermate.
  function nomeBreve(nome) {
    return String(nome).replace(/^Bologna - /, '');
  }

  function etichettaFermata(id) { return nomeBreve(nomeFermata(id)); }

  // Solo una parte delle fermate del dataset regionale ha gli orari GTFS:
  // le altre (pali secondari, stazioni ferroviarie) vanno sostituite con quelle vicine.
  let fermateOrari = null;
  function fermateConOrari() {
    if (!fermateOrari && typeof TPERRouting !== 'undefined') {
      const elenco = TPERRouting.fermateDisponibili();
      if (elenco.length) fermateOrari = new Set(elenco);
    }
    return fermateOrari || new Set();
  }

  // Come fanno i pianificatori veri: si può salire anche alle fermate a pochi
  // passi da quella scelta (pali diversi della stessa fermata).
  function candidatiPercorso(fermata) {
    const disponibili = fermateConOrari();
    const elenco = [];
    if (disponibili.has(fermata.id)) elenco.push({ id: fermata.id, cammino: 0 });
    if (fermata.lat == null || fermata.lon == null) return elenco;
    fermateVicine(fermata.lat, fermata.lon, 40, fermata.id).forEach((vicina) => {
      if (elenco.length >= 5) return;
      if (!disponibili.has(vicina.id)) return;
      const distanza = distanzaMetri(fermata, vicina);
      if (distanza > 500) return;
      elenco.push({ id: vicina.id, cammino: Math.round(distanza * 1.15) });
    });
    return elenco;
  }

  function disegnaPercorso() {
    const blocco = $('blocco-percorso');
    if (!blocco) return;
    assicuraQuando();
    blocco.innerHTML = VistaPercorso.controlli(routing.giorno, routing.orario) +
      VistaPercorso.esito(routing, etichettaFermata);
    aggiornaScrim();
    const inputOra = $('input-ora');
    if (inputOra) {
      inputOra.addEventListener('change', () => aggiornaQuando(routing.giorno, inputOra.value));
    }
    const inputData = $('input-data');
    if (inputData) {
      inputData.min = oggiISO();
      inputData.addEventListener('change', () => aggiornaQuando(inputData.value, routing.orario));
    }
    disegnaTracciato();
  }

  function calcolaPercorso() {
    if (!sel.partenza || !sel.destinazione) return;
    if (typeof TPERRouting === 'undefined') {
      routing.stato = 'errore';
      routing.errore = 'motore dei percorsi non disponibile';
      disegnaPercorso();
      return;
    }
    assicuraQuando();
    const chiave = sel.partenza.id + '|' + sel.destinazione.id + '|' + routing.giorno + '|' + routing.orario;
    const terminale = routing.stato === 'ok' || routing.stato === 'nessuno' ||
      routing.stato === 'messaggio' || routing.stato === 'piedi' || routing.stato === 'errore';
    if (routing.chiave === chiave && terminale) return;

    const distanza = (sel.partenza.lat != null && sel.destinazione.lat != null)
      ? distanzaMetri(sel.partenza, sel.destinazione) : null;
    routing.chiave = chiave;
    routing.richiesta += 1;
    const richiesta = routing.richiesta;
    routing.esito = null;
    routing.piedi = null;

    if (distanza != null && distanza < 400) {
      routing.stato = 'piedi';
      routing.piedi = { metri: Math.round(distanza), minuti: minuti(distanza * 1.3 / 1.2) };
      disegnaPercorso();
      return;
    }

    routing.stato = 'caricamento';
    disegnaPercorso();

    TPERRouting.carica(URL_ORARI_GZ, URL_ORARI).then(() => {
      if (richiesta !== routing.richiesta) return null;
      return TPERRouting.calcola(
        candidatiPercorso(sel.partenza),
        candidatiPercorso(sel.destinazione),
        dataDaGiornoEOra(routing.giorno, routing.orario),
        { maxCambi: 3 }
      );
    }).then((esito) => {
      if (richiesta !== routing.richiesta) return;
      if (esito === null || esito === undefined) {
        routing.stato = 'nessuno';
      } else if (esito.errore) {
        routing.stato = 'messaggio';
        routing.esito = esito;
      } else {
        routing.stato = 'ok';
        routing.esito = esito;
        // Le geometrie arrivano dopo il calcolo: appena pronte il tracciato
        // viene ridisegnato con il percorso reale della linea.
        if (typeof TPERRouting !== 'undefined' && TPERRouting.caricaTracciati) {
          TPERRouting.caricaTracciati(URL_TRACC_GZ, URL_TRACC).then(() => {
            if (richiesta !== routing.richiesta || routing.stato !== 'ok' || !routing.esito) return;
            // Il percorso è già calcolato ma senza geometrie: si rifà una volta
            // sola, così le tratte portano la forma della linea.
            const senzaForma = routing.esito.tappe.some((tappa) => !(tappa.forma >= 0));
            if (!senzaForma) { disegnaTracciato(); return; }
            routing.chiave = null;
            calcolaPercorso();
          }).catch(() => { /* senza geometria: linea dritta tra le fermate */ });
        }
      }
      disegnaPercorso();
    }).catch((errore) => {
      if (richiesta !== routing.richiesta) return;
      routing.stato = 'errore';
      routing.errore = (errore && errore.message) || 'rete non disponibile';
      disegnaPercorso();
    });
  }

  /* ------------------------------------------------------------------ *
   * Tempo reale (HelloBus)
   * ------------------------------------------------------------------ */
  function relaysOrdinati() {
    const custom = (leggi(K_PROXY) || '').trim();
    const elenco = [];
    if (custom) {
      elenco.push({
        id: 'custom',
        build: (url) => custom.indexOf('{url}') !== -1 ? custom.replace('{url}', encodeURIComponent(url)) : custom + url
      });
    }
    const standard = [
      { id: 'corsfix', build: (url) => 'https://proxy.corsfix.com/?' + url },
      { id: 'allorigins', build: (url) => RELAY_PREDEFINITO + encodeURIComponent(url) },
      { id: 'diretta', build: (url) => url }
    ];
    const preferito = leggi(K_RELAY);
    const ordine = standard.filter((r) => r.id === preferito).concat(standard.filter((r) => r.id !== preferito));
    return elenco.concat(ordine);
  }

  async function fetchTesto(url, ms, segnale) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    const annulla = () => controller.abort();
    if (segnale) segnale.addEventListener('abort', annulla, { once: true });
    try {
      const risposta = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!risposta.ok) throw new Error('HTTP ' + risposta.status);
      let testo = await risposta.text();
      if (testo.trim().charAt(0) === '{') {
        try {
          const json = JSON.parse(testo);
          if (typeof json.contents === 'string') testo = json.contents;
        } catch (e) { /* non era JSON */ }
      }
      return testo;
    } finally {
      clearTimeout(timeoutId);
      if (segnale) segnale.removeEventListener('abort', annulla);
    }
  }

  async function queryHellobus(fermataId, linea, segnale) {
    const target = HELLOBUS + '?fermata=' + encodeURIComponent(fermataId) +
      '&linea=' + encodeURIComponent(linea) + '&oraHHMM=';
    const relays = relaysOrdinati();
    let ultimoErrore = null;
    for (const relay of relays) {
      if (segnale && segnale.aborted) throw new Error('annullato');
      try {
        const testo = await fetchTesto(relay.build(target), 9000, segnale);
        if (/TperHellobus:|HellobusHelp:/i.test(testo)) {
          if (relay.id !== 'diretta') scrivi(K_RELAY, relay.id);
          return testo;
        }
        ultimoErrore = new Error('Risposta non riconosciuta');
      } catch (errore) {
        ultimoErrore = errore;
      }
    }
    throw ultimoErrore || new Error('Rete non disponibile');
  }

  function minutiA(ora) {
    const parti = ora.split(':');
    const oraLocale = new Date();
    const target = parseInt(parti[0], 10) * 60 + parseInt(parti[1], 10);
    let differenza = target - (oraLocale.getHours() * 60 + oraLocale.getMinutes());
    if (differenza < -180) differenza += 1440;
    return differenza;
  }

  function parseHellobus(testo) {
    const trovato = testo.match(/TperHellobus:\s*([\s\S]*?)(?:<\/string>|<|$)/i);
    if (!trovato) return [];
    const corpo = trovato[1].replace(/<\/?[^>]+>/g, '').replace(/^\(x[^)]*\)\s*/, '').trim();
    if (!corpo || /NESSUNA ALTRA CORSA/i.test(corpo)) return [];
    const arrivi = [];
    corpo.split(/,\s*/).forEach((pezzo) => {
      const m = pezzo.match(/([A-Za-z0-9]{1,5})\s+(DaSatellite|Previsto)\s+(\d{1,2}):(\d{2})(?:\s*\((.*?)\))?/i);
      if (!m) return;
      const extra = m[5] || '';
      const bus = (extra.match(/Bus\s*(\d+)/i) || [])[1] || null;
      arrivi.push({
        linea: m[1].toUpperCase(),
        tipo: /dasatellite/i.test(m[2]) ? 'live' : 'orario',
        ora: String(parseInt(m[3], 10)).padStart(2, '0') + ':' + m[4],
        bus: bus,
        pedana: /CON PEDANA/i.test(extra),
        minuti: minutiA(m[3] + ':' + m[4])
      });
    });
    return arrivi;
  }

  function fermataLive() {
    return sel[stopLiveRuolo] || sel.partenza || sel.destinazione || null;
  }

  function lineeDaInterrogare(fermata) {
    return lineaDi(fermata)
      .filter((l) => /^[A-Za-z0-9]{1,4}$/.test(l))
      .sort((a, b) => {
        const na = /^\d+$/.test(a) ? 0 : 1;
        const nb = /^\d+$/.test(b) ? 0 : 1;
        return na - nb || a.localeCompare(b, 'it', { numeric: true });
      })
      .slice(0, 4);
  }

  async function caricaLive(forza) {
    const fermata = fermataLive();
    if (!fermata) {
      live.stato = 'nessuna-fermata';
      renderLive();
      return;
    }
    if (!lineePerFermata[fermata.id] || lineeDaInterrogare(fermata).length === 0) {
      live.stato = 'senza-linee';
      live.items = [];
      renderLive();
      return;
    }
    if (!forza) {
      const cache = leggiJSON('tperzc_live_' + fermata.id);
      if (cache && cache.items && Date.now() - cache.ts < 120000) {
        live.items = cache.items;
        live.ts = cache.ts;
        live.stato = 'ok';
      }
    }
    if (liveAbort) liveAbort.abort();
    liveAbort = new AbortController();
    const segnale = liveAbort.signal;
    live.caricamento = true;
    live.errore = null;
    if (live.stato !== 'ok') live.stato = 'caricamento';
    renderLive();

    const linee = lineeDaInterrogare(fermata);
    const raccolti = [];
    let risposteOk = 0;
    let nonGestite = 0;
    const risposte = await Promise.all(linee.map(async (linea) => {
      try {
        return await queryHellobus(fermata.id, linea, segnale);
      } catch (errore) {
        return null;
      }
    }));
    if (segnale.aborted) return;
    risposte.forEach((testo) => {
      if (!testo) return;
      if (/NON GESTITA/i.test(testo)) { nonGestite += 1; return; }
      risposteOk += 1;
      parseHellobus(testo).forEach((arrivo) => raccolti.push(arrivo));
    });

    live.caricamento = false;
    if (risposteOk === 0 && nonGestite > 0) {
      live.stato = 'non-gestita';
      live.items = [];
      renderLive();
      return;
    }
    if (risposteOk === 0) {
      live.stato = 'errore';
      live.errore = 'Non riesco a raggiungere il servizio HelloBus di TPER.';
      if (!live.items.length) live.items = [];
      renderLive();
      return;
    }
    const visti = new Set();
    const unici = [];
    raccolti.forEach((arrivo) => {
      const chiave = arrivo.linea + '|' + arrivo.ora;
      if (visti.has(chiave)) return;
      visti.add(chiave);
      unici.push(arrivo);
    });
    unici.sort((a, b) => a.minuti - b.minuti);
    live.items = unici.slice(0, 12);
    live.ts = Date.now();
    live.stato = 'ok';
    scrivi('tperzc_live_' + fermata.id, JSON.stringify({ ts: live.ts, items: live.items }));
    renderLive();
  }

  function statoLiveHTML() {
    if (live.caricamento && !live.items.length) {
      return '<div class="stato-live"><span class="punto-live"></span>Cerco i passaggi in tempo reale…</div>';
    }
    if (live.stato === 'errore' && !live.items.length) {
      return '<div class="stato-live"><span class="punto-live off"></span>Dati realtime non raggiungibili</div>';
    }
    if (!live.ts && !live.items.length) {
      return '<div class="stato-live"><span class="punto-live off"></span>In attesa di aggiornamento</div>';
    }
    const liveCount = live.items.filter((a) => a.tipo === 'live').length;
    return '<div class="stato-live"><span class="punto-live' + (liveCount ? '' : ' off') + '"></span>' +
      'Aggiornato alle ' + esc(orarioCorto(live.ts || Date.now())) +
      (liveCount ? ' · ' + liveCount + ' bus localizzati via GPS' : ' · solo orario programmato') + '</div>';
  }

  function arriviHTML() {
    return '<ul class="lista-arrivi">' + live.items.map((arrivo) => {
      const tempo = arrivo.minuti <= 0 ? 'In arrivo' : arrivo.minuti + '<span class="unita">min</span>';
      const meta = (arrivo.bus ? 'Bus ' + esc(arrivo.bus) : 'Corsa programmata') + ' · ore ' + esc(arrivo.ora);
      return '<li class="arrivo">' +
        '<span class="badge-linea">' + esc(arrivo.linea) + '</span>' +
        '<div class="arrivo-testo"><div class="arrivo-tempo">' + tempo + '</div>' +
        '<div class="arrivo-meta">' + meta + '</div></div>' +
        '<span class="' + (arrivo.tipo === 'live' ? 'tag-live' : 'tag-orario') + '">' + (arrivo.tipo === 'live' ? 'LIVE' : 'ORARIO') + '</span>' +
        (arrivo.pedana ? '<span class="icona-pedana" title="Accessibile in carrozzina">' + ICONA_PEDANA + '</span>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }

  function renderLive() {
    const pane = $('pane-live');
    const fermata = fermataLive();
    if (fermata && live.stopId !== fermata.id) {
      live.stopId = fermata.id;
      live.items = [];
      live.ts = 0;
      live.stato = 'idle';
    }
    let html = '';
    if (sel.partenza && sel.destinazione) {
      const suP = stopLiveRuolo === 'partenza';
      html += '<div class="segmented" role="group" aria-label="Fermata degli arrivi">' +
        '<button type="button" data-live-ruolo="partenza" aria-pressed="' + (suP ? 'true' : 'false') + '" class="' + (suP ? 'attivo' : '') + '">Partenza</button>' +
        '<button type="button" data-live-ruolo="destinazione" aria-pressed="' + (suP ? 'false' : 'true') + '" class="' + (suP ? '' : 'attivo') + '">Destinazione</button>' +
        '</div>';
    }
    html += '<div class="live-intesta">' +
      '<div><h2 class="sezione-titolo">Prossimi bus</h2>' +
      '<div class="live-nome">' + (fermata ? esc(fermata.nome) : 'Nessuna fermata selezionata') + '</div>' +
      (fermata ? '<div class="live-indirizzo">' + esc(riferimentoFermata(fermata)) + '</div>' : '') +
      (fermata ? '<div class="voce-meta">Zona ' + esc(fermata.zona) + ' · ' + esc(tipoEtichetta(fermata.tipo)) + '</div>' : '') +
      '</div>' +
      '<button class="btn-aggiorna' + (live.caricamento ? ' gira' : '') + '" data-azione="aggiorna" aria-label="Aggiorna gli arrivi"' + (fermata ? '' : ' disabled') + '>' + ICONA_REFRESH + '</button>' +
      '</div>';

    if (!fermata) {
      html += '<div class="box-messaggio">Scegli una fermata nella ricerca: mostro i prossimi passaggi con la posizione reale dei bus.</div>';
    } else if (live.stato === 'senza-linee') {
      html += '<div class="box-messaggio">Per questa fermata non risultano linee bus nel dataset: gli orari in tempo reale di HelloBus coprono il servizio su gomma urbano ed extraurbano.</div>';
    } else if (live.stato === 'non-gestita') {
      html += '<div class="box-messaggio">HelloBus non gestisce questa fermata (succede per alcune fermate del dataset regionale o per i pali non attivi). Prova con il palo opposto o consulta tper.it.</div>';
    } else {
      html += statoLiveHTML();
      if (live.stato === 'errore' && !live.items.length) {
        html += '<div class="box-messaggio errore">Impossibile contattare HelloBus (TPER) o il relay pubblico. Controlla la connessione e riprova.</div>' +
          '<button class="btn btn-secondario" data-azione="aggiorna">Riprova</button>';
      } else if (!live.items.length && !live.caricamento) {
        const altroRuolo = stopLiveRuolo === 'partenza' ? 'destinazione' : 'partenza';
        const altro = sel[altroRuolo];
        html += '<div class="box-messaggio">Nessun altro passaggio oggi a questa fermata per le linee disponibili. Riprova domani mattina o verifica su tper.it.' +
          (altro ? '<br><button class="btn btn-secondario" data-live-ruolo="' + altroRuolo + '">Guarda i bus alla ' + altroRuolo + '</button>' : '') +
          '</div>';
      } else {
        html += arriviHTML();
      }
      html += '<p class="testo-intro" style="font-size:12px">LIVE = posizione GPS reale del mezzo segnalata da TPER. ORARIO = orario programmato, non ancora aggiornato.</p>';
    }
    pane.innerHTML = html;
  }

  function avviaTimerLive() {
    fermaTimerLive();
    timerLive = setInterval(() => {
      if (tabAttivo === 'live' && document.visibilityState === 'visible' && !live.caricamento) caricaLive(true);
    }, INTERVALLO_LIVE);
  }
  function fermaTimerLive() {
    if (timerLive) { clearInterval(timerLive); timerLive = null; }
  }

  /* ------------------------------------------------------------------ *
   * Tab e pannello inferiore
   * ------------------------------------------------------------------ */
  function attivaTab(nome) {
    tabAttivo = nome;
    document.querySelectorAll('[role="tab"]').forEach((bottone) => {
      const attivo = bottone.getAttribute('data-tab') === nome;
      bottone.classList.toggle('attivo', attivo);
      bottone.setAttribute('aria-selected', attivo ? 'true' : 'false');
      bottone.tabIndex = attivo ? 0 : -1;
    });
    $('pane-viaggio').hidden = nome !== 'viaggio';
    $('pane-live').hidden = nome !== 'live';
    $('pane-info').hidden = nome !== 'info';
    if (nome === 'viaggio') renderViaggio();
    if (nome === 'live') {
      renderLive();
      if (!live.items.length && !live.caricamento) caricaLive(false);
      avviaTimerLive();
    } else {
      fermaTimerLive();
    }
    if (nome === 'info') renderInfo();
    aggiornaPannelliFocus();
    aggiornaScrim();
    if (statoSheet === 'peek') impostaSheet('meta');
  }

  // Un pannello senza elementi raggiungibili va reso focalizzabile, altrimenti
  // chi usa la tastiera non riesce a scorrerlo (pattern tabpanel dell'APG).
  function aggiornaPannelliFocus() {
    document.querySelectorAll('.pannello').forEach((pannello) => {
      const raggiungibile = !pannello.hidden &&
        pannello.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (raggiungibile) pannello.removeAttribute('tabindex');
      else if (!pannello.hidden) pannello.setAttribute('tabindex', '0');
      else pannello.removeAttribute('tabindex');
    });
  }

  // Quanto pannello si vede davvero: aggiorna --h-sheet e restituisce il valore,
  // così chi lo usa non deve rileggerlo dal DOM.
  function altezzaVisibile() {
    const top = $('sheet').getBoundingClientRect().top;
    const visibile = Math.max(120, window.innerHeight - top);
    document.documentElement.style.setProperty('--h-sheet', visibile + 'px');
    return visibile;
  }

  function traslazionePer(stato) {
    const sheet = $('sheet');
    const altezza = sheet.offsetHeight || 600;
    if (stato === 'piena') return 0;
    if (stato === 'meta') return Math.round(altezza * 0.46);
    // La posizione ridotta mostra testata, tab e riga data/ora: si misura
    // quanto occupano davvero, così un titolo su due righe non la taglia.
    const quando = document.querySelector('.quando');
    if (quando) {
      const distanza = quando.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
      return Math.max(0, Math.round(altezza - distanza - 12));
    }
    return Math.max(0, altezza - 190);
  }

  function applicaTrasformazione(pixel, animato) {
    const sheet = $('sheet');
    sheet.style.transition = animato ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
    sheet.style.transform = 'translate(-50%,' + pixel + 'px)';
    const visibile = altezzaVisibile();
    const fab = document.querySelector('.col-fab');
    if (fab) fab.classList.toggle('nascosto', pixel <= 8 || visibile > window.innerHeight * 0.6);
    aggiornaScrim();
  }

  // La sfumatura in basso compare solo se c'è ancora contenuto sotto il bordo
  // dello schermo: segnala che il pannello continua, senza tagli netti a metà riga.
  function aggiornaScrim() {
    const corpo = $('sheet-corpo');
    const scrim = $('scrim-basso');
    if (!corpo || !scrim) return;
    // Nella posizione ridotta il pannello si ferma su un confine netto (sotto i
    // comandi data/ora), quindi non c'è niente da ammorbidire.
    if (statoSheet === 'peek' && !trascinando) {
      scrim.hidden = true;
      return;
    }
    const visibile = Math.max(0, window.innerHeight - corpo.getBoundingClientRect().top);
    scrim.hidden = corpo.scrollTop + visibile >= corpo.scrollHeight - 4;
  }

  // Il pannello aperto non deve incollarsi alla barra di ricerca né coprire
  // i chip: parte 12 px sotto la barra e lascia sempre visibile la ricerca.
  function adattaAltezzaSheet() {
    const sheet = $('sheet');
    if (!sheet) return;
    const strato = document.querySelector('.strato-alto');
    const fondo = strato ? Math.round(strato.getBoundingClientRect().bottom) : 114;
    const altezza = Math.max(320, Math.min(760, window.innerHeight - fondo - 12));
    if (Math.abs((sheet.offsetHeight || 0) - altezza) > 1) sheet.style.height = altezza + 'px';
  }

  function impostaSheet(stato) {
    statoSheet = stato;
    adattaAltezzaSheet();
    applicaTrasformazione(traslazionePer(stato), true);
    // Lo spazio visibile cambia con il pannello: il percorso si reinquadra.
    if (routing.stato === 'ok') setTimeout(() => inquadraPercorso(400), 340);
  }

  function cicloSheet() {
    if (sopprimiClick) return;
    if (statoSheet === 'peek') impostaSheet('meta');
    else if (statoSheet === 'meta') impostaSheet('piena');
    else impostaSheet('meta');
  }

  function abilitaTrascinamento(elemento) {
    elemento.addEventListener('pointerdown', (evento) => {
      if (evento.button !== undefined && evento.button !== 0) return;
      trascinando = true;
      const sheet = $('sheet');
      const partenza = evento.clientY;
      const iniziale = traslazionePer(statoSheet);
      sheet.style.transition = 'none';
      elemento.setPointerCapture(evento.pointerId);
      const muovi = (ev) => {
        if (!trascinando) return;
        const delta = ev.clientY - partenza;
        const pixel = Math.min(Math.max(0, iniziale + delta), sheet.offsetHeight - 120);
        applicaTrasformazione(pixel, false);
      };
      const fine = () => {
        if (!trascinando) return;
        trascinando = false;
        elemento.removeEventListener('pointermove', muovi);
        elemento.removeEventListener('pointerup', fine);
        elemento.removeEventListener('pointercancel', fine);
        const attuale = (function () {
          const matrice = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
          return Math.abs(matrice.m42);
        })();
        const altezza = sheet.offsetHeight || 600;
        if (Math.abs(attuale - iniziale) > 8) {
          sopprimiClick = true;
          setTimeout(() => { sopprimiClick = false; }, 320);
        }
        const opzioni = [
          { stato: 'piena', valore: 0 },
          { stato: 'meta', valore: Math.round(altezza * 0.46) },
          { stato: 'peek', valore: Math.max(0, altezza - 190) }
        ];
        opzioni.sort((a, b) => Math.abs(a.valore - attuale) - Math.abs(b.valore - attuale));
        impostaSheet(opzioni[0].stato);
      };
      elemento.addEventListener('pointermove', muovi);
      elemento.addEventListener('pointerup', fine);
      elemento.addEventListener('pointercancel', fine);
    });
  }

  /* ------------------------------------------------------------------ *
   * Tab Info
   * ------------------------------------------------------------------ */
  function renderInfo() {
    const pane = $('pane-info');
    if (pane.dataset.pronto === '1') return;
    pane.dataset.pronto = '1';
    pane.innerHTML =
      '<div class="scheda"><h2>Come funziona il tempo reale</h2>' +
      '<p>Gli arrivi vengono letti dal web service pubblico HelloBus di TPER, lo stesso usato dagli SMS alle fermate. I passaggi con etichetta LIVE sono bus localizzati via satellite; gli altri sono orari di tabella.</p></div>' +
      '<div class="scheda"><h2>Dati del servizio</h2>' +
      '<p>Fermate, zone e linee: open data TPER / Regione Emilia-Romagna (CC BY 3.0 IT).<br>Orari dei percorsi: GTFS ufficiale TPER (orari programmati).<br>Database fermate aggiornato al: ' + esc(aggiornato || 'non disponibile') + '.<br>Prezzi indicativi: verifica sempre su tper.it.</p>' +
      '<a class="mini" href="https://www.tper.it" target="_blank" rel="noopener">Apri tper.it</a></div>' +
      '<div class="scheda"><h2>Relay per gli orari</h2>' +
      '<p>HelloBus non consente le chiamate dirette dal browser (manca l\'autorizzazione CORS): l\'app passa da un relay pubblico. Se ne hai uno tuo, incollalo qui sotto con <code>{url}</code> al posto dell\'indirizzo da chiamare.</p>' +
      '<div class="campo-proxy"><input id="input-proxy" type="text" placeholder="https://mio-relay.example/?url={url}" value="' + esc(leggi(K_PROXY) || '') + '">' +
      '<button class="mini" data-azione="salva-proxy">Salva</button></div>' +
      '<p style="font-size:12px">Vuoto = relay pubblico predefinito. Dopo il salvataggio premi di nuovo "In tempo reale".</p>' +
      '<button class="mini" data-azione="azzera-proxy">Usa il relay predefinito</button></div>' +
      '<div class="scheda"><h2>Installa l\'app</h2>' +
      '<p>Aggiungila alla schermata home: si apre come un\'app, funziona anche senza rete per zone e prezzi.</p>' +
      '<button class="mini" data-azione="installa">Installa TPER Zone Calc</button></div>' +
      '<p class="testo-intro" style="font-size:12px">App non ufficiale, non affiliata a TPER. Dati forniti da TPER e dalla Regione Emilia-Romagna.</p>';
  }

  /* ------------------------------------------------------------------ *
   * Geolocalizzazione
   * ------------------------------------------------------------------ */
  function vaiVicino() {
    if (!navigator.geolocation) {
      mostraToast('Geolocalizzazione non supportata da questo browser');
      return;
    }
    mostraToast('Cerco la tua posizione…');
    navigator.geolocation.getCurrentPosition((posizione) => {
      posizioneUtente = { lat: posizione.coords.latitude, lon: posizione.coords.longitude };
      const vicine = senzaDoppioni(fermateVicine(posizioneUtente.lat, posizioneUtente.lon, 8)).slice(0, 6);
      if (mappa) mappa.flyTo({ center: [posizioneUtente.lon, posizioneUtente.lat], zoom: 15, offset: [0, -120] });
      impostaSheet('meta');
      attivaTab('viaggio');
      if (vicine.length) {
        montaPannelloViaggio('<p class="testo-intro">Fermate più vicine alla tua posizione: tocca quella di partenza.</p>' +
          htmlListaFermate('Vicino a te', vicine, 'partenza') + htmlInterruttore());
        aggiornaTestata();
        mostraToast('Trovate ' + vicine.length + ' fermate vicine');
      }
    }, () => {
      mostraToast('Posizione non disponibile: controlla i permessi del browser');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ------------------------------------------------------------------ *
   * PWA
   * ------------------------------------------------------------------ */
  let ricaricaDaAggiornamento = false;

  function mostraAvvisoAggiornamento(registrazione) {
    const avviso = $('avviso-aggiorna');
    if (!avviso || !avviso.hidden) return;
    avviso.hidden = false;
    $('btn-aggiorna').onclick = () => {
      avviso.hidden = true;
      ricaricaDaAggiornamento = true;
      const nuovo = registrazione.waiting || registrazione.installing;
      if (nuovo) nuovo.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    };
  }

  function registraServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // updateViaCache: 'none' evita che il browser serva dalla cache HTTP una
    // versione vecchia del service worker (e quindi dell'app).
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registrazione) => {
      // Versione nuova già pronta da una visita precedente.
      if (registrazione.waiting && navigator.serviceWorker.controller) mostraAvvisoAggiornamento(registrazione);
      registrazione.addEventListener('updatefound', () => {
        const nuovo = registrazione.installing;
        if (!nuovo) return;
        nuovo.addEventListener('statechange', () => {
          if (nuovo.state === 'installed' && navigator.serviceWorker.controller) {
            mostraAvvisoAggiornamento(registrazione);
          }
        });
      });
    }).catch(() => { /* non bloccante */ });

    // La pagina si ricarica solo dopo che l'utente ha accettato l'aggiornamento.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!ricaricaDaAggiornamento) return;
      ricaricaDaAggiornamento = false;
      window.location.reload();
    });
  }

  function gestisciInstallazione() {
    const banner = $('banner-installa');
    window.addEventListener('beforeinstallprompt', (evento) => {
      evento.preventDefault();
      eventoInstallazione = evento;
      banner.hidden = false;
    });
    const installa = async () => {
      banner.hidden = true;
      if (!eventoInstallazione) {
        mostraToast('Usa il menu del browser → "Aggiungi a schermata home"');
        return;
      }
      eventoInstallazione.prompt();
      await eventoInstallazione.userChoice;
      eventoInstallazione = null;
    };
    $('btn-installa').addEventListener('click', installa);
    $('btn-chiudi-banner').addEventListener('click', () => { banner.hidden = true; });
    window.installaApp = installa;
  }

  /* ------------------------------------------------------------------ *
   * Eventi
   * ------------------------------------------------------------------ */
  function collegaEventi() {
    ['partenza', 'destinazione'].forEach((ruolo) => {
      const input = $(ruolo === 'partenza' ? 'input-partenza' : 'input-destinazione');
      const cerca = debounce(() => {
        campoAttivo = ruolo;
        if (!fermate.length) return;
        // Se l'utente non ha cambiato il testo della fermata scelta, non c'è nulla da cercare.
        if (sel[ruolo] && input.value === sel[ruolo].nome) { aggiornaPulisci(); return; }
        const avevaSelezione = !!sel[ruolo];
        sel[ruolo] = null;
        aggiornaPulisci();
        // Il viaggio mostrato non vale più: si riparte dalla ricerca.
        if (avevaSelezione) { salvaTratta(); renderViaggio(); renderLive(); }
        apriSuggerimenti(ruolo, input.value);
      }, 160);
      input.addEventListener('input', cerca);
      input.addEventListener('change', () => {
        // Ripristino del valore da parte del browser: non è una ricerca.
        if (fermate.length && sel[ruolo] && input.value !== sel[ruolo].nome) {
          sel[ruolo] = null;
          aggiornaPulisci();
          salvaTratta();
          renderViaggio();
          renderLive();
        }
      });
      input.addEventListener('focus', () => {
        campoAttivo = ruolo;
        if (!fermate.length) return;
        // Se il campo mostra già la fermata scelta, non riaprire i suggerimenti da solo.
        if (sel[ruolo] && input.value === sel[ruolo].nome) return;
        apriSuggerimenti(ruolo, input.value);
      });
      input.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          const primo = $('overlay-lista').querySelector('[data-voce]');
          if (primo) primo.click();
        } else if (evento.key === 'Escape') {
          chiudiOverlay();
          input.blur();
        }
      });
    });

    document.querySelectorAll('[data-pulisci]').forEach((bottone) => {
      bottone.addEventListener('click', (evento) => {
        evento.stopPropagation();
        const ruolo = bottone.getAttribute('data-pulisci');
        sel[ruolo] = null;
        impostaInput(ruolo);
        aggiornaMarker();
        salvaTratta();
        renderViaggio();
        renderLive();
        if (ruolo === 'destinazione' && sel.partenza) {
          $(ruolo === 'partenza' ? 'input-partenza' : 'input-destinazione').focus();
        }
      });
    });

    $('btn-scambia').addEventListener('click', () => {
      if (!sel.partenza && !sel.destinazione) {
        mostraToast('Seleziona prima partenza e destinazione');
        return;
      }
      const partenza = sel.partenza;
      sel.partenza = sel.destinazione;
      sel.destinazione = partenza;
      impostaInput('partenza');
      impostaInput('destinazione');
      aggiornaMarker();
      salvaTratta();
      inquadra();
      live.items = [];
      live.ts = 0;
      live.stato = 'idle';
      renderViaggio();
      renderLive();
      if (tabAttivo === 'live') caricaLive(true);
    });

    $('chip-abbonamento').addEventListener('click', () => {
      abbonamento = !abbonamento;
      renderViaggio();
    });
    $('chip-vicino').addEventListener('click', vaiVicino);
    $('btn-geo').addEventListener('click', vaiVicino);
    $('btn-inquadra').addEventListener('click', () => inquadra());

    document.querySelectorAll('.tab button').forEach((bottone) => {
      bottone.addEventListener('click', () => attivaTab(bottone.getAttribute('data-tab')));
    });

    // Navigazione da tastiera tra le schede (frecce, Home, End).
    const barraTab = document.querySelector('.tab');
    if (barraTab) {
      barraTab.addEventListener('keydown', (evento) => {
        const bottoni = Array.from(barraTab.querySelectorAll('[role="tab"]'));
        const corrente = bottoni.indexOf(document.activeElement);
        if (corrente === -1) return;
        let prossimo = null;
        if (evento.key === 'ArrowRight') prossimo = (corrente + 1) % bottoni.length;
        else if (evento.key === 'ArrowLeft') prossimo = (corrente - 1 + bottoni.length) % bottoni.length;
        else if (evento.key === 'Home') prossimo = 0;
        else if (evento.key === 'End') prossimo = bottoni.length - 1;
        if (prossimo === null) return;
        evento.preventDefault();
        bottoni[prossimo].focus();
        bottoni[prossimo].click();
      });
    }

    $('overlay-chiudi').addEventListener('click', chiudiOverlay);
    $('backdrop').addEventListener('click', chiudiOverlay);
    $('overlay-lista').addEventListener('click', (evento) => {
      const voce = evento.target.closest('[data-voce]');
      if (!voce) return;
      const fermata = fermataPerId(voce.getAttribute('data-voce'));
      if (!fermata) return;
      const ruolo = voce.getAttribute('data-ruolo') || campoAttivo || 'destinazione';
      selezionaFermata(ruolo, fermata);
    });

    $('sheet-testa').addEventListener('click', cicloSheet);
    $('grab').addEventListener('click', cicloSheet);
    $('grab').addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); cicloSheet(); }
    });
    abilitaTrascinamento($('grab'));
    abilitaTrascinamento($('sheet-testa'));

    $('sheet-corpo').addEventListener('scroll', aggiornaScrim, { passive: true });

    $('sheet-corpo').addEventListener('click', (evento) => {
      if (sopprimiClick) { sopprimiClick = false; return; }
      const pulsante = evento.target.closest('[data-azione]');
      if (pulsante) {
        const azione = pulsante.getAttribute('data-azione');
        if (azione === 'live') { attivaTab('live'); caricaLive(true); impostaSheet('piena'); }
        if (azione === 'inverti') { $('btn-scambia').click(); }
        if (azione === 'ora-adesso') aggiornaQuando();
        if (azione === 'riprova-percorso') {
          routing.chiave = null;
          calcolaPercorso();
        }
        if (azione === 'prova-domani') {
          const domani = new Date();
          domani.setDate(domani.getDate() + 1);
          aggiornaQuando(isoDi(domani), '08:00');
        }
        if (azione === 'aggiorna') { caricaLive(true); }
        if (azione === 'salva-proxy') {
          const valore = ($('input-proxy').value || '').trim();
          if (valore) scrivi(K_PROXY, valore); else localStorage.removeItem(K_PROXY);
          live.items = []; live.ts = 0; live.stato = 'idle';
          mostraToast(valore ? 'Relay salvato' : 'Relay predefinito ripristinato');
          caricaLive(true);
        }
        if (azione === 'azzera-proxy') {
          localStorage.removeItem(K_PROXY);
          const campo = $('input-proxy');
          if (campo) campo.value = '';
          live.items = []; live.ts = 0; live.stato = 'idle';
          mostraToast('Relay predefinito ripristinato');
          caricaLive(true);
        }
        if (azione === 'installa') {
          if (window.installaApp) window.installaApp();
          else mostraToast('Usa il menu del browser → "Aggiungi a schermata home"');
        }
        return;
      }
      const voce = evento.target.closest('[data-voce]');
      if (voce) {
        const fermata = fermataPerId(voce.getAttribute('data-voce'));
        if (fermata) selezionaFermata(voce.getAttribute('data-ruolo') || 'destinazione', fermata);
        return;
      }
      const ruoloLive = evento.target.closest('[data-live-ruolo]');
      if (ruoloLive) {
        stopLiveRuolo = ruoloLive.getAttribute('data-live-ruolo');
        live.items = [];
        live.ts = 0;
        live.stato = 'idle';
        renderLive();
        caricaLive(true);
      }
    });

    window.addEventListener('resize', debounce(() => {
      if (trascinando) return;
      adattaAltezzaSheet();
      applicaTrasformazione(traslazionePer(statoSheet), false);
    }, 120));

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && tabAttivo === 'live' && Date.now() - live.ts > INTERVALLO_LIVE) {
        caricaLive(true);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Avvio
   * ------------------------------------------------------------------ */
  async function avvia() {
    initMappa();
    collegaEventi();
    gestisciInstallazione();
    registraServiceWorker();
    applicaTrasformazione(traslazionePer('meta'), false);
    await caricaDati();
    ripristinaTratta();
    aggiornaMarker();
    renderViaggio();
    renderLive();
    attivaTab('viaggio');
    impostaSheet('meta');
    if (sel.partenza || sel.destinazione) inquadra(false);
    else if (mappa) mappa.jumpTo({ center: [11.3426, 44.4949], zoom: 13 });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
