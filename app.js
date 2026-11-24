/* Muovi Bologna — logica dell'app
   Dati fermate: open data TPER/Regione Emilia-Romagna
   Orari in tempo reale: web service pubblico HelloBus di TPER */
(function () {
  'use strict';

  // Le logiche pure vivono in moduli separati, così sono testabili a parte.
  const Tariffe = window.Tariffe;
  const Piedi = window.Piedi;

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
  const K_CAMMINATA = 'tperzc_camminata_v1';
  const K_PROXY = 'tperzc_proxy';
  const K_RELAY = 'tperzc_relay';
  const URL_UFFICIALE = 'https://solweb.tper.it/web/tools/zone-calculator.aspx';
  const HELLOBUS = 'https://hellobuswsweb.tper.it/web-services/hellobus.asmx/QueryHellobus';
  const RELAY_PREDEFINITO = 'https://api.allorigins.win/raw?url=';
  const INTERVALLO_LIVE = 30000;
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const NOMINATIM_PAUSA = 1100;      // ms tra due richieste: è la policy d'uso di OSM
  const LUOGHI_MIN = 3;              // caratteri minimi prima di cercare un luogo o indirizzo


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
  // Quanto è disposto a camminare l'utente: da 3 a 25 minuti. È il tetto per i
  // tratti a piedi che il pianificatore può proporre (fermate vicine e cambi).
  const CAMMINATA_MIN = 3;
  const CAMMINATA_MAX = 25;
  const CAMMINATA_DEFAULT = 10;
  const PASSO_METRI_SECONDO = 1.25;   // passo medio, lo stesso della navigazione

  function leggiCamminata() {
    const salvato = parseInt(leggiJSON(K_CAMMINATA), 10);
    if (!isFinite(salvato)) return CAMMINATA_DEFAULT;
    return Math.min(CAMMINATA_MAX, Math.max(CAMMINATA_MIN, salvato));
  }

  let camminata = leggiCamminata();

  function raggioCamminata() {
    return Math.round(camminata * 60 * PASSO_METRI_SECONDO);
  }
  let mappa = null;
  const marker = { partenza: null, destinazione: null };
  let statoSheet = 'meta';
  let tabAttivo = 'viaggio';
  let campoAttivo = null;
  let stopLiveRuolo = 'partenza';
  let posizioneUtente = null;
  // Navigazione guidata: posizione continua, passo corrente, mappa in follow.
  const navigazione = {
    attiva: false, watchId: null, ultima: null, precisione: null,
    passi: [], indice: 0, follow: true, inquadrato: false, ultimoVolo: 0, arrivo: null
  };
  let markerUtente = null;
  let eventoInstallazione = null;
  let liveAbort = null;
  let timerLive = null;
  let trascinando = false;
  let sopprimiClick = false;
  const indirizziCache = new Map();
  let indirizziAbort = null;
  let ultimaRichiestaIndirizzi = 0;
  const suggerimenti = { token: 0, campo: null, query: '', gruppi: [], indirizzi: [], caricamento: false, errore: false };

  const live = { items: [], ts: 0, stato: 'idle', caricamento: false, errore: null, stopId: null, avviso: '' };

  const $ = (id) => document.getElementById(id);
  // Set unico di icone: Lucide inline, nessuna CDN e nessun font esterno.
  const Icone = window.Icone;
  const ICONA_BUS = Icone.svg('bus-front', 18);
  const ICONA_TRENO = Icone.svg('train-front', 18);
  const ICONA_LUOGO = Icone.svg('map-pin', 18);
  const ICONA_ACCESSIBILITA = Icone.svg('accessibility', 16);
  const ICONA_REFRESH = Icone.svg('refresh-cw', 18);
  const ICONA_INFO = Icone.svg('info', 18);
  const ICONA_CHEVRON = Icone.svg('chevron-right', 18, 'voce-freccia');
  const ICONA_PIEDANA = Icone.svg('footprints', 20);

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

  // I luoghi trovati su OpenStreetMap hanno tipo 'indirizzo' per continuare a
  // usare coordinate e percorso esatti; genere e categoria sono solo per la UI.
  function etichettaGenere(luogo) {
    if (!luogo) return '';
    return luogo.genere === 'luogo'
      ? (luogo.categoria || 'Luogo') + ' · zona ' + luogo.zona
      : 'Indirizzo · zona ' + luogo.zona;
  }

  // Codice palina e riferimento breve: servono a riconoscere la fermata sul posto.
  function riferimentoFermata(f) {
    if (!f) return '';
    if (eIndirizzo(f)) return f.indirizzo || f.nome || 'Indirizzo';
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
    elemento.innerHTML = Icone.svg('map-pin-pieno', 34, '', {
      fill: ruolo === 'partenza' ? '#C1121F' : '#1A1A1A',
      stroke: '#fff',
      strokeWidth: 1.3
    });
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
      // Durante la navigazione la mappa segue l'utente: chi la sposta sta
      // guardando altrove e può ricentrare con il pulsante dedicato.
      if (navigazione.attiva) {
        if (navigazione.follow) {
          navigazione.follow = false;
          aggiornaNavFollow();
        }
        return;
      }
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
    // In navigazione la camera appartiene all'utente, non al viaggio.
    if (navigazione.attiva) return;
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
    // Un bordo chiaro separa il tratteggio pedonale dallo sfondo e dalle linee
    // del bus, soprattutto quando il cammino è breve e vicino alle fermate.
    mappa.addLayer({
      id: 'percorso-piedi-bordo',
      type: 'line',
      source: 'percorso',
      filter: ['==', ['get', 'modo'], 'piedi'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 7, 'line-opacity': 0.72 }
    });
    mappa.addLayer({
      id: 'percorso-piedi',
      type: 'line',
      source: 'percorso',
      filter: ['==', ['get', 'modo'], 'piedi'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1A1A1A', 'line-width': 3, 'line-opacity': 0.72, 'line-dasharray': [1.5, 1.6] }
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

  // Percorsi pedonali: OSRM pubblico FOSSGIS, profilo foot. Le coordinate
  // vengono inviate solo per calcolare il tratto a piedi; il risultato resta
  // in cache locale e, se il servizio non risponde, si usa il segmento diritto.
  const K_PIEDI = 'tperzc_piedi_v4';
  const PIEDI_MAX_METRI = 2500;   // nessun tratto pedonale dell'app è più lungo
  let piediCache = null;
  const piediInCorso = new Set();
  const piediFalliti = new Set();

  function piediCaricati() {
    if (piediCache) return piediCache;
    piediCache = new Map();
    const salvate = leggiJSON(K_PIEDI);
    if (Array.isArray(salvate)) salvate.forEach((voce) => {
      // Butta le geometrie vecchie o impossibili: una cache con coordinate
      // invertite o un percorso lungo decine di chilometri rovinava la mappa.
      if (voce && voce[0] && Piedi.valida(voce[1], PIEDI_MAX_METRI)) piediCache.set(voce[0], voce[1]);
    });
    return piediCache;
  }

  function piediSalvati() {
    if (!piediCache) return;
    const voci = Array.from(piediCache.entries()).slice(-100);
    const testo = JSON.stringify(voci);
    if (testo.length < 1200000) scrivi(K_PIEDI, testo);
  }

  function geometriaPiedi(da, a) {
    if (!da || !a) return null;
    if (distanzaTra(da, a) < 25) return [da, a];
    const geometria = piediCaricati().get(Piedi.chiave(da, a));
    return geometria && Piedi.valida(geometria, PIEDI_MAX_METRI) ? geometria : null;
  }

  function chiediPiedi(da, a) {
    if (!da || !a || !navigator.onLine) return;
    const chiave = Piedi.chiave(da, a);
    if (distanzaTra(da, a) > PIEDI_MAX_METRI) {
      piediFalliti.add(chiave);
      return;
    }
    if (piediInCorso.has(chiave) || piediFalliti.has(chiave) || piediCaricati().has(chiave)) return;
    piediInCorso.add(chiave);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    fetch(Piedi.url(da, a) + '?overview=full&geometries=geojson&steps=false', { signal: controller.signal })
      .then((risposta) => (risposta.ok ? risposta.json() : null))
      .then((dati) => {
        const coordinate = Piedi.geometriaRisposta(dati);
        if (!coordinate || !Piedi.valida(coordinate, PIEDI_MAX_METRI)) {
          piediFalliti.add(chiave);
          return;
        }
        // La GeoJSON di OSRM è [lon, lat], lo stesso ordine usato dall'app.
        piediCaricati().set(chiave, coordinate);
        piediSalvati();
        // Un percorso composto solo da cammino non ha tappe bus: aggiorna
        // distanza e tempo con la geometria vera, poi ridisegna anche la riga.
        if (routing.stato === 'piedi' && routing.piedi && routing.piedi.chiave === chiave) {
          routing.piedi.metri = Math.round(Piedi.lunghezza(coordinate));
          routing.piedi.minuti = minuti(routing.piedi.metri * 1.3 / 1.2);
          disegnaPercorso();
        } else if (routing.stato === 'ok') {
          disegnaTracciato();
        }
      })
      .catch(() => { piediFalliti.add(chiave); })
      .finally(() => {
        clearTimeout(timer);
        piediInCorso.delete(chiave);
      });
  }

  // Un tratto a piedi usa la geometria pedonale se è già in cache; altrimenti
  // disegna subito il segmento diritto e lo sostituisce appena arriva OSRM.
  function segmentoPiedi(da, a) {
    if (!da || !a) return null;
    const geometria = geometriaPiedi(da, a);
    if (!geometria) chiediPiedi(da, a);
    return segmento('piedi', geometria || [da, a]);
  }

  function distanzaTra(a, b) {
    return Math.hypot((a[0] - b[0]) * 83000, (a[1] - b[1]) * 111000);
  }

  // La linea deve toccare le fermate di salita e discesa, anche quando la
  // geometria GTFS si ferma qualche metro prima.
  const ESTENSIONE_MAX = 60;   // metri: oltre, il raccordo diritto taglierebbe la strada

  function estendiAgliEstremi(linea, da, a) {
    const copia = linea.slice();
    if (da && distanzaTra(copia[0], da) <= ESTENSIONE_MAX) copia.unshift(da);
    if (a && distanzaTra(copia[copia.length - 1], a) <= ESTENSIONE_MAX) copia.push(a);
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

  // Disegna il percorso con le geometrie ufficiali GTFS: niente map matching
  // stradale, la linea sulla mappa è quella che fa davvero il bus.
  function disegnaTracciato() {
    if (!mappa) return;
    // Lo stile può finire di caricarsi dopo il primo disegno: i livelli si
    // aggiungono qui appena è pronto, senza dipendere da un solo evento.
    if (!mappa.getSource('percorso')) aggiungiLivelliPercorso();
    const sorgente = mappa.getSource('percorso');
    if (!sorgente) return;
    const sorgenteFermate = mappa.getSource('percorso-fermate');

    const esito = routing.stato === 'ok' ? routing.esito : null;
    const features = [];
    const fermate = [];
    const nodi = [];
    let senzaTracciato = 0;
    // Un viaggio molto breve è tutto a piedi: non passa dal pianificatore bus,
    // ma deve comunque avere la sua linea sulla mappa.
    if (routing.stato === 'piedi' && routing.piedi &&
        sel.partenza && sel.destinazione &&
        sel.partenza.lat != null && sel.partenza.lon != null &&
        sel.destinazione.lat != null && sel.destinazione.lon != null) {
      const da = [sel.partenza.lon, sel.partenza.lat];
      const a = [sel.destinazione.lon, sel.destinazione.lat];
      const tratto = segmentoPiedi(da, a);
      if (tratto) features.push(tratto);
      nodi.push(nodo('partenza', da));
      nodi.push(nodo('arrivo', a));
    }
    if (esito && esito.tappe && esito.tappe.length) {
      const tappe = esito.tappe;
      const ufficiali = geometrieUfficiali(tappe);
      if (sel.partenza && sel.partenza.lat != null && esito.camminoIniziale > 0) {
        const prima = coordinateFermata(tappe[0].da);
        const tratto = prima ? segmentoPiedi([sel.partenza.lon, sel.partenza.lat], prima) : null;
        if (tratto) features.push(tratto);
      }
      tappe.forEach((tappa, indice) => {
        const voce = ufficiali[indice];
        // Forma GTFS così com'è: è il percorso reale della linea.
        const geometria = voce && voce.punti;
        const ufficiale = !!(voce && voce.ufficiale);
        if (tappa.camminoPrima) {
          const da = coordinateFermata(tappa.camminoPrima.da);
          const a = coordinateFermata(tappa.da);
          const tratto = da && a ? segmentoPiedi(da, a) : null;
          if (tratto) features.push(tratto);
        }
        let disegnata = null;
        // Treno e bus hanno colori distinti anche nei pallini intermedi:
        // altrimenti una fermata del treno sembrava una fermata del bus.
        // I treni sono rossi come i badge: prima erano grigi e sulla mappa
        // sembravano un tratto senza linea.
        const coloreLinea = (tappa.tipo === 1 || tappa.tipo === 2) ? '#C1121F' : coloreTracciato(tappa.linea);
        if (geometria && geometria.length > 1) {
          disegnata = estendiAgliEstremi(geometria, coordinateFermata(tappa.da), coordinateFermata(tappa.a));
          features.push(segmento('bus', disegnata, ufficiale, coloreLinea));
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
              properties: { colore: coloreLinea },
              geometry: { type: 'Point', coordinates: proiettaSuLinea(punto, disegnata) }
            });
          }
        });
      });
      if (sel.destinazione && sel.destinazione.lat != null && esito.camminoFinale > 0) {
        const ultima = coordinateFermata(tappe[tappe.length - 1].a);
        const tratto = ultima ? segmentoPiedi([ultima[0], ultima[1]], [sel.destinazione.lon, sel.destinazione.lat]) : null;
        if (tratto) features.push(tratto);
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

    }
    ultimeFeatures = features;
    sorgente.setData({ type: 'FeatureCollection', features: features });
    if (sorgenteFermate) sorgenteFermate.setData({ type: 'FeatureCollection', features: fermate });
    const sorgenteNodi = mappa.getSource('percorso-nodi');
    if (sorgenteNodi) sorgenteNodi.setData({ type: 'FeatureCollection', features: nodi });
    // Il pannello dichiara quando un tratto non ha il tracciato ufficiale.
    const nota = $('nota-tracciato');
    if (nota) nota.hidden = senzaTracciato === 0;
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
    if (navigazione.attiva) return;
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
   * Navigazione guidata
   * ------------------------------------------------------------------ */
  const NAV_SOGLIA = 35;              // metri: sotto questa distanza il passo è raggiunto
  const NAV_VELOCITA_PIEDI = 1.25;    // m/s, passo medio di una persona
  const NAV_ZOOM = 16.4;

  function coordinataDi(luogo) {
    return luogo && luogo.lat != null && luogo.lon != null ? [luogo.lon, luogo.lat] : null;
  }

  function distanzaInMetri(punto, coordinate) {
    if (!punto || !coordinate) return null;
    return distanzaMetri(punto, { lat: coordinate[1], lon: coordinate[0] });
  }

  function metriTesto(metri) {
    if (metri == null || !isFinite(metri)) return '';
    if (metri < 950) return Math.max(10, Math.round(metri / 10) * 10) + ' m';
    const km = metri / 1000;
    return km.toFixed(km < 9.95 ? 1 : 0).replace('.', ',') + ' km';
  }

  // Passi da seguire: cammino, corse (con la fermata di discesa) e cammino
  // finale. Non rifà il routing: usa il percorso già calcolato.
  function passiNavigazione() {
    const passi = [];
    if (routing.stato === 'piedi') {
      const punto = coordinataDi(sel.destinazione);
      if (punto) {
        passi.push({ modo: 'piedi', titolo: 'A piedi', etichetta: 'fino a', nome: sel.destinazione.nome, punto: punto });
      }
      return passi;
    }
    const esito = routing.esito;
    if (!esito || !esito.tappe || !esito.tappe.length) return passi;
    if (esito.camminoIniziale > 0) {
      const prima = coordinateFermata(esito.tappe[0].da);
      if (prima) {
        passi.push({ modo: 'piedi', titolo: 'A piedi', etichetta: 'fino a', nome: nomeFermata(esito.tappe[0].da), punto: prima });
      }
    }
    esito.tappe.forEach((tappa) => {
      const punto = coordinateFermata(tappa.a);
      if (!punto) return;
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      passi.push({
        modo: treno ? 'treno' : 'bus',
        titolo: (treno ? 'Treno ' : 'Bus ') + tappa.linea,
        etichetta: 'scendi a',
        nome: nomeFermata(tappa.a),
        punto: punto
      });
    });
    const fine = coordinataDi(sel.destinazione);
    if (esito.camminoFinale > 0 && fine) {
      passi.push({ modo: 'piedi', titolo: 'A piedi', etichetta: 'fino a', nome: sel.destinazione.nome, punto: fine });
    }
    return passi;
  }

  // Orario di arrivo previsto: quello del viaggio scelto; per un tragitto
  // tutto a piedi si stima dalla distanza che resta.
  function arrivoPrevisto(passi) {
    if (routing.stato === 'piedi' && routing.piedi) {
      const diretta = passi.length ? distanzaInMetri(posizioneUtente, passi[0].punto) : null;
      const metri = diretta == null ? routing.piedi.metri : diretta;
      const ora = new Date();
      const secondi = ora.getHours() * 3600 + ora.getMinutes() * 60 + ora.getSeconds() + metri / NAV_VELOCITA_PIEDI;
      return hhmm(secondi);
    }
    if (routing.stato === 'ok' && routing.esito && routing.esito.arrivo != null) {
      return hhmm(routing.esito.arrivo + (routing.esito.camminoFinale || 0));
    }
    return null;
  }

  function creaMarkerUtente() {
    if (!mappa || !window.maplibregl) return null;
    if (markerUtente) return markerUtente;
    const elemento = document.createElement('div');
    elemento.className = 'pin-utente';
    elemento.setAttribute('aria-hidden', 'true');
    elemento.innerHTML = '<span class="pin-utente-alone"></span><span class="pin-utente-punto"></span>';
    markerUtente = new maplibregl.Marker({ element: elemento, anchor: 'center' });
    return markerUtente;
  }

  function aggiornaNavFollow() {
    const centro = $('nav-centra');
    if (centro) centro.hidden = navigazione.follow;
  }

  function centraNavigazione() {
    navigazione.follow = true;
    navigazione.inquadrato = false;
    navigazione.ultimoVolo = 0;
    aggiornaNavFollow();
    if (navigazione.ultima && mappa) {
      mappa.easeTo({ center: [navigazione.ultima.lon, navigazione.ultima.lat], zoom: NAV_ZOOM, duration: 600 });
      navigazione.inquadrato = true;
      navigazione.ultimoVolo = Date.now();
    }
    disegnaNavigazione();
  }

  function disegnaNavigazione() {
    if (!navigazione.attiva) return;
    const passi = navigazione.passi;
    const passo = passi[Math.min(navigazione.indice, passi.length - 1)];
    if (!passo) return;
    const distanza = distanzaInMetri(navigazione.ultima, passo.punto);
    const arrivato = navigazione.indice >= passi.length - 1 && distanza != null && distanza < NAV_SOGLIA;
    const icone = { piedi: ICONA_PIEDANA, bus: ICONA_BUS, treno: ICONA_TRENO };
    const icona = $('nav-ico');
    if (icona) {
      icona.className = 'nav-ico ' + passo.modo;
      icona.innerHTML = icone[passo.modo] || ICONA_BUS;
    }
    $('nav-titolo').textContent = arrivato ? 'Sei arrivato' : passo.titolo;
    $('nav-sotto').textContent = arrivato
      ? nomeBreve(passo.nome)
      : passo.etichetta + ' ' + nomeBreve(passo.nome);
    $('nav-distanza').textContent = !navigazione.ultima
      ? '…'
      : (arrivato ? '0 m' : metriTesto(distanza));
    $('nav-passo').textContent = passi.length > 1
      ? (navigazione.indice + 1) + '/' + passi.length
      : '';
    $('nav-eta').textContent = navigazione.arrivo || '—';
  }

  function avanzaPassi(punto) {
    const passi = navigazione.passi;
    for (let i = navigazione.indice; i < passi.length; i += 1) {
      const distanza = distanzaInMetri(punto, passi[i].punto);
      if (distanza == null || distanza > NAV_SOGLIA) {
        navigazione.indice = i;
        return;
      }
      navigazione.indice = Math.min(i + 1, passi.length - 1);
      if (i + 1 >= passi.length) return;
    }
  }

  function aggiornaNavigazione(posizione) {
    if (!navigazione.attiva) return;
    const punto = { lat: posizione.coords.latitude, lon: posizione.coords.longitude };
    navigazione.precisione = isFinite(posizione.coords.accuracy) ? Math.round(posizione.coords.accuracy) : null;
    navigazione.ultima = punto;
    posizioneUtente = punto;
    const marcatore = creaMarkerUtente();
    if (marcatore && mappa) marcatore.setLngLat([punto.lon, punto.lat]).addTo(mappa);
    avanzaPassi(punto);
    if (mappa && navigazione.follow) {
      const adesso = Date.now();
      // La mappa si muove solo quando serve: un easeTo a ogni fix GPS
      // renderebbe il trascinamento impossibile.
      if (!navigazione.inquadrato || adesso - navigazione.ultimoVolo > 1200) {
        navigazione.ultimoVolo = adesso;
        mappa.easeTo({
          center: [punto.lon, punto.lat],
          zoom: navigazione.inquadrato ? mappa.getZoom() : NAV_ZOOM,
          duration: navigazione.inquadrato ? 900 : 700
        });
        navigazione.inquadrato = true;
      }
    }
    disegnaNavigazione();
  }

  function erroreNavigazione(errore) {
    if (!navigazione.attiva) return;
    // Permesso negato (codice 1): senza posizione la navigazione non ha senso.
    if (errore && errore.code === 1) {
      fermaNavigazione(true);
      mostraToast('Posizione negata: consenti l\'accesso per navigare');
      return;
    }
    const sotto = $('nav-sotto');
    if (sotto) sotto.textContent = 'Cerco di nuovo la posizione…';
  }

  function avviaNavigazione() {
    if (navigazione.attiva) return;
    if (!sel.partenza || !sel.destinazione) {
      mostraToast('Scegli partenza e destinazione per avviare la navigazione');
      return;
    }
    if (!navigator.geolocation) {
      mostraToast('Geolocalizzazione non supportata da questo browser');
      return;
    }
    const passi = passiNavigazione();
    if (!passi.length) {
      mostraToast('Nessun percorso da seguire: ricalcola il viaggio');
      return;
    }
    navigazione.attiva = true;
    navigazione.passi = passi;
    navigazione.indice = 0;
    navigazione.follow = true;
    navigazione.inquadrato = false;
    navigazione.ultima = null;
    navigazione.ultimoVolo = 0;
    navigazione.arrivo = arrivoPrevisto(passi);
    chiudiOverlay();
    document.body.classList.add('in-navigazione');
    // La scheda è nascosta: FAB, sfumatura e attribution seguono il pannello.
    document.documentElement.style.setProperty('--h-sheet', '128px');
    $('nav').hidden = false;
    $('nav-fondo').hidden = false;
    aggiornaNavFollow();
    disegnaNavigazione();
    navigazione.watchId = navigator.geolocation.watchPosition(aggiornaNavigazione, erroreNavigazione, {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 2000
    });
  }

  function fermaNavigazione(silenzioso) {
    if (!navigazione.attiva) return;
    navigazione.attiva = false;
    if (navigazione.watchId != null) {
      try { navigator.geolocation.clearWatch(navigazione.watchId); } catch (e) { /* già fermo */ }
      navigazione.watchId = null;
    }
    if (markerUtente) {
      markerUtente.remove();
      markerUtente = null;
    }
    document.body.classList.remove('in-navigazione');
    $('nav').hidden = true;
    $('nav-fondo').hidden = true;
    impostaSheet(statoSheet);
    if (!silenzioso) mostraToast('Navigazione terminata');
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
      ICONA_CHEVRON +
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

  // Etichette italiane per i risultati Nominatim. Il tipo OSM è più preciso
  // della categoria: "pharmacy" diventa Farmacia, "park" diventa Parco.
  const CATEGORIE_NOMINATIM = {
    marketplace: 'Mercato', restaurant: 'Ristorante', fast_food: 'Fast food',
    cafe: 'Caffè', bar: 'Bar', pub: 'Pub', pharmacy: 'Farmacia',
    hospital: 'Ospedale', clinic: 'Ambulatorio', doctors: 'Studio medico',
    dentist: 'Dentista', school: 'Scuola', university: 'Università',
    college: 'Università', kindergarten: 'Asilo', library: 'Biblioteca',
    bank: 'Banca', atm: 'Bancomat', fuel: 'Distributore', parking: 'Parcheggio',
    bus_station: 'Stazione bus', station: 'Stazione', theatre: 'Teatro',
    cinema: 'Cinema', museum: 'Museo', hotel: 'Hotel', hostel: 'Ostello',
    supermarket: 'Supermercato', mall: 'Centro commerciale', bakery: 'Panetteria',
    butcher: 'Macelleria', place_of_worship: 'Luogo di culto', police: 'Polizia',
    post_office: 'Ufficio postale', townhall: 'Municipio', sports_centre: 'Centro sportivo',
    park: 'Parco', garden: 'Giardino', playground: 'Parco giochi', attraction: 'Attrazione',
    viewpoint: 'Panorama', monument: 'Monumento', memorial: 'Memoriale', artwork: 'Opera'
  };
  const CATEGORIE_GENERICHE = {
    shop: 'Negozio', tourism: 'Luogo turistico', leisure: 'Tempo libero',
    historic: 'Luogo storico', amenity: 'Servizio', building: 'Edificio',
    office: 'Ufficio', craft: 'Artigianato', healthcare: 'Salute',
    place: 'Luogo', highway: 'Strada', boundary: 'Area', natural: 'Luogo naturale',
    waterway: 'Corso d\'acqua', railway: 'Ferrovia', man_made: 'Luogo'
  };

  function nomeNominatim(voce) {
    const dettagli = voce.namedetails || {};
    return dettagli['name:it'] || dettagli.name || voce.name || '';
  }

  function genereNominatim(voce) {
    if (!nomeNominatim(voce)) return 'indirizzo';
    const categoria = String(voce.category || '').toLowerCase();
    const tipo = String(voce.type || '').toLowerCase();
    if (categoria === 'place') return ['house', 'road', 'postcode'].includes(tipo) ? 'indirizzo' : 'luogo';
    if (['highway', 'boundary', 'waterway', 'railway', 'natural', 'landuse'].includes(categoria)) return 'indirizzo';
    return 'luogo';
  }

  function categoriaNominatim(voce) {
    const tipo = String(voce.type || '').toLowerCase();
    const categoria = String(voce.category || '').toLowerCase();
    return CATEGORIE_NOMINATIM[tipo] || CATEGORIE_GENERICHE[categoria] || 'Luogo';
  }

  // Luogo o indirizzo trovato su Nominatim: usa la zona della fermata più vicina
  // per il prezzo, mentre il percorso parte e arriva dalle coordinate esatte.
  function luogoHTML(luogo, ruolo) {
    const genere = luogo.genere === 'luogo' ? 'luogo' : 'indirizzo';
    const categoria = luogo.categoria || (genere === 'luogo' ? 'Luogo' : 'Indirizzo');
    return '<button class="voce" role="option" data-indirizzo="1" data-lat="' + luogo.lat + '" data-lon="' + luogo.lon +
      '" data-nome="' + esc(luogo.nome) + '" data-dettaglio="' + esc(luogo.indirizzo || '') +
      '" data-genere="' + genere + '" data-categoria="' + esc(categoria) + '" data-ruolo="' + esc(ruolo) + '">' +
      '<span class="voce-ico ' + (genere === 'luogo' ? 'luogo' : 'geo') + '">' + ICONA_LUOGO + '</span>' +
      '<span class="voce-testo"><span class="voce-nome">' + esc(luogo.nome) + '</span>' +
      (luogo.indirizzo ? '<span class="voce-indirizzo">' + esc(luogo.indirizzo) + '</span>' : '') +
      '<span class="voce-meta">' + esc(categoria) + ' · zona ' + esc(luogo.zona) + '</span></span>' +
      ICONA_CHEVRON +
      '</button>';
  }

  function disegnaSuggerimenti() {
    const lista = $('overlay-lista');
    const campo = suggerimenti.campo || 'destinazione';
    let html = suggerimenti.gruppi.map((gruppo) => {
      return '<div class="gruppo-titolo">' + esc(gruppo.titolo) + '</div>' +
        gruppo.items.map((f) => voceHTML(f, campo)).join('');
    }).join('');
    const luoghi = suggerimenti.indirizzi.filter((luogo) => luogo.genere === 'luogo');
    const indirizzi = suggerimenti.indirizzi.filter((luogo) => luogo.genere !== 'luogo');
    if (luoghi.length) {
      html += '<div class="gruppo-titolo">Luoghi</div>' +
        luoghi.map((luogo) => luogoHTML(luogo, campo)).join('');
    }
    if (indirizzi.length) {
      html += '<div class="gruppo-titolo">Indirizzi</div>' +
        indirizzi.map((luogo) => luogoHTML(luogo, campo)).join('');
    }
    if (luoghi.length || indirizzi.length) {
      html += '<p class="testo-intro" style="padding:6px 10px 10px;font-size:11px">Luoghi e indirizzi © OpenStreetMap contributors (ODbL)</p>';
    }
    if (suggerimenti.caricamento) {
      html += '<div class="gruppo-titolo">Luoghi e indirizzi</div>' +
        '<p class="testo-intro" style="padding:2px 10px 12px">Cerco su OpenStreetMap…</p>';
    }
    if (suggerimenti.errore) {
      html += '<p class="testo-intro" style="padding:8px 10px 12px">Ricerca di luoghi e indirizzi non disponibile: le fermate qui sopra funzionano lo stesso.</p>';
    }
    if (!html) {
      html = '<p class="testo-intro" style="padding:16px 8px 12px">Nessuna fermata, luogo o indirizzo trovato. Prova con un altro nome.</p>';
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
    const url = NOMINATIM + '?format=jsonv2&addressdetails=1&namedetails=1&limit=8&dedupe=1&accept-language=it&countrycodes=it' +
      // bounded=1: senza, il viewbox è solo un suggerimento e la ricerca
      // restituiva anche un "Mercato" di Napoli con la sua zona.
      '&viewbox=11.20,44.62,11.50,44.34&bounded=1&q=' + encodeURIComponent(testo);
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
      const nome = nomeNominatim(voce) || ((via + civico).trim() || String(voce.display_name || '').split(',')[0].trim());
      const genere = genereNominatim(voce);
      const categoria = genere === 'luogo' ? categoriaNominatim(voce) : 'Indirizzo';
      // Per un POI il nome è già il titolo: sotto si mostra via e città, non
      // l'indirizzo completo ripetuto. Per un indirizzo resta il contesto via/città.
      const contesto = [via && (via + civico), indirizzo.suburb, indirizzo.city || indirizzo.town || indirizzo.village, indirizzo.postcode]
        .filter(Boolean)
        .filter((parte) => normalizza(parte) !== normalizza(nome))
        .filter((parte, indice, tutte) => tutte.indexOf(parte) === indice)
        .join(' · ');
      const vicina = fermateVicine(lat, lon, 1)[0];
      trovati.push({
        id: 'geo:' + chiave,
        nome: nome || 'Luogo',
        indirizzo: contesto,
        lat: lat,
        lon: lon,
        zona: vicina ? vicina.zona : '500',
        tipo: 'indirizzo',
        genere: genere,
        categoria: categoria
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
    if (testo.length >= LUOGHI_MIN) cercaIndirizzi(testo);
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
    if (navigazione.attiva) fermaNavigazione(true);
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
    // Un viaggio nuovo parte dall'alto: il pannello poteva restare scrollato
    // dove lo aveva lasciato il viaggio precedente, con il prezzo fuori vista.
    if (sel.partenza && sel.destinazione) {
      const corpo = $('sheet-corpo');
      if (corpo) corpo.scrollTop = 0;
    }
  }

  // Le fermate si salvano per id, gli indirizzi per coordinate (l'id è finto).
  function luogoSalvato(luogo) {
    if (!luogo) return null;
    return {
      id: luogo.id, nome: luogo.nome, indirizzo: luogo.indirizzo || '',
      lat: luogo.lat, lon: luogo.lon, zona: luogo.zona, tipo: luogo.tipo,
      genere: luogo.genere || '', categoria: luogo.categoria || ''
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
  /* ------------------------------------------------------------------ *
   * Rendering: tab Viaggio
   * ------------------------------------------------------------------ */
  function aggiornaTestata() {
    const p = sel.partenza;
    const d = sel.destinazione;
    let titolo = 'Pianifica il tuo viaggio';
    let sotto = '';
    if (p && !d) {
      titolo = 'Dove vuoi andare?';
      sotto = 'Partenza da ' + nomeBreve(p.nome);
    } else if (p && d) {
      titolo = nomeBreve(p.nome) + ' → ' + nomeBreve(d.nome);
      const zp = eIndirizzo(p) ? etichettaGenere(p) : 'Zona ' + p.zona;
      const zd = eIndirizzo(d) ? etichettaGenere(d) : 'Zona ' + d.zona;
      // Il prezzo sta anche qui, sotto il titolo: l'intestazione resta visibile
      // in ogni scheda e anche a pannello ridotto, quindi il costo non va cercato
      // scorrendo fino in fondo al viaggio.
      const tariffa = trattaAPiedi() ? null : tariffaCorrente();
      // Stessa zona: "Zona 500 → Zona 500" era solo rumore. Il prezzo sta
      // davanti alle zone così, se la riga si accorcia, non viene tagliato lui.
      const zone = zp === zd ? zp : zp + ' → ' + zd;
      const prezzo = tariffa && tariffa.prezzo != null
        ? (tariffa.prezzo === 0 ? 'Incluso' : euro(tariffa.prezzo))
        : '';
      sotto = prezzo ? prezzo + ' · ' + zone : zone;
    }
    $('sheet-titolo').textContent = titolo;
    $('sheet-sotto').textContent = sotto;
    document.title = p && d ? titolo + ' · Muovi Bologna' : 'Muovi Bologna';
  }

  function htmlBiglietto(r) {
    const prezzo = r.prezzo === null ? '—' : (r.prezzo === 0 ? 'Incluso' : euro(r.prezzo));
    const nota = r.prezzo === 0 ? 'Nessun costo aggiuntivo' : r.prezzoNota;
    return '<div class="biglietto"><div class="biglietto-testo">' +
      '<span class="pill-stato ' + r.badge + '">' + esc(r.titolo) + '</span>' +
      '<span class="biglietto-nota">' + esc(nota) + '</span></div>' +
      '<span class="biglietto-prezzo">' + esc(prezzo) + '</span></div>';
  }

  // Sotto i 400 m il pianificatore usa solo il cammino: non serve un biglietto
  // e non ha senso proporre gli orari in tempo reale.
  function trattaAPiedi() {
    return !!(sel.partenza && sel.destinazione &&
      sel.partenza.lat != null && sel.partenza.lon != null &&
      sel.destinazione.lat != null && sel.destinazione.lon != null &&
      distanzaMetri(sel.partenza, sel.destinazione) < 400);
  }

  // Il prezzo dipende dal mezzo: se l'itinerario usa un treno vale la tariffa
  // regionale a km, altrimenti quella a zone. Prima del calcolo si guarda il
  // tipo delle fermate scelte.
  function trenoNellItinerario() {
    const scelta = (routing.opzioni && routing.opzioni.length)
      ? (routing.opzioni[routing.aperto >= 0 ? routing.aperto : 0] || routing.esito)
      : routing.esito;
    if (scelta && Array.isArray(scelta.tappe) && scelta.tappe.length) {
      const tappaTreno = scelta.tappe.filter((tappa) => tappa.tipo === 1 || tappa.tipo === 2)[0];
      return tappaTreno ? { treno: true, fer: !!tappaTreno.fer } : { treno: false, fer: false };
    }
    const fermate = [sel.partenza, sel.destinazione].filter(Boolean);
    return { treno: fermate.some((f) => f.tipo === 'treno'), fer: false };
  }

  function tariffaCorrente() {
    if (!sel.partenza || !sel.destinazione) return null;
    return Tariffe.calcola(sel.partenza, sel.destinazione, abbonamento, trenoNellItinerario());
  }

  function firmaBiglietto(r) {
    return r ? [r.badge, r.titolo, r.prezzo, r.prezzoNota, r.avviso || ''].join('|') : '';
  }

  function htmlRisultato(r) {
    const soloPiedi = trattaAPiedi();
    // Prima il costo, poi il viaggio: la scheda biglietto stava sotto tutte le
    // opzioni e per vederla bisognava scorrere il pannello fino in fondo.
    let html = (soloPiedi ? '' :
      '<div class="blocco-biglietto" data-firma="' + esc(firmaBiglietto(r)) + '">' +
      htmlBiglietto(r) + htmlInterruttore() + '</div>') +
      '<div id="blocco-percorso" class="blocco-percorso"></div>';
    if (r.avviso) {
      html += '<div class="avviso">' + ICONA_INFO + '<span>' + esc(r.avviso) + '</span></div>';
    }
    html += '<div class="azioni">' +
      (soloPiedi ? '' : '<button class="btn btn-primario" data-azione="live">Orari in tempo reale</button>') +
      '</div>';
    html += '<a class="link-ufficiale" href="' + URL_UFFICIALE + '" target="_blank" rel="noopener">Verifica su tper.it</a>';
    return html;
  }

  function htmlListaFermate(titolo, elenco, ruolo) {
    if (!elenco.length) return '';
    return '<h2 class="sezione-titolo">' + esc(titolo) + '</h2>' +
      elenco.map((f) => voceHTML(f, ruolo)).join('');
  }

  function htmlInterruttore() {
    return '<div class="riga-interruttore"><div><span class="etichetta">Ho l\'abbonamento urbano</span>' +
      '<span class="sotto">Zona 500 e zone neutre</span></div>' +
      '<label class="interruttore"><input type="checkbox" id="check-abbonamento"' + (abbonamento ? ' checked' : '') + ' aria-label="Ho l\'abbonamento urbano"><span class="binario"></span></label></div>';
  }

  // Unico punto in cui il tab Viaggio viene montato: evita di ripetere il
  // binding dell'interruttore abbonamento in ogni percorso di rendering.
  function collegaInterruttore() {
    const check = $('check-abbonamento');
    if (!check) return;
    check.addEventListener('change', () => {
      abbonamento = check.checked;
      renderViaggio();
    });
  }

  function montaPannelloViaggio(html) {
    $('pane-viaggio').innerHTML = html;
    collegaInterruttore();
  }

  // Il prezzo viene rifatto quando il percorso è pronto: solo allora si sa se
  // il viaggio usa un treno (tariffa a km) o qualche bus (tariffa a zone).
  function aggiornaCardBiglietto() {
    const card = document.querySelector('.blocco-biglietto');
    if (!card || trattaAPiedi()) return;
    const r = tariffaCorrente();
    if (!r) return;
    const firma = firmaBiglietto(r);
    if (card.dataset.firma === firma) return;
    card.dataset.firma = firma;
    card.innerHTML = htmlBiglietto(r) + htmlInterruttore();
    collegaInterruttore();
    aggiornaTestata();
  }

  function renderViaggio() {
    const risultato = tariffaCorrente();
    aggiornaTestata();
    aggiornaChipAbbonamento();

    if (risultato) {
      montaPannelloViaggio(htmlRisultato(risultato));
      disegnaPercorso();
      calcolaPercorso();
      return;
    }

    let html = '<p class="testo-intro">' +
      (sel.partenza ? 'Scegli la destinazione.' : 'Cerca una fermata o tocca la mappa.') +
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

  // Firma del percorso: solo la sequenza delle linee. Due varianti che
  // differiscono soltanto per dove si cammina non sono alternative.
  function firmaPercorso(e) {
    return e.tappe.map((tappa) => tappa.linea).join('>');
  }

  /**
   * Alternative da mostrare: una per percorso, ordinate per arrivo reale a
   * destinazione. In modalità "arriva entro" vince chi arriva più tardi ma in
   * tempo, perché con una scadenza è quello che serve.
   */
  function selezionaEsiti(esiti, arrivo) {
    const perPercorso = new Map();
    esiti.forEach((esito) => {
      const chiave = firmaPercorso(esito);
      const prima = perPercorso.get(chiave);
      if (!prima) { perPercorso.set(chiave, esito); return; }
      let migliore;
      if (esito.arrivoDestinazione !== prima.arrivoDestinazione) {
        migliore = arrivo
          ? esito.arrivoDestinazione > prima.arrivoDestinazione
          : esito.arrivoDestinazione < prima.arrivoDestinazione;
      } else {
        // Stesso arrivo: meglio uscire più tardi, si aspetta meno alla fermata.
        migliore = esito.partenza > prima.partenza;
      }
      if (migliore) perPercorso.set(chiave, esito);
    });
    const scelti = Array.from(perPercorso.values());
    scelti.sort((x, y) => (arrivo
      ? y.arrivoDestinazione - x.arrivoDestinazione
      : x.arrivoDestinazione - y.arrivoDestinazione));
    return scelti.slice(0, 4);
  }

  // Il motore restituisce il viaggio che arriva prima a una data ora. Per avere
  // alternative come su Google Maps non basta spostare la partenza di qualche
  // minuto (uscivano quattro varianti della stessa linea): si ricalcola
  // vietando a turno la linea principale, così compare un'altra strada.
  function calcolaOpzioni(da, a, base) {
    const arrivo = routing.modo === 'arrivo';
    // La scadenza si confronta come istante assoluto: dopo mezzanotte i
    // secondi del giorno ripartono da zero, mentre le corse serali hanno
    // orari oltre 86400 (es. 00:39 = 88740).
    const limite = arrivo ? base.getTime() : null;
    routing.scadenza = arrivo ? secondiDelGiorno(base) : null;
    const esiti = [];
    let errore = null;

    function calcola(quando, vietate) {
      return TPERRouting.calcola(da, a, quando, {
        maxCambi: 3,
        vietate: vietate || [],
        camminoMax: camminata * 60
      });
    }

    function aggiungi(esito, quando) {
      if (!esito) return;
      if (esito.errore) { errore = errore || esito; return; }
      // Arrivo reale a destinazione: quello del bus più il tratto a piedi
      // finale (una stazione o un indirizzo non sono la fermata del bus).
      const arrivoDestinazione = quando.getTime() +
        (esito.arrivo - esito.richiesta) * 1000 +
        (esito.camminoFinale || 0) * 1000;
      if (arrivo && arrivoDestinazione > limite) return;
      esito.margine = arrivo ? Math.round((limite - arrivoDestinazione) / 1000) : null;
      esito.arrivoDestinazione = arrivoDestinazione;
      esito.quandoRichiesta = quando;
      esiti.push(esito);
    }

    // In modalità arrivo si arretra dalla scadenza; altrimenti si parte
    // dall'ora scelta e si guarda anche un paio di corse dopo.
    const scarti = arrivo ? [0, 10, 20, 40, 60, 90, 120, 180] : [0, 15, 35];
    scarti.forEach((scarto) => {
      const quando = new Date(base.getTime() + (arrivo ? -scarto : scarto) * 60000);
      aggiungi(calcola(quando, []), quando);
    });

    let migliore = null;
    esiti.forEach((esito) => {
      if (!migliore || esito.arrivoDestinazione < migliore.arrivoDestinazione) migliore = esito;
    });
    if (migliore) {
      // Si vietano al massimo due linee: sufficiente per un'alternativa vera
      // senza moltiplicare le chiamate al motore.
      const linee = [];
      migliore.tappe.forEach((tappa) => {
        if (linee.length < 2 && linee.indexOf(tappa.linea) === -1) linee.push(tappa.linea);
      });
      linee.forEach((linea) => {
        aggiungi(calcola(migliore.quandoRichiesta, [linea]), migliore.quandoRichiesta);
      });
    }

    // Le combinazioni treno + bus non sono per forza le più veloci: si provano
    // anche le coppie singole di fermate vicine, ma solo se c'è una stazione.
    const conTreno = da.concat(a).some((fermata) => fermata.tipo === 'treno' || fermata.tipo === 'entrambi');
    if (conTreno) {
      const quando = migliore ? migliore.quandoRichiesta : base;
      da.forEach((origine) => {
        a.forEach((destinazione) => {
          if (origine.id === destinazione.id) return;
          aggiungi(TPERRouting.calcola([origine], [destinazione], quando, {
            maxCambi: 3,
            camminoMax: camminata * 60
          }), quando);
        });
      });
    }

    return { esiti: selezionaEsiti(esiti, arrivo), errore: errore };
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
    if (disponibili.has(fermata.id)) elenco.push({ id: fermata.id, cammino: 0, tipo: fermata.tipo });
    if (fermata.lat == null || fermata.lon == null) return elenco;
    // Le stazioni ferroviarie non devono sparire solo perché ci sono cinque
    // paline bus più vicine: senza di loro non può nascere nessuna
    // combinazione bus + treno.
    const vicini = fermateVicine(fermata.lat, fermata.lon, 40, fermata.id)
      .filter((vicina) => disponibili.has(vicina.id))
      .map((vicina) => ({ fermata: vicina, distanza: distanzaMetri(fermata, vicina) }))
      .filter((voce) => voce.distanza <= raggioCamminata())
      .sort((a, b) => {
        const trenoA = a.fermata.tipo === 'treno' || a.fermata.tipo === 'entrambi' ? 0 : 1;
        const trenoB = b.fermata.tipo === 'treno' || b.fermata.tipo === 'entrambi' ? 0 : 1;
        return trenoA - trenoB || a.distanza - b.distanza;
      });
    vicini.forEach((voce) => {
      if (elenco.length >= 5) return;
      elenco.push({
        id: voce.fermata.id,
        cammino: Math.round(voce.distanza * 1.15),
        tipo: voce.fermata.tipo
      });
    });
    return elenco;
  }

  // Cambio a piedi tra fermate vicine: le paline opposte stanno a 50–150 m, ma
  // se l'utente è disposto a camminare si può cambiare anche tra fermate più
  // lontane (fino al raggio scelto). Oltre 12 fermate per fermata non serve.
  const CAMMINO_CAMBIO = 150;   // metri minimi garantiti
  const CAMMINI_PER_FERMATA = 12;
  let camminiRaggio = 0;

  function preparaCammini(forza) {
    if (typeof TPERRouting === 'undefined' || !TPERRouting.impostaCammini) return;
    if (fermate.length < 100) return;   // elenco ridotto offline: si riproverà
    const raggio = Math.max(CAMMINO_CAMBIO, raggioCamminata());
    if (!forza && camminiRaggio === raggio) return;
    camminiRaggio = raggio;
    const coppie = [];
    const viste = new Set();
    const albero = alberoFermate(fermate.filter((f) => f.lat != null && f.lon != null));
    fermate.forEach((f) => {
      if (f.lat == null || f.lon == null) return;
      const vicine = [];
      piuVicine(albero, f, raggio, vicine, CAMMINI_PER_FERMATA);
      vicine.sort((a, b) => a.metri - b.metri);
      vicine.slice(0, CAMMINI_PER_FERMATA).forEach((voce) => {
        const chiave = f.id < voce.id ? f.id + '|' + voce.id : voce.id + '|' + f.id;
        if (viste.has(chiave)) return;
        viste.add(chiave);
        // Distanza pedonale stimata: la strada è ~15% più lunga della linea d'aria.
        coppie.push([f.id, voce.id, Math.round((voce.metri * 1.15) / PASSO_METRI_SECONDO)]);
      });
    });
    TPERRouting.impostaCammini(coppie);
  }

  // Indice spaziale minimale (k-d tree) sulle fermate: senza, con 25 minuti di
  // cammino ogni fermata andava confrontata con tutte quelle nel raggio e il
  // ricalcolo durava secondi. Qui si visitano solo i rami che possono contenere
  // fermate entro il raggio.
  function alberoFermate(elenco) {
    function costruisci(punti, profondita) {
      if (!punti.length) return null;
      const asse = profondita % 2 === 0 ? 'lat' : 'lon';
      punti.sort((a, b) => a[asse] - b[asse]);
      const mezzo = punti.length >> 1;
      return {
        punto: punti[mezzo],
        asse: asse,
        sinistra: costruisci(punti.slice(0, mezzo), profondita + 1),
        destra: costruisci(punti.slice(mezzo + 1), profondita + 1)
      };
    }
    return costruisci(elenco.slice(), 0);
  }

  function piuVicine(nodo, f, raggio, migliore, quante) {
    if (!nodo) return;
    const d = distanzaMetri(f, nodo.punto);
    if (d > 0 && d <= raggio) {
      migliore.push({ id: nodo.punto.id, metri: d });
      if (migliore.length > quante * 2) {
        migliore.sort((a, b) => a.metri - b.metri);
        migliore.length = quante;
      }
    }
    const delta = nodo.asse === 'lat' ? f.lat - nodo.punto.lat : f.lon - nodo.punto.lon;
    const verso = delta < 0 ? nodo.sinistra : nodo.destra;
    const opposto = delta < 0 ? nodo.destra : nodo.sinistra;
    piuVicine(verso, f, raggio, migliore, quante);
    // 1 grado di latitudine vale ~111 km: sotto questa soglia anche l'altro
    // ramo può avere fermate utili.
    if (Math.abs(delta) * 111000 <= raggio) piuVicine(opposto, f, raggio, migliore, quante);
  }

  function disegnaPercorso() {
    const blocco = $('blocco-percorso');
    if (!blocco) return;
    assicuraQuando();
    // La scheda legge da qui quanti minuti a piedi sono concessi.
    routing.camminata = camminata;
    blocco.innerHTML = VistaPercorso.controlli(routing.giorno, routing.orario, routing.modo, camminata) +
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
    // Quanto si è disposti a camminare: si salva e si ricalcola il viaggio.
    const inputCamminata = $('input-camminata');
    if (inputCamminata) {
      const valore = $('valore-camminata');
      inputCamminata.addEventListener('input', () => {
        if (valore) valore.textContent = inputCamminata.value + ' min';
      });
      inputCamminata.addEventListener('change', () => {
        if (!inputCamminata.isConnected) return;
        const scelto = parseInt(inputCamminata.value, 10);
        camminata = Math.min(CAMMINATA_MAX, Math.max(CAMMINATA_MIN, isFinite(scelto) ? scelto : CAMMINATA_DEFAULT));
        scrivi(K_CAMMINATA, String(camminata));
        // Il raggio dei cambi a piedi cambia con la soglia: si ricostruisce.
        preparaCammini(true);
        routing.chiave = null;
        calcolaPercorso();
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
          aggiornaCardBiglietto();
        }
      });
    });
    if (routing.aperto >= 0 && dettagli[routing.aperto] && !dettagli[routing.aperto].open) {
      dettagli[routing.aperto].open = true;
    }
    caricaLivePercorso();
    avviaTimerPercorso();
    disegnaTracciato();
    aggiornaCardBiglietto();
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
      routing.piedi = {
        metri: Math.round(distanza),
        minuti: minuti(distanza * 1.3 / 1.2),
        chiave: Piedi.chiave(
          [sel.partenza.lon, sel.partenza.lat],
          [sel.destinazione.lon, sel.destinazione.lat]
        )
      };
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
   * Tempo reale dentro la scheda percorso
   * Il primo bus dell'itinerario viene chiesto a HelloBus: così la scheda
   * mostra il passaggio reale invece del solo orario programmato. Per i treni
   * non esiste un feed aperto e resta l'orario del dataset.
   * ------------------------------------------------------------------ */
  const livePercorso = {
    chiave: null, ts: 0, stato: 'idle', corsa: null, ritardo: 0,
    caricamento: false, errore: null
  };
  let livePercorsoAbort = null;
  let timerPercorso = null;

  function primaCorsaPercorso() {
    if (routing.stato !== 'ok' || !routing.esito) return null;
    const tappe = routing.esito.tappe || [];
    return tappe.length ? tappe[0] : null;
  }

  function hhmmDaSecondi(secondi) {
    const s = ((Math.round(secondi) % 86400) + 86400) % 86400;
    return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
      String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  }

  /** Distanza in secondi tra un orario del giorno e adesso, in -43200..43200. */
  function minutiDaAdesso(secondi) {
    const ora = new Date();
    const adesso = ora.getHours() * 3600 + ora.getMinutes() * 60 + ora.getSeconds();
    return ((secondi - adesso + 43200 + 86400) % 86400) - 43200;
  }

  function disegnaLivePercorso() {
    const contenitore = $('live-percorso');
    if (!contenitore) return;
    const tappa = primaCorsaPercorso();
    if (!tappa) {
      contenitore.hidden = true;
      contenitore.innerHTML = '';
      return;
    }
    const treno = tappa.tipo === 1 || tappa.tipo === 2;
    const corsa = livePercorso.corsa;
    const linea = esc(tappa.linea);
    const programmato = hhmmDaSecondi(tappa.partenza);
    let html;
    if (treno) {
      html = '<span class="tag-orario">ORARIO</span><span>Treno <b>' + linea + '</b> alle <b>' + programmato +
        '</b>.</span>';
    } else if (livePercorso.caricamento) {
      html = '<span class="punto-live off"></span><span>Controllo se il bus <b>' + linea +
        '</b> è in orario…</span>';
    } else if (livePercorso.stato === 'ok' && corsa) {
      const minutiAttesa = minutiA(corsa.ora);
      const quando = minutiAttesa <= 0 ? 'in arrivo' : 'tra ' + minutiAttesa + ' min';
      const scarto = Math.round(livePercorso.ritardo / 60);
      const vivo = corsa.tipo === 'live';
      html = '<span class="' + (vivo ? 'tag-live' : 'tag-orario') + '">' + (vivo ? 'LIVE' : 'ORARIO') + '</span>' +
        '<span>Bus <b>' + linea + '</b> · <b>' + quando + '</b> · ore ' + esc(corsa.ora) +
        (vivo && Math.abs(scarto) >= 2
          ? ' · ' + (scarto > 0 ? scarto + ' min di ritardo' : Math.abs(scarto) + ' min di anticipo')
          : '') +
        (vivo ? '' : ' · orario programmato') + '</span>';
    } else if (livePercorso.stato === 'errore') {
      html = '<span class="tag-orario">ORARIO</span><span>Bus <b>' + linea + '</b> alle <b>' + programmato +
        '</b> · tempo reale non raggiungibile.</span>';
    } else {
      html = '<span class="tag-orario">ORARIO</span><span>Bus <b>' + linea + '</b> alle <b>' + programmato +
        '</b> · orario programmato.</span>';
    }
    contenitore.innerHTML = html;
    contenitore.hidden = false;
  }

  async function caricaLivePercorso(forza) {
    const tappa = primaCorsaPercorso();
    if (!tappa) {
      if (livePercorsoAbort) livePercorsoAbort.abort();
      livePercorso.stato = 'idle';
      livePercorso.corsa = null;
      livePercorso.chiave = null;
      disegnaLivePercorso();
      return;
    }
    if (tappa.tipo === 1 || tappa.tipo === 2) {
      if (livePercorsoAbort) livePercorsoAbort.abort();
      livePercorso.stato = 'treno';
      livePercorso.corsa = null;
      livePercorso.chiave = null;
      disegnaLivePercorso();
      return;
    }
    const chiave = [tappa.da, tappa.linea, tappa.partenza].join('|');
    if (!forza && livePercorso.chiave === chiave && livePercorso.stato === 'ok' &&
      Date.now() - livePercorso.ts < 60000) {
      disegnaLivePercorso();
      return;
    }
    if (livePercorsoAbort) livePercorsoAbort.abort();
    livePercorsoAbort = new AbortController();
    const segnale = livePercorsoAbort.signal;
    livePercorso.chiave = chiave;
    livePercorso.caricamento = true;
    livePercorso.stato = 'caricamento';
    disegnaLivePercorso();
    try {
      const testo = await queryHellobus(tappa.da, tappa.linea, segnale);
      if (segnale.aborted) return;
      const tutti = parseHellobus(testo);
      const lineaCorsa = String(tappa.linea).toUpperCase();
      const dellaLinea = tutti.filter((arrivo) => arrivo.linea === lineaCorsa);
      const candidati = dellaLinea.length ? dellaLinea : tutti;
      const pianificato = minutiDaAdesso(tappa.partenza);
      let migliore = null;
      let scarto = Infinity;
      candidati.forEach((arrivo) => {
        const delta = minutiA(arrivo.ora) * 60 - pianificato;
        // Oltre 12 minuti di scarto è un'altra corsa: mostrarla come "la
        // nostra" produceva avvisi tipo "24 min di anticipo" su un bus che
        // non è quello dell'itinerario (capitava con "arriva entro").
        if (Math.abs(delta) > 12 * 60) return;
        if (Math.abs(delta) < Math.abs(scarto)) {
          migliore = arrivo;
          scarto = delta;
        }
      });
      livePercorso.corsa = migliore;
      livePercorso.ritardo = migliore ? scarto : 0;
      livePercorso.stato = migliore ? 'ok' : 'nessuna-corsa';
      livePercorso.errore = null;
      livePercorso.ts = Date.now();
    } catch (errore) {
      if (segnale.aborted) return;
      livePercorso.stato = 'errore';
      livePercorso.errore = errore;
      livePercorso.corsa = null;
    }
    livePercorso.caricamento = false;
    disegnaLivePercorso();
  }

  function avviaTimerPercorso() {
    if (timerPercorso) return;
    timerPercorso = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (tabAttivo !== 'viaggio') return;
      if (!primaCorsaPercorso()) return;
      caricaLivePercorso(true);
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

  // Il dataset lega le linee al codice palina: alcuni nodi "hub" (la Stazione
  // Centrale 500135, per esempio) non ne hanno, ma il palo accanto nella stessa
  // fermata sì. Senza questo ripiego il tempo reale restava vuoto proprio alle
  // fermate più importanti, con un messaggio che sembrava un guasto dell'app.
  const PALINA_VICINA_MAX = 220;   // metri

  function palinaConLinee(fermata) {
    if (!fermata) return null;
    if (lineeDaInterrogare(fermata).length) return fermata;
    if (fermata.lat == null || fermata.lon == null) return null;
    const candidate = fermateVicine(fermata.lat, fermata.lon, 12, fermata.id)
      .filter((f) => lineeDaInterrogare(f).length);
    for (let i = 0; i < candidate.length; i += 1) {
      const d = distanzaMetri(fermata, candidate[i]);
      if (d <= PALINA_VICINA_MAX) return Object.assign({}, candidate[i], { distacco: Math.round(d) });
    }
    return null;
  }

  async function caricaLive(forza) {
    const fermata = fermataLive();
    if (!fermata) {
      live.stato = 'nessuna-fermata';
      live.avviso = '';
      renderLive();
      return;
    }
    const palina = palinaConLinee(fermata);
    // Fermata e palina coincidono quasi sempre; quando non succede va detto,
    // altrimenti sembra che l'app mostri i bus sbagliati.
    live.avviso = palina && palina.id !== fermata.id
      ? 'La palina ' + (fermata.palina || fermata.id) + ' non ha linee bus nel dataset: uso la fermata più vicina (' + palina.nome + ', ' + palina.distacco + ' m).'
      : '';
    if (!palina) {
      live.stato = 'senza-linee';
      live.items = [];
      renderLive();
      return;
    }
    if (!forza) {
      const cache = leggiJSON('tperzc_live_' + palina.id);
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

    const linee = lineeDaInterrogare(palina);
    const raccolti = [];
    let risposteOk = 0;
    let nonGestite = 0;
    // Un relay lento non deve lasciare il pannello su "Cerco i passaggi…" per
    // sempre: prima si aspettava la risposta più lenta di tutte, senza scadenza.
    const scadenzaTotale = new Promise((risolvi) => {
      setTimeout(() => risolvi(null), 15000);
    });
    const risposte = await Promise.race([Promise.all(linee.map(async (linea) => {
      try {
        return await queryHellobus(palina.id, linea, segnale);
      } catch (errore) {
        return null;
      }
    })), scadenzaTotale]);
    if (segnale.aborted) {
      // Se ad abortire è stata una richiesta più recente, quella si occupa
      // dello stato; altrimenti lo spinner resterebbe acceso per sempre.
      if (liveAbort && liveAbort.signal === segnale) {
        live.caricamento = false;
        renderLive();
      }
      return;
    }
    if (!risposte) {
      if (liveAbort) liveAbort.abort();
      live.caricamento = false;
      live.stato = 'errore';
      live.errore = 'Il servizio HelloBus non ha risposto in tempo.';
      renderLive();
      return;
    }
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
    scrivi('tperzc_live_' + palina.id, JSON.stringify({ ts: live.ts, items: live.items }));
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
        (arrivo.pedana ? '<span class="icona-pedana" title="Accessibile in carrozzina">' + ICONA_ACCESSIBILITA + '</span>' : '') +
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
      live.avviso = '';
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
      '</div>' +
      '<button class="btn-aggiorna' + (live.caricamento ? ' gira' : '') + '" data-azione="aggiorna" aria-label="Aggiorna gli arrivi"' + (fermata ? '' : ' disabled') + '>' + ICONA_REFRESH + '</button>' +
      '</div>';
    if (live.avviso) html += '<div class="box-messaggio">' + esc(live.avviso) + '</div>';

    if (!fermata) {
      html += '<div class="box-messaggio">Scegli una fermata per vedere i prossimi passaggi.</div>';
    } else if (live.stato === 'senza-linee') {
      html += '<div class="box-messaggio">Tempo reale solo per i bus: qui non passano linee bus.</div>';
    } else if (live.stato === 'non-gestita') {
      html += '<div class="box-messaggio">HelloBus non gestisce questa fermata. Prova il palo opposto o tper.it.</div>';
    } else {
      html += statoLiveHTML();
      if (live.stato === 'errore' && !live.items.length) {
        html += '<div class="box-messaggio errore">HelloBus non risponde. Controlla la connessione e riprova.</div>' +
          '<button class="btn btn-secondario" data-azione="aggiorna">Riprova</button>';
      } else if (!live.items.length && !live.caricamento) {
        const altroRuolo = stopLiveRuolo === 'partenza' ? 'destinazione' : 'partenza';
        const altro = sel[altroRuolo];
        html += '<div class="box-messaggio">Nessun altro passaggio oggi.' +
          (altro ? ' <button class="btn btn-secondario" data-live-ruolo="' + altroRuolo + '">Bus alla ' + altroRuolo + '</button>' : '') +
          '</div>';
      } else {
        html += arriviHTML();
      }
      html += '<p class="nota-piccola">LIVE = posizione reale del bus. ORARIO = orario programmato.</p>';
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
    // La posizione ridotta mostra testata, tab e riga data/ora: si misura
    // quanto occupano davvero, così un titolo su due righe non la taglia.
    // Nei tab Live/Info il blocco data/ora è nascosto (rect 0): senza il
    // controllo su height il pannello finiva fuori dallo schermo.
    const quando = document.querySelector('.quando');
    const rect = quando ? quando.getBoundingClientRect() : null;
    const distanza = rect && rect.height > 0
      ? rect.bottom - sheet.getBoundingClientRect().top : 0;
    const peek = Math.min(distanza > 0 ? altezza - distanza - 12 : altezza - 190, altezza - 96);
    if (stato === 'peek') return Math.max(0, Math.round(peek));
    // Metà pannello, ma sempre almeno 90 px sopra il punto ridotto: con i due
    // punti quasi coincidenti (schermi bassi) il gesto sembrava non fare nulla.
    const meta = Math.min(Math.round(altezza * 0.46), Math.round(peek) - 90);
    return Math.max(0, meta);
  }

  // Posizione del pannello in un unico posto: il dito riparte sempre da dove
  // il pannello è davvero, non dallo stato "già impostato" mentre l'animazione
  // precedente è ancora in corso (era il salto a inizio gesto).
  let traslazionePannello = 0;
  let framePannello = null;

  function aggiornaFisicaPannello() {
    const visibile = altezzaVisibile();
    const fab = document.querySelector('.col-fab');
    if (fab) fab.classList.toggle('nascosto', traslazionePannello <= 8 || visibile > window.innerHeight * 0.6);
    aggiornaScrim();
  }

  function applicaTrasformazione(pixel, animato, silenzioso) {
    const sheet = $('sheet');
    traslazionePannello = Math.max(0, Math.round(pixel));
    sheet.style.transition = animato ? 'transform .34s cubic-bezier(.22,.9,.28,1)' : 'none';
    sheet.style.transform = 'translate(-50%,' + traslazionePannello + 'px)';
    // Durante il dito si aggiorna al massimo una volta per frame: le letture di
    // layout a ogni pointermove erano la causa degli scatti.
    if (silenzioso) {
      if (framePannello) return;
      framePannello = requestAnimationFrame(() => {
        framePannello = null;
        aggiornaFisicaPannello();
      });
      return;
    }
    aggiornaFisicaPannello();
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
    if (Math.abs((sheet.offsetHeight || 0) - altezza) <= 1) return;
    sheet.style.height = altezza + 'px';
    // Cambiando altezza cambiano anche i punti di aggancio: senza questo il
    // pannello restava a metà (succedeva dopo il caricamento dei font) e il
    // primo gesto faceva uno scatto per tornare al punto giusto.
    if (!trascinando) applicaTrasformazione(traslazionePer(statoSheet), false);
  }

  function impostaSheet(stato) {
    const cambiato = stato !== statoSheet;
    statoSheet = stato;
    adattaAltezzaSheet();
    applicaTrasformazione(traslazionePer(stato), true);
    // Lo spazio visibile cambia con il pannello: il percorso si reinquadra, ma
    // solo quando il pannello si muove davvero (prima anche un semplice resize
    // o un richiamo identico spostavano la mappa).
    if (cambiato && routing.stato === 'ok') setTimeout(() => inquadraPercorso(400), 340);
  }

  function cicloSheet() {
    if (sopprimiClick) return;
    if (statoSheet === 'peek') impostaSheet('meta');
    else if (statoSheet === 'meta') impostaSheet('piena');
    else impostaSheet('meta');
  }

  function traslazioneAttuale() {
    const matrice = new DOMMatrixReadOnly(getComputedStyle($('sheet')).transform);
    return isFinite(matrice.m42) ? Math.max(0, matrice.m42) : traslazionePannello;
  }

  // Punti di aggancio reali, non una stima: così lo snap non salta quando la
  // posizione ridotta dipende dall'altezza della riga data/ora.
  function puntiSheet() {
    return [
      { stato: 'piena', valore: traslazionePer('piena') },
      { stato: 'meta', valore: traslazionePer('meta') },
      { stato: 'peek', valore: traslazionePer('peek') }
    ].sort((a, b) => a.valore - b.valore);
  }

  const SNAP_INERZIA = 160;   // ms di proiezione della velocità del gesto
  const SNAP_COLPO = 0.35;    // px/ms: oltre, il gesto sceglie la direzione

  function concludiTrascinamento(velocita) {
    const sheet = $('sheet');
    trascinando = false;
    sheet.classList.remove('trascinando');
    const attuale = traslazioneAttuale();
    const punti = puntiSheet();
    const minimo = punti[0].valore;
    const massimo = punti[punti.length - 1].valore;
    const v = Math.max(-3, Math.min(3, isFinite(velocita) ? velocita : 0));
    // Dove finirebbe il pannello lasciandolo andare con la sua inerzia: la
    // velocità conta più della distanza già percorsa, come in un carrello.
    const proiezione = Math.max(minimo, Math.min(massimo, attuale + v * SNAP_INERZIA));
    // Un colpo deciso deve cambiare stato anche se il pannello è più vicino
    // all'altro punto: si sceglie solo tra i punti nella direzione del gesto.
    let candidati = punti;
    if (v > SNAP_COLPO) candidati = punti.filter((p) => p.valore > attuale + 4);
    else if (v < -SNAP_COLPO) candidati = punti.filter((p) => p.valore < attuale - 4);
    if (!candidati.length) candidati = punti;
    const scelto = candidati.reduce((migliore, p) =>
      Math.abs(p.valore - proiezione) < Math.abs(migliore.valore - proiezione) ? p : migliore, candidati[0]);
    sopprimiClick = true;
    setTimeout(() => { sopprimiClick = false; }, 350);
    impostaSheet(scelto.stato);
  }

  function abilitaTrascinamento(elemento) {
    let idPuntatore = null;
    let inizioY = 0;
    let inizioX = 0;
    let iniziale = 0;
    let massimo = 0;
    let ultimoY = 0;
    let ultimoT = 0;
    let velocita = 0;
    let attivo = false;
    const sheet = $('sheet');

    const muovi = (evento) => {
      if (evento.pointerId !== idPuntatore) return;
      const dy = evento.clientY - inizioY;
      if (!attivo) {
        if (Math.abs(dy) < 3) return;
        if (Math.abs(evento.clientX - inizioX) > Math.abs(dy) * 1.5) return;
        attivo = true;
        trascinando = true;
        sheet.classList.add('trascinando');
        sheet.style.transition = 'none';
      }
      if (evento.cancelable) evento.preventDefault();
      const ora = performance.now();
      if (ora > ultimoT) velocita = (evento.clientY - ultimoY) / (ora - ultimoT);
      ultimoY = evento.clientY;
      ultimoT = ora;
      // Il pannello si ferma sul punto ridotto vero, non a "altezza - 120":
      // prima si poteva trascinarlo nel vuoto sotto il bordo dello schermo.
      let pixel = iniziale + dy;
      if (pixel < 0) pixel = 0;
      else if (pixel > massimo) pixel = massimo + Math.min(28, (pixel - massimo) * 0.3);
      applicaTrasformazione(pixel, false, true);
    };

    const fine = (evento) => {
      if (evento.pointerId !== idPuntatore) return;
      idPuntatore = null;
      elemento.removeEventListener('pointermove', muovi);
      elemento.removeEventListener('pointerup', fine);
      elemento.removeEventListener('pointercancel', fine);
      if (!attivo) {
        // Un semplice tocco non deve congelare il pannello a metà animazione:
        // si riporta al punto del suo stato.
        const target = traslazionePer(statoSheet);
        if (Math.abs(traslazioneAttuale() - target) > 1) applicaTrasformazione(target, true);
        return;
      }
      attivo = false;
      if (performance.now() - ultimoT > 140) velocita = 0;
      concludiTrascinamento(velocita);
    };

    elemento.addEventListener('pointerdown', (evento) => {
      if (idPuntatore !== null) return;
      if (evento.button !== undefined && evento.button !== 0) return;
      idPuntatore = evento.pointerId;
      inizioY = ultimoY = evento.clientY;
      inizioX = evento.clientX;
      // Fermare subito l'animazione in corso: così la posizione letta è quella
      // vera e il gesto non "salta" al primo movimento.
      sheet.style.transition = 'none';
      iniziale = traslazioneAttuale();
      traslazionePannello = iniziale;
      const punti = puntiSheet();
      massimo = punti[punti.length - 1].valore;
      ultimoT = performance.now();
      velocita = 0;
      attivo = false;
      try { elemento.setPointerCapture(evento.pointerId); } catch (errore) { /* mouse sintetico */ }
      elemento.addEventListener('pointermove', muovi);
      elemento.addEventListener('pointerup', fine);
      elemento.addEventListener('pointercancel', fine);
    });
  }

  // Trascinamento dalla parte scorrevole: in cima al contenuto il gesto apre
  // o chiude il pannello, altrimenti resta lo scroll nativo del browser.
  function abilitaScorrimentoSheet() {
    const corpo = $('sheet-corpo');
    const sheet = $('sheet');
    let inizioY = 0;
    let inizioX = 0;
    let iniziale = 0;
    let massimo = 0;
    let ultimoY = 0;
    let ultimoT = 0;
    let velocita = 0;
    let attivo = false;
    let decisione = 'attesa';   // 'attesa' | 'pannello' | 'browser'

    const rilascia = () => {
      if (!attivo) {
        // Tocco che non è diventato trascinamento (o gesto lasciato al
        // browser): il pannello torna al punto del suo stato se era a metà.
        if (decisione === 'attesa') {
          const target = traslazionePer(statoSheet);
          if (Math.abs(traslazioneAttuale() - target) > 1) applicaTrasformazione(target, true);
        }
        decisione = 'attesa';
        return;
      }
      attivo = false;
      decisione = 'attesa';
      if (performance.now() - ultimoT > 140) velocita = 0;
      concludiTrascinamento(velocita);
    };

    const muovi = (evento) => {
      if (evento.touches.length !== 1) { rilascia(); return; }
      if (decisione === 'browser') return;
      const tocco = evento.touches[0];
      const dy = tocco.clientY - inizioY;
      if (decisione === 'attesa') {
        if (Math.abs(dy) < 4) return;
        if (Math.abs(tocco.clientX - inizioX) > Math.abs(dy) * 0.9) {
          decisione = 'browser';
          return;
        }
        // La scelta si fa al primo movimento, non dopo una soglia: quando lo
        // scroll nativo è già partito il gesto non è più annullabile, ed era
        // il motivo per cui "scorrere dentro per aprire" funzionava a metà.
        const apre = dy < 0 && iniziale > 1;
        const chiude = dy > 0 && corpo.scrollTop <= 0 && iniziale < massimo - 1;
        if (!apre && !chiude) {
          decisione = 'browser';
          return;
        }
        decisione = 'pannello';
        attivo = true;
        trascinando = true;
        sheet.classList.add('trascinando');
        sheet.style.transition = 'none';
        iniziale = traslazioneAttuale();
      }
      if (evento.cancelable) evento.preventDefault();
      const ora = performance.now();
      if (ora > ultimoT) velocita = (tocco.clientY - ultimoY) / (ora - ultimoT);
      ultimoY = tocco.clientY;
      ultimoT = ora;
      let pixel = iniziale + dy;
      if (pixel < 0) pixel = 0;
      else if (pixel > massimo) pixel = massimo + Math.min(28, (pixel - massimo) * 0.3);
      applicaTrasformazione(pixel, false, true);
    };

    corpo.addEventListener('touchstart', (evento) => {
      if (trascinando || evento.touches.length !== 1) return;
      const tocco = evento.touches[0];
      inizioY = ultimoY = tocco.clientY;
      inizioX = tocco.clientX;
      iniziale = traslazioneAttuale();
      const punti = puntiSheet();
      massimo = punti[punti.length - 1].valore;
      ultimoT = performance.now();
      velocita = 0;
      attivo = false;
      decisione = 'attesa';
    }, { passive: true });
    corpo.addEventListener('touchmove', muovi, { passive: false });
    corpo.addEventListener('touchend', rilascia);
    corpo.addEventListener('touchcancel', rilascia);
  }

  /* ------------------------------------------------------------------ *
   * Tab Info
   * ------------------------------------------------------------------ */
  function renderInfo() {
    const pane = $('pane-info');
    if (pane.dataset.pronto === '1') return;
    pane.dataset.pronto = '1';
    pane.innerHTML =
      '<div class="scheda"><h2>Tempo reale</h2>' +
      '<p>Gli arrivi arrivano da HelloBus, il servizio TPER. LIVE = posizione reale del bus. ORARIO = orario programmato. Per i treni esiste solo l\'orario programmato.</p></div>' +
      '<div class="scheda"><h2>Dati</h2>' +
      '<p>Fermate, zone e linee: open data TPER / Regione Emilia-Romagna (CC BY 3.0 IT). Orari bus: GTFS TPER. Orari treni: GTFS Trenitalia (CC BY 4.0), conversione deryclem/trenitalia-gtfs. Percorsi a piedi: OSRM / OpenStreetMap.</p>' +
      '<p>Treni coperti: Bologna C.le, Imola, Bologna–Pianoro e la linea S2A Bologna–Vignola. La S1 Porretta non è inclusa: il PDF ufficiale non dà orari intermedi affidabili.</p>' +
      '<p>Fermate aggiornate al ' + esc(aggiornato || 'non disponibile') + '. Prezzi indicativi: verifica su tper.it.</p>' +
      '<a class="mini" href="https://www.tper.it" target="_blank" rel="noopener">Apri tper.it</a></div>' +
      '<div class="scheda"><h2>Relay orari</h2>' +
      '<p>HelloBus non accetta le chiamate del browser (CORS): l\'app passa da un relay pubblico. Puoi usarne uno tuo, con <code>{url}</code> al posto dell\'indirizzo. Vuoto = relay predefinito.</p>' +
      '<div class="campo-proxy"><input id="input-proxy" type="text" placeholder="https://mio-relay.example/?url={url}" value="' + esc(leggi(K_PROXY) || '') + '">' +
      '<button class="mini" data-azione="salva-proxy">Salva</button></div>' +
      '<button class="mini" data-azione="azzera-proxy">Usa il relay predefinito</button></div>' +
      '<div class="scheda"><h2>Installa</h2>' +
      '<p>Su schermata home si apre come un\'app e funziona offline per zone e prezzi.</p>' +
      '<button class="mini" data-azione="installa">Installa Muovi Bologna</button></div>' +
      '<p class="nota-piccola">App non ufficiale, non affiliata a TPER.</p>';
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
    // Con il permesso già negato il browser può non richiamare mai il callback
    // d'errore: il messaggio restava su "Cerco la tua posizione…" per sempre.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((stato) => {
        if (stato.state === 'denied') {
          mostraToast('Posizione bloccata: consenti l\'accesso dal browser');
        }
      }).catch(() => { /* Permissions API assente: vale il timeout */ });
    }
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

    $('nav-fondo').addEventListener('click', (evento) => {
      const pulsante = evento.target.closest('[data-azione]');
      if (!pulsante) return;
      const azione = pulsante.getAttribute('data-azione');
      if (azione === 'ferma-navigazione') fermaNavigazione();
      if (azione === 'centra-navigazione') centraNavigazione();
    });

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
          nome: indirizzo.getAttribute('data-nome') || 'Luogo',
          indirizzo: indirizzo.getAttribute('data-dettaglio') || '',
          lat: lat,
          lon: lon,
          zona: vicina ? vicina.zona : '500',
          tipo: 'indirizzo',
          genere: indirizzo.getAttribute('data-genere') || 'indirizzo',
          categoria: indirizzo.getAttribute('data-categoria') || 'Indirizzo'
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
    abilitaScorrimentoSheet();

    $('sheet-corpo').addEventListener('scroll', aggiornaScrim, { passive: true });

    $('sheet-corpo').addEventListener('click', (evento) => {
      if (sopprimiClick) {
        evento.preventDefault();
        evento.stopPropagation();
        sopprimiClick = false;
        return;
      }
      const pulsante = evento.target.closest('[data-azione]');
      if (pulsante) {
        const azione = pulsante.getAttribute('data-azione');
        if (azione === 'live') { attivaTab('live'); caricaLive(true); impostaSheet('piena'); }
        if (azione === 'inverti') { $('btn-scambia').click(); }
        if (azione === 'avvia-navigazione') { avviaNavigazione(); }
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
      // In navigazione la camera è dell'utente: niente reinquadrature del viaggio.
      if (navigazione.attiva) {
        if (mappa) mappa.resize();
        return;
      }
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
