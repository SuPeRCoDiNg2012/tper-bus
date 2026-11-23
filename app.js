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
  const URL_COLORI = './data/linee-colori.json';
  const TIMEOUT_FETCH = 10000;
  const K_FERMATE = 'tperzc_fermate_v2';
  const K_LINEE = 'tperzc_linee_v2';
  const K_COLORI = 'tperzc_colori_v1';
  const K_RECENTI = 'tperzc_recenti_v2';
  const K_TRATTA = 'tperzc_tratta_v2';
  const K_QUANDO = 'tperzc_quando_v1';
  const K_PROXY = 'tperzc_proxy';
  const K_RELAY = 'tperzc_relay';
  const URL_UFFICIALE = 'https://solweb.tper.it/web/tools/zone-calculator.aspx';
  const HELLOBUS = 'https://hellobuswsweb.tper.it/web-services/hellobus.asmx/QueryHellobus';
  const RELAY_PREDEFINITO = 'https://api.allorigins.win/raw?url=';
  const INTERVALLO_LIVE = 30000;
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const NOMINATIM_PAUSA = 1100;      // ms tra due richieste: è la policy d'uso di OSM
  const INDIRIZZI_MIN = 3;           // caratteri minimi prima di cercare un indirizzo

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
  let coloriLinee = {};
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
  const indirizziCache = new Map();
  let indirizziAbort = null;
  let ultimaRichiestaIndirizzi = 0;
  const suggerimenti = { token: 0, campo: null, query: '', gruppi: [], indirizzi: [], caricamento: false, errore: false };

  const live = { items: [], ts: 0, stato: 'idle', caricamento: false, errore: null, stopId: null };

  const $ = (id) => document.getElementById(id);
  const ICONA_BUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4" width="17" height="12.5" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17" stroke="currentColor" stroke-width="1.5"/><circle cx="7.6" cy="18.6" r="1.5" fill="currentColor"/><circle cx="16.4" cy="18.6" r="1.5" fill="currentColor"/></svg>';
  const ICONA_TRENO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="4.5" stroke="currentColor" stroke-width="1.7"/><path d="M5 10h14" stroke="currentColor" stroke-width="1.5"/><circle cx="8.6" cy="19.4" r="1.4" fill="currentColor"/><circle cx="15.4" cy="19.4" r="1.4" fill="currentColor"/></svg>';
  const ICONA_LUOGO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s6.5-6.8 6.5-11.4A6.5 6.5 0 0 0 5.5 9.6C5.5 14.2 12 21 12 21z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9.6" r="2.4" stroke="currentColor" stroke-width="1.7"/></svg>';
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

  // Colore ufficiale della linea dal GTFS TPER (route_color): lo stesso sulla
  // scheda viaggio e sul tracciato in mappa.
  function coloreLinea(nome) {
    if (nome == null) return null;
    const testo = String(nome).trim();
    const chiavi = [testo, testo.toUpperCase()];
    // HelloBus aggiunge la variante alla linea (es. 60A, 20A), mentre il GTFS
    // colora la linea base (60, 20): senza questo il badge reale restava rosso.
    const variante = /^(\d+)[A-Za-z]+$/.exec(testo);
    if (variante) chiavi.push(variante[1]);
    for (let i = 0; i < chiavi.length; i += 1) {
      const chiave = chiavi[i];
      if (!Object.prototype.hasOwnProperty.call(coloriLinee, chiave)) continue;
      const voce = coloriLinee[chiave];
      if (Array.isArray(voce) && voce[0]) return voce;
    }
    return null;
  }

  // Sul basemap chiaro i colori ufficiali molto chiari si perdono: per la
  // linea in mappa si scuriscono appena, il badge resta quello ufficiale.
  function coloreTracciato(nome) {
    const voce = coloreLinea(nome);
    if (!voce) return null;
    const hex = voce[0].replace('#', '');
    const canali = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (canali.some((c) => !isFinite(c))) return voce[0];
    const luminanza = (0.2126 * canali[0] + 0.7152 * canali[1] + 0.0722 * canali[2]) / 255;
    if (luminanza <= 0.62) return voce[0];
    return '#' + canali.map((c) => Math.round(c * 0.66).toString(16).padStart(2, '0')).join('');
  }

  // Le tappe del percorso portano il colore della propria linea già pronte per
  // il disegno: la scheda e la mappa leggono lo stesso dato.
  function coloraTappe(esito) {
    if (!esito || !Array.isArray(esito.tappe)) return;
    esito.tappe.forEach((tappa) => {
      if (tappa.tipo === 1 || tappa.tipo === 2) return;   // i treni restano neutri
      const voce = coloreLinea(tappa.linea);
      if (!voce) return;
      tappa.colore = voce[0];
      tappa.coloreTesto = voce[1] || '#FFFFFF';
    });
  }
  function metaFermata(f) {
    const linee = lineaDi(f).slice(0, 3).join(' · ');
    return 'Palina ' + f.id + ' · ' + tipoEtichetta(f.tipo) + ' · Zona ' + f.zona + (linee ? ' · ' + linee : '');
  }

  function eIndirizzo(luogo) {
    return !!luogo && luogo.tipo === 'indirizzo';
  }

  // Codice palina e indirizzo breve: servono a riconoscere la fermata sul posto.
  function riferimentoFermata(f) {
    if (!f) return '';
    if (eIndirizzo(f)) return f.indirizzo || 'Indirizzo';
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
      const [rispostaFermate, risposteLinee, rispostaColori] = await Promise.all([
        fetchConTimeout(URL_FERMATE, TIMEOUT_FETCH),
        fetchConTimeout(URL_LINEE, TIMEOUT_FETCH),
        // I colori sono un di più: se non arrivano l'app funziona lo stesso.
        fetchConTimeout(URL_COLORI, TIMEOUT_FETCH).catch(() => null)
      ]);
      if (!rispostaFermate.ok || !risposteLinee.ok) throw new Error('Risposta non valida');
      const datiFermate = await rispostaFermate.json();
      const datiLinee = await risposteLinee.json();
      fermate = datiFermate.fermate || [];
      lineePerFermata = datiLinee.linee || {};
      aggiornato = datiFermate.aggiornato || null;
      scrivi(K_FERMATE, JSON.stringify(datiFermate));
      scrivi(K_LINEE, JSON.stringify(datiLinee));
      if (rispostaColori && rispostaColori.ok) {
        const datiColori = await rispostaColori.json().catch(() => null);
        if (datiColori && datiColori.linee) {
          coloriLinee = datiColori.linee;
          scrivi(K_COLORI, JSON.stringify(datiColori));
        }
      }
      if (!Object.keys(coloriLinee).length) {
        const cacheColori = leggiJSON(K_COLORI);
        if (cacheColori && cacheColori.linee) coloriLinee = cacheColori.linee;
      }
    } catch (errore) {
      const cacheFermate = leggiJSON(K_FERMATE);
      const cacheLinee = leggiJSON(K_LINEE);
      const cacheColori = leggiJSON(K_COLORI);
      if (cacheColori && cacheColori.linee) coloriLinee = cacheColori.linee;
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
    // In orizzontale i 205 px fissi in alto più la copertura del pannello
    // superavano l'altezza dello schermo e fitBounds perdeva il viaggio.
    const sopra = Math.min(205, Math.round(window.innerHeight * 0.24));
    const durata = animato === false ? 0 : 600;
    if (punti.length === 2) {
      const limiti = new maplibregl.LngLatBounds();
      punti.forEach((punto) => limiti.extend(punto));
      mappa.fitBounds(limiti, {
        padding: { top: sopra, bottom: copertura, left: 50, right: 50 },
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
      // Ogni tratto porta il colore della sua linea; il rosso TPER resta il
      // colore di riserva per le linee senza colore nel GTFS.
      paint: { 'line-color': ['coalesce', ['get', 'colore'], '#C1121F'], 'line-width': 5.5 }
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
      paint: { 'line-color': ['coalesce', ['get', 'colore'], '#C1121F'], 'line-width': 3.5, 'line-dasharray': [2, 1.6] }
    });
    mappa.addLayer({
      id: 'percorso-fermate-punti',
      type: 'circle',
      source: 'percorso-fermate',
      paint: {
        'circle-radius': 3.4,
        'circle-color': ['coalesce', ['get', 'colore'], '#C1121F'],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 1.6
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

  function segmento(modo, coordinate, ufficiale, colore) {
    const proprieta = { modo: modo, ufficiale: ufficiale !== false };
    if (colore) proprieta.colore = colore;
    return {
      type: 'Feature',
      properties: proprieta,
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

  // Proietta una fermata sulla polilinea disegnata: il pallino sta sulla linea
  // del bus, non a fianco. Si porta il punto nel piano locale (lon scalata sul
  // coseno della latitudine), si cerca il segmento più vicino e si restituisce
  // il punto di proiezione, così la fermata resta quella reale ma agganciata
  // al tracciato.
  const PROIEZIONE_MAX = 60;   // metri: oltre, la geometria è sbagliata, non si sposta il pallino

  function proiettaSuLinea(punto, linea) {
    if (!punto || !Array.isArray(linea) || linea.length < 2) return punto;
    const coseno = Math.cos((punto[1] * Math.PI) / 180);
    const px = punto[0] * coseno;
    const py = punto[1];
    let proiezione = null;
    let minima = Infinity;
    for (let i = 1; i < linea.length; i += 1) {
      const a = linea[i - 1];
      const b = linea[i];
      if (!a || !b) continue;
      const ax = a[0] * coseno;
      const ay = a[1];
      const dx = b[0] * coseno - ax;
      const dy = b[1] - ay;
      const lunghezza2 = dx * dx + dy * dy;
      let t = lunghezza2 ? ((px - ax) * dx + (py - ay) * dy) / lunghezza2 : 0;
      t = Math.max(0, Math.min(1, t));
      const distanza = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (distanza < minima) {
        minima = distanza;
        proiezione = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      }
    }
    // Se la linea passa troppo lontano, il tracciato di quella corsa non
    // descrive davvero la fermata: meglio il punto reale che un pallino
    // teletrasportato su un altro ramo.
    if (!proiezione || minima * 111000 > PROIEZIONE_MAX) return punto;
    return proiezione;
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
        if (tappa.camminoPrima) {
          const da = coordinateFermata(tappa.camminoPrima.da);
          const a = coordinateFermata(tappa.da);
          if (da && a) features.push(segmento('piedi', [da, a]));
        }
        let disegnata = null;
        if (geometria && geometria.length > 1) {
          disegnata = estendiAgliEstremi(geometria, coordinateFermata(tappa.da), coordinateFermata(tappa.a));
          features.push(segmento('bus', disegnata, ufficiale, coloreTracciato(tappa.linea)));
          if (!ufficiale) senzaTracciato += 1;
        } else {
          senzaTracciato += 1;
        }
        const mezzo = tappa.stops || [];
        mezzo.forEach((id, posizione) => {
          if (posizione === 0 || posizione === mezzo.length - 1) return;
          const punto = coordinateFermata(id);
          if (punto) {
            fermate.push({
              type: 'Feature',
              // Il pallino della fermata intermedia prende il colore della linea.
              properties: { colore: coloreTracciato(tappa.linea) },
              geometry: { type: 'Point', coordinates: proiettaSuLinea(punto, disegnata) }
            });
          }
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

  function gruppiSuggerimenti(campo) {
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

  function gruppiFermate(query) {
    const risultati = cercaFermate(query);
    return risultati.length ? [{ titolo: 'Fermate', items: risultati }] : [];
  }

  // Indirizzo trovato su Nominatim: usa la zona della fermata più vicina per il
  // prezzo, mentre il percorso parte e arriva dalle coordinate esatte.
  function indirizzoHTML(luogo, ruolo) {
    return '<button class="voce" role="option" data-indirizzo="1" data-lat="' + luogo.lat + '" data-lon="' + luogo.lon +
      '" data-nome="' + esc(luogo.nome) + '" data-dettaglio="' + esc(luogo.indirizzo || '') + '" data-ruolo="' + esc(ruolo) + '">' +
      '<span class="voce-ico geo">' + ICONA_LUOGO + '</span>' +
      '<span class="voce-testo"><span class="voce-nome">' + esc(luogo.nome) + '</span>' +
      (luogo.indirizzo ? '<span class="voce-indirizzo">' + esc(luogo.indirizzo) + '</span>' : '') +
      '<span class="voce-meta">Indirizzo · zona ' + esc(luogo.zona) + '</span></span>' +
      '<svg class="voce-freccia" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';
  }

  function disegnaSuggerimenti() {
    const lista = $('overlay-lista');
    const campo = suggerimenti.campo || 'destinazione';
    let html = suggerimenti.gruppi.map((gruppo) => {
      return '<div class="gruppo-titolo">' + esc(gruppo.titolo) + '</div>' +
        gruppo.items.map((f) => voceHTML(f, campo)).join('');
    }).join('');
    if (suggerimenti.indirizzi.length) {
      html += '<div class="gruppo-titolo">Indirizzi</div>' +
        suggerimenti.indirizzi.map((luogo) => indirizzoHTML(luogo, campo)).join('') +
        '<p class="testo-intro" style="padding:6px 10px 10px;font-size:11px">Indirizzi © OpenStreetMap contributors (ODbL)</p>';
    }
    if (suggerimenti.caricamento) {
      html += '<div class="gruppo-titolo">Indirizzi</div>' +
        '<p class="testo-intro" style="padding:2px 10px 12px">Cerco su OpenStreetMap…</p>';
    }
    if (suggerimenti.errore) {
      html += '<p class="testo-intro" style="padding:8px 10px 12px">Ricerca indirizzi non disponibile: le fermate qui sopra funzionano lo stesso.</p>';
    }
    if (!html) {
      html = '<p class="testo-intro" style="padding:16px 8px 12px">Nessuna fermata o indirizzo trovato. Prova con un altro nome.</p>';
    }
    lista.innerHTML = html;
  }

  async function chiediIndirizzi(testo, token) {
    // Nominatim consente una richiesta al secondo: si aspetta il turno e si
    // annulla la richiesta precedente appena parte una ricerca nuova.
    const attesa = Math.max(0, ultimaRichiestaIndirizzi + NOMINATIM_PAUSA - Date.now());
    if (attesa) await new Promise((risolvi) => setTimeout(risolvi, attesa));
    if (token !== suggerimenti.token) return null;
    ultimaRichiestaIndirizzi = Date.now();
    if (indirizziAbort) indirizziAbort.abort();
    indirizziAbort = new AbortController();
    const url = NOMINATIM + '?format=jsonv2&addressdetails=1&limit=6&dedupe=1&accept-language=it&countrycodes=it' +
      '&viewbox=11.20,44.62,11.50,44.34&q=' + encodeURIComponent(testo);
    const risposta = await fetch(url, { signal: indirizziAbort.signal, headers: { Accept: 'application/json' } });
    if (!risposta.ok) throw new Error('Nominatim: ' + risposta.status);
    const elenco = await risposta.json();
    if (!Array.isArray(elenco)) return [];
    const visti = new Set();
    const trovati = [];
    elenco.forEach((voce) => {
      const lat = parseFloat(voce.lat);
      const lon = parseFloat(voce.lon);
      if (!isFinite(lat) || !isFinite(lon)) return;
      const chiave = lat.toFixed(5) + ',' + lon.toFixed(5);
      if (visti.has(chiave)) return;
      visti.add(chiave);
      const indirizzo = voce.address || {};
      const via = indirizzo.road || indirizzo.pedestrian || indirizzo.footway || indirizzo.square || indirizzo.neighbourhood || '';
      const civico = indirizzo.house_number ? ' ' + indirizzo.house_number : '';
      const nome = voce.name || ((via + civico).trim() || String(voce.display_name || '').split(',')[0].trim());
      const contesto = [via && (via + civico), indirizzo.suburb, indirizzo.city || indirizzo.town || indirizzo.village, indirizzo.postcode]
        .filter(Boolean)
        .filter((parte, indice, tutte) => tutte.indexOf(parte) === indice)
        .join(' · ');
      const vicina = fermateVicine(lat, lon, 1)[0];
      trovati.push({
        id: 'geo:' + chiave,
        nome: nome || 'Indirizzo',
        indirizzo: contesto,
        lat: lat,
        lon: lon,
        zona: vicina ? vicina.zona : '500',
        tipo: 'indirizzo'
      });
    });
    return trovati;
  }

  function cercaIndirizzi(testo) {
    const chiave = normalizza(testo);
    const token = suggerimenti.token + 1;
    suggerimenti.token = token;
    suggerimenti.errore = false;
    if (indirizziCache.has(chiave)) {
      suggerimenti.indirizzi = indirizziCache.get(chiave);
      suggerimenti.caricamento = false;
      disegnaSuggerimenti();
      return;
    }
    suggerimenti.indirizzi = [];
    suggerimenti.caricamento = true;
    disegnaSuggerimenti();
    chiediIndirizzi(testo, token).then((esiti) => {
      if (esiti === null || token !== suggerimenti.token) return;
      indirizziCache.set(chiave, esiti);
      suggerimenti.indirizzi = esiti;
    }).catch(() => {
      if (token !== suggerimenti.token) return;
      suggerimenti.errore = true;
    }).finally(() => {
      if (token !== suggerimenti.token) return;
      suggerimenti.caricamento = false;
      disegnaSuggerimenti();
    });
  }

  function apriSuggerimenti(campo, query) {
    const input = $(campo === 'partenza' ? 'input-partenza' : 'input-destinazione');
    // I suggerimenti compaiono solo per il campo che l'utente sta usando davvero.
    if (document.activeElement !== input) return;
    campoAttivo = campo;
    const testo = (query || '').trim();
    suggerimenti.campo = campo;
    suggerimenti.query = testo;
    suggerimenti.indirizzi = [];
    suggerimenti.errore = false;
    suggerimenti.caricamento = false;
    if (testo.length >= 2) {
      suggerimenti.gruppi = gruppiFermate(testo);
    } else {
      suggerimenti.token += 1;
      if (indirizziAbort) { indirizziAbort.abort(); indirizziAbort = null; }
      suggerimenti.gruppi = gruppiSuggerimenti(campo);
      if (!suggerimenti.gruppi.length) { chiudiOverlay(); return; }
    }
    $('overlay-titolo').textContent = campo === 'partenza' ? 'Da dove parti' : 'Dove vai';
    $('overlay-ricerca').hidden = false;
    $('backdrop').hidden = false;
    if (testo.length >= INDIRIZZI_MIN) cercaIndirizzi(testo);
    else disegnaSuggerimenti();
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
    if (!eIndirizzo(f)) aggiungiRecente(f);
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

  // Le fermate si salvano per id, gli indirizzi per coordinate (l'id è finto).
  function luogoSalvato(luogo) {
    if (!luogo) return null;
    return {
      id: luogo.id, nome: luogo.nome, indirizzo: luogo.indirizzo || '',
      lat: luogo.lat, lon: luogo.lon, zona: luogo.zona, tipo: luogo.tipo
    };
  }

  function luogoRipristinato(salvato) {
    if (!salvato) return null;
    if (typeof salvato === 'string') return fermataPerId(salvato);
    if (salvato.lat == null || salvato.lon == null) return fermataPerId(salvato.id);
    return salvato;
  }

  function salvaTratta() {
    scrivi(K_TRATTA, JSON.stringify({
      partenza: luogoSalvato(sel.partenza),
      destinazione: luogoSalvato(sel.destinazione)
    }));
  }

  function ripristinaTratta() {
    const salvata = leggiJSON(K_TRATTA);
    if (salvata) {
      sel.partenza = luogoRipristinato(salvata.partenza);
      sel.destinazione = luogoRipristinato(salvata.destinazione);
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
      const zp = eIndirizzo(p) ? 'Indirizzo · zona ' + p.zona : 'Zona ' + p.zona;
      const zd = eIndirizzo(d) ? 'Indirizzo · zona ' + d.zona : 'Zona ' + d.zona;
      sotto = zp + ' → ' + zd;
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
      (sel.partenza ? 'Scegli dove andare: mostro le fermate più vicine e il prezzo del biglietto.' : 'Cerca una fermata o un indirizzo, oppure tocca la mappa per iniziare.') +
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
      orario: orarioValido(salvato.orario) ? salvato.orario : '',
      modo: salvato.modo === 'arrivo' ? 'arrivo' : 'partenza',
      adesso: typeof salvato.adesso === 'boolean'
        ? salvato.adesso
        : !orarioValido(salvato.orario)
    };
  }

  function salvaQuando() {
    scrivi(K_QUANDO, JSON.stringify({
      giorno: routing.giorno || '',
      orario: routing.orario || '',
      modo: routing.modo,
      adesso: routing.adesso
    }));
  }

  const routing = {
    stato: 'idle', esito: null, errore: null, chiave: null, richiesta: 0, piedi: null,
    opzioni: [], aperto: -1, scadenza: null,
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

  // Prima di disegnare o calcolare, data e ora devono avere un valore. In
  // modalità "adesso" l'ora segue il tempo reale a ogni ridisegno.
  function assicuraQuando() {
    if (!routing.giorno) routing.giorno = oggiISO();
    if (routing.adesso) {
      const ora = oraAdesso();
      if (ora !== routing.orario) {
        routing.orario = ora;
        routing.chiave = null;
        const campo = $('input-ora');
        if (campo) campo.value = ora;
      }
    }
    if (!routing.orario) routing.orario = oraAdesso();
  }

  // Unico punto di modifica di giorno/ora: stato, campi visibili, cache del
  // risultato e ricalcolo. Prima era ripetuto in quattro gestori diversi.
  function aggiornaQuando(giorno, orario, adesso) {
    routing.giorno = giorno || oggiISO();
    routing.orario = orario || oraAdesso();
    routing.adesso = adesso === true;
    routing.chiave = null;
    salvaQuando();
    const campoData = $('input-data');
    const campoOra = $('input-ora');
    if (campoData) campoData.value = routing.giorno;
    if (campoOra) campoOra.value = routing.orario;
    calcolaPercorso();
  }

  // Cambio tra "parti alle" e "arriva entro": in arrivo l'orario diventa una
  // scadenza e, se prima seguiva l'adesso, si parte da un'ora sensata.
  function impostaModo(modo) {
    if (modo === routing.modo) return;
    routing.modo = modo;
    routing.chiave = null;
    if (modo === 'arrivo') {
      // Se l'ora salvata era una partenza ormai passata non ha senso usarla
      // come scadenza: si propone tra un'ora, arrotondata ai 5 minuti.
      const base = dataDaGiornoEOra(routing.giorno, routing.orario);
      if (routing.adesso || !routing.orario || base.getTime() <= Date.now() + 5 * 60000) {
        const d = new Date(Date.now() + 60 * 60000);
        d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
        routing.giorno = isoDi(d);
        routing.orario = due(d.getHours()) + ':' + due(d.getMinutes());
        routing.adesso = false;
      }
    } else if (!routing.orario) {
      routing.orario = oraAdesso();
      routing.adesso = true;
    }
    salvaQuando();
    disegnaPercorso();
    calcolaPercorso();
  }

  function secondiDelGiorno(d) {
    return d.getHours() * 3600 + d.getMinutes() * 60;
  }

  // Il motore calcola l'arrivo più presto a una data ora di partenza. Per avere
  // più alternative si prova qualche partenza in più; in modalità arrivo si
  // arretra dalla scadenza e si tengono solo i viaggi che arrivano in tempo.
  function calcolaOpzioni(da, a, base) {
    const arrivo = routing.modo === 'arrivo';
    const tentativi = arrivo ? [5, 10, 20, 40, 60, 90, 120, 180] : [0, 12, 25, 40];
    // La scadenza si confronta come istante assoluto: dopo mezzanotte i
    // secondi del giorno ripartono da zero, mentre le corse serali hanno
    // orari oltre 86400 (es. 00:39 = 88740).
    const limite = arrivo ? base.getTime() : null;
    routing.scadenza = arrivo ? secondiDelGiorno(base) : null;
    const visti = new Set();
    const esiti = [];
    let errore = null;
    tentativi.forEach((offset) => {
      const quando = new Date(base.getTime() + (arrivo ? -offset : offset) * 60000);
      const esito = TPERRouting.calcola(da, a, quando, { maxCambi: 3 });
      if (!esito) return;
      if (esito.errore) { errore = errore || esito; return; }
      // Arrivo reale a destinazione: quello del bus più il tratto a piedi
      // finale (una stazione o un indirizzo non sono la fermata del bus).
      const arrivoDestinazione = quando.getTime() +
        (esito.arrivo - esito.richiesta) * 1000 +
        (esito.camminoFinale || 0) * 1000;
      if (arrivo && arrivoDestinazione > limite) return;
      esito.margine = arrivo ? Math.round((limite - arrivoDestinazione) / 1000) : null;
      const firma = esito.tappe.map((t) => t.linea + '|' + t.da + '|' + t.a + '|' + t.partenza).join(';');
      if (visti.has(firma)) return;
      visti.add(firma);
      esiti.push(esito);
    });
    return { esiti: esiti.slice(0, 4), errore: errore };
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

  // Cambio a piedi tra fermate vicine: le paline opposte o le fermate della
  // stessa piazza stanno a 50–150 m. Senza questo la pianificazione le tratta
  // come luoghi scollegati e fa fare giri assurdi in autobus.
  let camminiPronti = false;
  const CAMMINO_CAMBIO = 150;   // metri

  function preparaCammini() {
    if (camminiPronti || typeof TPERRouting === 'undefined' || !TPERRouting.impostaCammini) return;
    if (fermate.length < 100) return;   // elenco ridotto offline: si riproverà
    camminiPronti = true;
    const celle = new Map();
    fermate.forEach((f) => {
      if (f.lat == null || f.lon == null) return;
      const chiave = Math.round(f.lat * 1000) + ':' + Math.round(f.lon * 1000);
      if (!celle.has(chiave)) celle.set(chiave, []);
      celle.get(chiave).push(f);
    });
    const coppie = [];
    fermate.forEach((f) => {
      if (f.lat == null || f.lon == null) return;
      const cx = Math.round(f.lat * 1000);
      const cy = Math.round(f.lon * 1000);
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          const gruppo = celle.get((cx + dx) + ':' + (cy + dy));
          if (!gruppo) continue;
          gruppo.forEach((v) => {
            if (v.id <= f.id) return;   // ogni coppia una volta sola
            const d = distanzaMetri(f, v);
            if (d <= CAMMINO_CAMBIO) coppie.push([f.id, v.id, Math.round(d * 1.15)]);
          });
        }
      }
    });
    TPERRouting.impostaCammini(coppie);
  }

  function disegnaPercorso() {
    const blocco = $('blocco-percorso');
    if (!blocco) return;
    assicuraQuando();
    blocco.innerHTML = VistaPercorso.controlli(routing.giorno, routing.orario, routing.modo) +
      VistaPercorso.esito(routing, etichettaFermata);
    aggiornaScrim();
    // I campi vengono ricreati a ogni render: un change di un campo già
    // staccato dal DOM (capita quando l'orologio aggiorna l'ora) non deve
    // spegnere la modalità "adesso".
    const inputOra = $('input-ora');
    if (inputOra) {
      inputOra.addEventListener('change', () => {
        if (!inputOra.isConnected) return;
        aggiornaQuando(routing.giorno, inputOra.value, false);
      });
    }
    const inputData = $('input-data');
    if (inputData) {
      inputData.min = oggiISO();
      inputData.addEventListener('change', () => {
        if (!inputData.isConnected) return;
        aggiornaQuando(inputData.value, routing.orario, false);
      });
    }
    // Le opzioni sono <details>: si aprono al clic. Aperta una, la mappa mostra
    // quel percorso; l'ultima scelta resta aperta anche dopo un ricalcolo.
    const dettagli = blocco.querySelectorAll('details.opzione');
    dettagli.forEach((dettaglio) => {
      // Un <details> aperto viene chiuso anche quando il render sostituisce il
      // nodo: solo un clic dell'utente deve azzerare l'opzione ricordata.
      let chiusuraUtente = false;
      const summary = dettaglio.querySelector('summary');
      if (summary) summary.addEventListener('click', () => { if (dettaglio.open) chiusuraUtente = true; });
      dettaglio.addEventListener('toggle', () => {
        const indice = parseInt(dettaglio.dataset.opzione, 10);
        if (!dettaglio.open) {
          if (chiusuraUtente && routing.aperto === indice) routing.aperto = -1;
          chiusuraUtente = false;
          return;
        }
        dettagli.forEach((altra) => { if (altra !== dettaglio) altra.open = false; });
        routing.aperto = indice;
        if (routing.opzioni && routing.opzioni[indice]) {
          routing.esito = routing.opzioni[indice];
          disegnaTracciato();
        }
      });
    });
    if (routing.aperto >= 0 && dettagli[routing.aperto] && !dettagli[routing.aperto].open) {
      dettagli[routing.aperto].open = true;
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
    const chiave = sel.partenza.id + '|' + sel.destinazione.id + '|' + routing.giorno + '|' + routing.orario + '|' + routing.modo;
    const terminale = routing.stato === 'ok' || routing.stato === 'nessuno' ||
      routing.stato === 'messaggio' || routing.stato === 'piedi' || routing.stato === 'errore';
    if (routing.chiave === chiave && terminale) return;

    const distanza = (sel.partenza.lat != null && sel.destinazione.lat != null)
      ? distanzaMetri(sel.partenza, sel.destinazione) : null;
    routing.chiave = chiave;
    routing.richiesta += 1;
    const richiesta = routing.richiesta;
    routing.esito = null;
    routing.opzioni = [];
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
      preparaCammini();
      return calcolaOpzioni(
        candidatiPercorso(sel.partenza),
        candidatiPercorso(sel.destinazione),
        dataDaGiornoEOra(routing.giorno, routing.orario)
      );
    }).then((risultato) => {
      if (richiesta !== routing.richiesta || !risultato) return;
      if (!risultato.esiti.length) {
        if (risultato.errore) {
          routing.stato = 'messaggio';
          routing.esito = risultato.errore;
        } else {
          routing.stato = 'nessuno';
        }
      } else {
        routing.stato = 'ok';
        routing.opzioni = risultato.esiti;
        routing.aperto = routing.aperto >= 0 && routing.aperto < routing.opzioni.length ? routing.aperto : -1;
        routing.esito = routing.opzioni[routing.aperto >= 0 ? routing.aperto : 0];
        routing.opzioni.forEach((esito) => coloraTappe(esito));
        // Le geometrie arrivano dopo il calcolo: appena pronte il tracciato
        // viene ridisegnato con il percorso reale della linea.
        if (typeof TPERRouting !== 'undefined' && TPERRouting.caricaTracciati) {
          TPERRouting.caricaTracciati(URL_TRACC_GZ, URL_TRACC).then(() => {
            if (richiesta !== routing.richiesta || routing.stato !== 'ok' || !routing.opzioni.length) return;
            // Il percorso è già calcolato ma senza geometrie: si rifà una volta
            // sola, così le tratte portano la forma della linea.
            const senzaForma = routing.opzioni.some((esito) =>
              esito.tappe.some((tappa) => !(tappa.forma >= 0)));
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

  // "Adesso" non è un'etichetta: ogni 30 secondi l'ora segue il tempo reale e
  // il percorso viene ricalcolato quando il minuto cambia.
  let orologio = null;
  function avviaOrologio() {
    if (orologio) return;
    orologio = setInterval(() => {
      if (!routing.adesso) return;
      if (routing.giorno !== oggiISO()) return;
      if (routing.orario === oraAdesso()) return;
      aggiornaQuando(oggiISO(), oraAdesso(), true);
    }, 30000);
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
    const parti = String(ora || '').split(':');
    const ore = parseInt(parti[0], 10);
    const minuti = parseInt(parti[1], 10);
    if (!isFinite(ore) || !isFinite(minuti)) return 0;
    // Orario circolare: 23:58 visto alle 00:10 è un bus passato da 12 minuti,
    // non uno in arrivo tra 1428. Il valore resta nell'intervallo -720..720.
    const target = ((ore % 24) * 60 + minuti) % 1440;
    const oraLocale = new Date();
    const adesso = oraLocale.getHours() * 60 + oraLocale.getMinutes();
    return ((target - adesso + 720 + 1440) % 1440) - 720;
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
        ora: String(parseInt(m[3], 10) % 24).padStart(2, '0') + ':' + m[4],
        bus: bus,
        pedana: /CON PEDANA/i.test(extra),
        minuti: minutiA(m[3] + ':' + m[4])
      });
    });
    return arrivi;
  }

  function fermataLive() {
    const scelta = sel[stopLiveRuolo] || sel.partenza || sel.destinazione || null;
    if (!scelta || !eIndirizzo(scelta)) return scelta;
    // Per un indirizzo il tempo reale si chiede alla palina più vicina.
    const vicina = fermateVicine(scelta.lat, scelta.lon, 1)[0];
    if (!vicina) return null;
    return Object.assign({}, vicina, {
      indirizzo: scelta.indirizzo || scelta.nome
    });
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
      // I minuti si ricalcolano dall'orario: quelli salvati in cache possono
      // essere vecchi di un paio di minuti e mostrare un bus già passato.
      const minuti = minutiA(arrivo.ora);
      const tempo = minuti <= 0 ? 'In arrivo' : minuti + '<span class="unita">min</span>';
      const meta = (arrivo.bus ? 'Bus ' + esc(arrivo.bus) : 'Corsa programmata') + ' · ore ' + esc(arrivo.ora);
      const voce = coloreLinea(arrivo.linea);
      const colore = voce
        ? ' style="background:' + esc(voce[0]) + ';color:' + esc(voce[1] || '#FFFFFF') + '"'
        : '';
      return '<li class="arrivo">' +
        '<span class="badge-linea"' + colore + '>' + esc(arrivo.linea) + '</span>' +
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
    // In orizzontale lo schermo è basso: 320 px di altezza minima lasciavano
    // quasi nessuna mappa. Con 240 la scheda resta usabile anche a 390 px.
    const altezza = Math.max(240, Math.min(760, window.innerHeight - fondo - 12));
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
      }, 300);
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
          const primo = $('overlay-lista').querySelector('[data-voce], [data-indirizzo]');
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
      const indirizzo = evento.target.closest('[data-indirizzo]');
      if (indirizzo) {
        const lat = parseFloat(indirizzo.getAttribute('data-lat'));
        const lon = parseFloat(indirizzo.getAttribute('data-lon'));
        if (!isFinite(lat) || !isFinite(lon)) return;
        const vicina = fermateVicine(lat, lon, 1)[0];
        const ruolo = indirizzo.getAttribute('data-ruolo') || campoAttivo || 'destinazione';
        selezionaFermata(ruolo, {
          id: 'geo:' + lat.toFixed(5) + ',' + lon.toFixed(5),
          nome: indirizzo.getAttribute('data-nome') || 'Indirizzo',
          indirizzo: indirizzo.getAttribute('data-dettaglio') || '',
          lat: lat,
          lon: lon,
          zona: vicina ? vicina.zona : '500',
          tipo: 'indirizzo'
        });
        return;
      }
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
        if (azione === 'ora-adesso') aggiornaQuando(oggiISO(), oraAdesso(), true);
        if (azione === 'tra-un-ora') {
          const d = new Date(Date.now() + 60 * 60000);
          d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
          aggiornaQuando(isoDi(d), due(d.getHours()) + ':' + due(d.getMinutes()), false);
        }
        if (azione === 'modo-partenza') impostaModo('partenza');
        if (azione === 'modo-arrivo') impostaModo('arrivo');
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

    // Rotazione e tastiera virtuale cambiano l'altezza utile: il canvas della
    // mappa non segue da solo il contenitore e la scheda resta traslata sulla
    // misura precedente. Si riadatta tutto e si reinquadra il percorso.
    const adattaAllaVista = debounce(() => {
      if (trascinando) return;
      if (mappa) mappa.resize();
      adattaAltezzaSheet();
      applicaTrasformazione(traslazionePer(statoSheet), false);
      aggiornaScrim();
      if (routing.stato === 'ok' && ultimeFeatures.length) inquadraPercorso(0);
      else if (sel.partenza || sel.destinazione) inquadra(false);
    }, 150);
    window.addEventListener('resize', adattaAllaVista);
    // Su iOS orientationchange può arrivare prima che il viewport sia
    // aggiornato; il debounce fa vincere l'ultimo evento (di solito resize).
    window.addEventListener('orientationchange', adattaAllaVista);
    if (window.screen && screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', adattaAllaVista);
    }

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
    avviaOrologio();
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
