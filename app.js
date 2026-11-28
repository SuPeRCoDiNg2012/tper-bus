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
  // Timeout per tipo di chiamata: i JSON grandi hanno più tempo, Nominatim ne
  // ha meno perché la ricerca deve restare reattiva mentre si scrive.
  const TIMEOUT_FETCH = 10000;
  const TIMEOUT_ORARI = 15000;
  const TIMEOUT_NOMINATIM = 5000;
  const TIMEOUT_OSRM = 8000;
  const K_FERMATE = 'tperzc_fermate_v2';
  const K_LINEE = 'tperzc_linee_v2';
  const K_COLORI = 'tperzc_colori_v1';
  const K_RECENTI = 'tperzc_recenti_v2';
  const K_TRATTA = 'tperzc_tratta_v2';
  const K_QUANDO = 'tperzc_quando_v1';
  const K_CAMMINATA = 'tperzc_camminata_v1';
  const K_ABBONAMENTO = 'tperzc_abbonamento_v1';
  const K_EVITATE = 'tperzc_linee_evitate_v1';
  const K_PROXY = 'tperzc_proxy';
  const K_RELAY = 'tperzc_relay';
  const K_ONBOARDING = 'tperzc_onboarding_visto_v1';
  const K_PREFERITI = 'tperzc_preferiti_v1';
  const K_AVVISI = 'tperzc_avvisi_v1';
  const K_INDIRIZZI = 'tperzc_indirizzi_v2';
  const K_RITARDI = 'tperzc_storico_ritardi_v2';
  const K_FISSE = 'tperzc_fermate_fisse_v1';
  const K_VIAGGI = 'tperzc_viaggi_salvati_v1';
  const K_ERRORI = 'tperzc_errori_v1';
  const K_TEMA = 'tperzc_tema_v1';
  const K_TESTO = 'tperzc_testo_v1';
  // Preferenze dei vecchi criteri di percorso, non più lette dall'app. Le
  // versioni con e senza prefisso coprono anche installazioni molto vecchie.
  const CHIAVI_CRITERI_OBSOLETI = [
    'tperzc_criterio_v1',
    'tperzc_criterio_default_v1',
    'tperzc_criterio_scelte_v1',
    'tperzc_criterio_proposto_v1',
    'criterio_v1',
    'criterio_default',
    'criterio_scelte',
    'criterio_proposto'
  ];
  const URL_UFFICIALE = 'https://solweb.tper.it/web/tools/zone-calculator.aspx';
  const HELLOBUS = 'https://hellobuswsweb.tper.it/web-services/hellobus.asmx/QueryHellobus';
  const RELAY_PREDEFINITO = 'https://api.allorigins.win/raw?url=';
  // Worker Cloudflare personale per il relay CORS verso HelloBus. Se un giorno
  // viene rinominato, questo è l'unico punto da toccare in app.js.
  const RELAY_WORKER = 'https://hellobus-proxy.zeno-astolfi12.workers.dev/?url=';
  const INTERVALLO_LIVE = 30000;
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const NOMINATIM_PAUSA = 1100;      // ms tra due richieste: è la policy d'uso di OSM
  const LUOGHI_MIN = 3;              // caratteri minimi prima di cercare un luogo o indirizzo
  const LUOGHI_MAX = 10;             // risultati Nominatim da chiedere e mostrare
  // Area servita dal bacino TPER: Bologna, Porretta, Vignola, Imola, Ferrara.
  // Un riquadro solo su Bologna tagliava fuori Porretta e la Val Samoggia.
  const NOMINATIM_VIEWBOX = '10.95,44.90,11.90,44.05';
  // Meteo attuale per la zona di partenza: open-meteo non chiede chiavi e
  // risponde in JSON. Si chiede una volta ogni quarto d'ora, mai bloccante.
  const METEO_URL = 'https://api.open-meteo.com/v1/forecast';
  const METEO_TTL = 15 * 60 * 1000;


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
  // Riconoscimento vocale in corso: chiudere la ricerca deve fermare il microfono.
  let voceAscolto = null;

  // Le finestre di sistema (prompt) non passano dal dizionario del DOM.
  function testoUI(italiano, inglese) {
    try {
      return (window.Lingua && typeof Lingua.lingua === 'function' && Lingua.lingua() === 'en')
        ? inglese : italiano;
    } catch (errore) {
      return italiano;
    }
  }
  // L'abbonamento urbano è una preferenza che vale per tutti i viaggi, non una
  // scelta del singolo percorso: come i minuti a piedi sopravvive al ricarico.
  let abbonamento = leggi(K_ABBONAMENTO) === '1';

  // Una sola porta per la preferenza: stato e localStorage restano allineati
  // anche quando si arriva dalla scheda del biglietto o dal menu.
  function impostaAbbonamento(valore) {
    abbonamento = valore === true;
    scrivi(K_ABBONAMENTO, abbonamento ? '1' : '0');
  }
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

  // Il percorso migliore lo sceglie il motore: qui non c'è nessuna preferenza
  // da salvare né due criteri da confrontare.

  function raggioCamminata() {
    return Math.round(camminata * 60 * PASSO_METRI_SECONDO);
  }

  // Linee che l'utente non vuole più vedere proposte: si passano al motore
  // come "vietate" in ogni ricerca, alternative comprese. Il motore le salta
  // in salita, quindi non compaiono nemmeno come cambio intermedio.
  function lineeEvitate() {
    const elenco = leggiJSON(K_EVITATE);
    if (!Array.isArray(elenco)) return [];
    return elenco.map((voce) => String(voce).toUpperCase()).filter(Boolean);
  }

  function vietatePer(extra) {
    const elenco = lineeEvitate();
    (extra || []).forEach((voce) => {
      const linea = String(voce).toUpperCase();
      if (elenco.indexOf(linea) < 0) elenco.push(linea);
    });
    return elenco;
  }

  function renderEvitate() {
    const box = $('menu-evitate-lista');
    if (!box) return;
    const elenco = lineeEvitate();
    box.innerHTML = elenco.length
      ? elenco.map((linea) => '<button type="button" class="chip-pref" data-evita-rimuovi="' +
          esc(linea) + '" aria-label="Torna a proporre la linea ' + esc(linea) + '">' +
          '<span>' + esc(linea) + '</span>' + Icone.svg('x', 14) + '</button>').join('')
      : '<p class="nota-piccola" style="margin:0">Nessuna linea esclusa.</p>';
  }

  // Una sola porta per la preferenza: salva, ridisegna il menu e ricalcola il
  // percorso già aperto, così l'effetto si vede subito.
  function impostaLineeEvitate(elenco) {
    const pulite = [];
    (elenco || []).forEach((voce) => {
      const linea = String(voce || '').trim().toUpperCase();
      if (linea && /^[A-Z0-9]{1,5}$/.test(linea) && pulite.indexOf(linea) < 0) pulite.push(linea);
    });
    scrivi(K_EVITATE, JSON.stringify(pulite.slice(0, 20)));
    routing.chiave = null;
    renderEvitate();
    if (sel.partenza && sel.destinazione) calcolaPercorso();
  }
  let mappa = null;
  const marker = { partenza: null, destinazione: null };
  let statoSheet = 'meta';
  let vistaAttiva = 'percorso';
  let campoAttivo = null;
  let stopLiveRuolo = 'partenza';
  let miniFermata = null;
  let posizioneUtente = null;
  // Ultimo meteo letto: `camminoPesante` è quello che passa al motore.
  const meteo = {
    ts: 0, pioggia: false, neve: 0, mm: 0, vento: 0, codice: null,
    temperatura: null, luogo: '', camminoPesante: false, caricamento: false, errore: null
  };
  // Codici WMO che significano strada bagnata (pioggia, rovesci, temporale,
  // neve): con questi il cammino pesa il doppio.
  const METEO_BAGNATO = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

  // Navigazione guidata: posizione continua, passo corrente, mappa in follow.
  const navigazione = {
    attiva: false, watchId: null, ultima: null, precisione: null,
    passi: [], indice: 0, follow: true, inquadrato: false, ultimoVolo: 0, arrivo: null,
    discesaAvvisata: null
  };
  let markerUtente = null;
  let markerUtenteAggiunto = false;
  let gpsWatch = null;
  let popupPunto = null;
  let sopprimiTapMappa = false;
  let eventoInstallazione = null;
  let liveAbort = null;
  let timerLive = null;
  let trascinando = false;
  let sopprimiClick = false;
  const indirizziCache = new Map();
  let indirizziAbort = null;
  let ultimaRichiestaIndirizzi = 0;
  const suggerimenti = { token: 0, campo: null, query: '', gruppi: [], indirizzi: [], linee: [], caricamento: false, errore: false, modifica: false };
  // Linea aperta nella vista dedicata e provenienza della vista orari.
  const lineaVista = { nome: null, capolinea: null };
  let vistaRitorno = null;
  const diagnostica = { caricamentoMs: null };
  // Durante il ripristino da un tasto indietro non si aggiungono altre voci.
  let ripristinandoStoria = false;
  let lineeInCaricamento = false;

  const live = { items: [], ts: 0, stato: 'idle', caricamento: false, errore: null, stopId: null, avviso: '', fermata: null, aperto: -1, avvisa: null };

  const $ = (id) => document.getElementById(id);
  // Set unico di icone: Lucide inline, nessuna CDN e nessun font esterno.
  const Icone = window.Icone;
  // Funzioni pure (contrasto, cache, inviti) verificate da tests/utilita.test.js.
  const Utilita = window.Utilita;
  const MENO_MOVIMENTO = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Con "riduci movimento" attivo la mappa salta invece di volare.
  function durataMovimento(ms) { return MENO_MOVIMENTO ? 0 : ms; }
  const ICONA_BUS = Icone.svg('bus-front', 18);
  const ICONA_TRENO = Icone.svg('train-front', 18);
  const ICONA_LUOGO = Icone.svg('map-pin', 18);
  const ICONA_ACCESSIBILITA = Icone.svg('accessibility', 16);
  const ICONA_REFRESH = Icone.svg('refresh-cw', 18);
  const ICONA_INFO = Icone.svg('info', 18);
  // Una voce di ricerca si sceglie e chiude la lista: il segno giusto è un più.
  // Il chevron prometteva una schermata successiva che non esiste.
  const ICONA_PIU = Icone.svg('plus', 18, 'voce-piu');
  const ICONA_PIEDANA = Icone.svg('person-standing', 20);
  const ICONA_OROLOGIO = Icone.svg('clock', 16);
  const ICONA_SCAMBIA = Icone.svg('arrow-up-down', 18);
  const ICONA_GIU = Icone.svg('chevron-down', 16);
  const ICONA_X = Icone.svg('x', 18);
  const ICONA_MIRINO = Icone.svg('locate-fixed', 18);

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
  // Una passata sola all'avvio: dopo la prima esecuzione le chiavi non ci sono
  // più, quindi le aperture successive non tolgono niente. Non serve un
  // marcatore "già pulito", che sarebbe un'altra chiave da dichiarare.
  function pulisciCriteriObsoleti() {
    try {
      CHIAVI_CRITERI_OBSOLETI.forEach((chiave) => localStorage.removeItem(chiave));
    } catch (e) { /* storage non disponibile */ }
  }
  function normalizza(testo) {
    return (testo || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function due(valore) { return String(valore).padStart(2, '0'); }
  // "0,00 €" non deve comparire da nessuna parte: zero significa che il viaggio
  // è coperto dall'abbonamento, e va detto così.
  function euro(valore) {
    if (valore == null) return '';
    return valore === 0 ? 'Incluso' : valore.toFixed(2).replace('.', ',') + ' €';
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
    // Il tipo (bus/treno) è già nell'icona della riga: qui restano solo i dati
    // che l'occhio non può dedurre.
    return 'Palina ' + f.id + ' · Zona ' + f.zona + (linee ? ' · ' + linee : '');
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
    return 'Palina ' + f.id + (dettaglioFermata(f) ? ' · ' + dettaglioFermata(f) : '');
  }
  // Niente toast: i messaggi vivono in una riga dentro il pannello.
  function mostraToast(messaggio, durata) {
    const riga = $('riga-stato');
    if (!riga) return;
    riga.textContent = messaggio;
    riga.hidden = false;
    clearTimeout(mostraToast._timer);
    mostraToast._timer = setTimeout(() => { riga.hidden = true; }, durata || 3200);
  }

  /* ------------------------------------------------------------------ *
   * Dati fermate
   * ------------------------------------------------------------------ */
  /**
   * Fetch con timeout e retry a passi crescenti (1 s, 3 s): un 502 momentaneo
   * del relay non deve bruciare il caricamento. `cache: 'no-cache'` obbliga a
   * rivalidare i JSON dati, che altrimenti possono arrivare vecchi.
   */
  async function fetchConTimeout(url, ms, opzioni) {
    const o = opzioni || {};
    const tentativi = o.tentativi == null ? 3 : Math.max(1, o.tentativi);
    let ultimo = null;
    for (let i = 0; i < tentativi; i += 1) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), ms || TIMEOUT_FETCH);
      try {
        const risposta = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
        // 4xx non si ritenta: è la richiesta a essere sbagliata.
        if (!risposta.ok && risposta.status >= 500 && i + 1 < tentativi) {
          throw new Error('HTTP ' + risposta.status);
        }
        return risposta;
      } catch (errore) {
        ultimo = errore;
        if (i + 1 < tentativi) {
          aggiornaAvvio('Riprovo…');
          await new Promise((risolvi) => setTimeout(risolvi, i === 0 ? 1000 : 3000));
        }
      } finally {
        clearTimeout(id);
      }
    }
    throw ultimo || new Error('rete non disponibile');
  }

  // Un segnale che scade da solo, da unire a quello di una ricerca annullata.
  function segnaleConTimeout(esterno, ms) {
    if (typeof AbortController !== 'function') return esterno;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    controller.signal.addEventListener('abort', () => clearTimeout(id), { once: true });
    if (esterno) {
      if (esterno.aborted) controller.abort();
      else esterno.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  /* ------------------------------------------------------------------ *
   * Avvio: splash e placeholder della mappa
   * ------------------------------------------------------------------ */
  function aggiornaAvvio(testo) {
    const riga = $('avvio-stato');
    if (riga && testo) riga.textContent = testo;
  }

  function chiudiAvvio() {
    const avvio = $('avvio');
    if (!avvio || avvio.classList.contains('fuori')) return;
    avvio.classList.add('fuori');
    setTimeout(() => { avvio.hidden = true; }, MENO_MOVIMENTO ? 0 : 300);
  }

  function chiudiAttesaMappa() {
    const attesa = $('mappa-attesa');
    if (!attesa || attesa.classList.contains('fuori')) return;
    attesa.classList.add('fuori');
    setTimeout(() => { attesa.hidden = true; }, MENO_MOVIMENTO ? 0 : 320);
  }

  /* ------------------------------------------------------------------ *
   * Errori: ultimi 50 in locale, per capire cosa non va senza analytics
   * ------------------------------------------------------------------ */
  function registraErrore(tipo, messaggio, stack) {
    try {
      const elenco = leggiJSON(K_ERRORI) || [];
      elenco.unshift({
        ts: Date.now(),
        tipo: String(tipo || 'errore'),
        messaggio: String(messaggio || '').slice(0, 300),
        stack: String(stack || '').slice(0, 500)
      });
      scrivi(K_ERRORI, JSON.stringify(elenco.slice(0, 50)));
    } catch (errore) { /* quota piena: pazienza */ }
  }

  function collegaErrori() {
    window.addEventListener('error', (evento) => {
      registraErrore('errore', evento.message || 'errore sconosciuto',
        evento.error && evento.error.stack ? evento.error.stack : (evento.filename || ''));
    });
    window.addEventListener('unhandledrejection', (evento) => {
      const motivo = evento.reason || {};
      registraErrore('promise', motivo.message || String(motivo), motivo.stack || '');
    });
  }

  /* ------------------------------------------------------------------ *
   * Spazio nel localStorage: le cache rigenerabili si svuotano da sole
   * ------------------------------------------------------------------ */
  function pulisciCacheSeNecessario() {
    try {
      const misure = {};
      let totale = 0;
      for (let i = 0; i < localStorage.length; i += 1) {
        const chiave = localStorage.key(i);
        if (!chiave) continue;
        const peso = chiave.length + (localStorage.getItem(chiave) || '').length;
        misure[chiave] = peso;
        totale += peso;
      }
      if (totale <= Utilita.SOGLIA_CACHE) return [];
      const svuotate = Utilita.cacheDaSvuotare(misure, Utilita.SOGLIA_CACHE);
      svuotate.forEach((chiave) => localStorage.removeItem(chiave));
      if (svuotate.length) piediCache = null;
      return svuotate;
    } catch (errore) {
      return [];
    }
  }

  async function caricaDati() {
    const inizioCaricamento = performance.now();
    aggiornaAvvio('Carico le fermate…');
    try {
      const [rispostaFermate, risposteLinee, rispostaColori] = await Promise.all([
        fetchConTimeout(URL_FERMATE, TIMEOUT_FETCH),
        fetchConTimeout(URL_LINEE, TIMEOUT_FETCH),
        // I colori sono un di più: se non arrivano l'app funziona lo stesso.
        fetchConTimeout(URL_COLORI, TIMEOUT_FETCH).catch(() => null)
      ]);
      if (!rispostaFermate.ok || !risposteLinee.ok) throw new Error('Risposta non valida');
      const datiFermate = await rispostaFermate.json();
      aggiornaAvvio('Carico le linee…');
      const datiLinee = await risposteLinee.json();
      fermate = datiFermate.fermate || [];
      lineePerFermata = datiLinee.linee || {};
      aggiornato = datiFermate.aggiornato || null;
      // Riscrivere più di due megabyte a ogni avvio, quando il dataset non è
      // cambiato, è lavoro inutile sul thread principale: si confronta la
      // versione già salvata e si salta la riscrittura.
      const cacheFermateVecchie = leggiJSON(K_FERMATE);
      const cacheLineeVecchie = leggiJSON(K_LINEE);
      if (!cacheFermateVecchie || cacheFermateVecchie.aggiornato !== aggiornato) {
        scrivi(K_FERMATE, JSON.stringify(datiFermate));
      }
      if (!cacheLineeVecchie || cacheLineeVecchie.aggiornato !== aggiornato) {
        datiLinee.aggiornato = aggiornato;
        scrivi(K_LINEE, JSON.stringify(datiLinee));
      }
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
      aggiornaAvvio('Preparo la mappa…');
    } catch (errore) {
      registraErrore('dati', errore && errore.message, errore && errore.stack);
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
    } finally {
      diagnostica.caricamentoMs = Math.round(performance.now() - inizioCaricamento);
    }
  }

  function fermataPerId(id) {
    return fermate.find((f) => f.id === id) || null;
  }

  function cercaFermate(query) {
    const espanso = Utilita.espandi ? Utilita.espandi(query) : query;
    const q = normalizza(espanso);
    if (q.length < 2) return [];
    const inizio = [];
    const dentro = [];
    const tolleranti = [];
    fermate.forEach((f) => {
      const nome = normalizza(f.nome);
      if (nome.startsWith(q)) inizio.push(f);
      else if (nome.includes(q)) dentro.push(f);
      // Un errore di battitura o un'abbreviazione non devono dare «nessun
      // risultato»: la distanza di edit resta confinata a chi non ha già
      // trovato la fermata per prefisso o sottostringa.
      else if (Utilita.vicina && q.length >= 4 && Utilita.vicina(nome, q)) tolleranti.push(f);
    });
    return inizio.concat(dentro, tolleranti).slice(0, 14);
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
  // La chiave però include il comune: due fermate omonime in comuni diversi
  // (una "Stazione" a Bologna e una a Imola) non sono la stessa fermata.
  function senzaDoppioni(elenco) {
    const visti = new Set();
    return elenco.filter((f) => {
      const chiave = normalizza(f.nome) + '|' + normalizza(f.comune || f.zona || '');
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
      if (sel[ruolo]) apriMini(sel[ruolo]);
    });
    return elemento;
  }

  /* ------------------------------------------------------------------ *
   * Stile della mappa
   * ------------------------------------------------------------------ */
  // «liberty» è lo stile chiaro di OpenFreeMap; «dark» è il corrispettivo
  // scuro, stesso fornitore e stesse attribuzioni. Cambiare stile butta via
  // sorgenti e livelli aggiunti a mano: si ricostruiscono su `style.load`.
  const STILE_MAPPA_CHIARO = 'https://tiles.openfreemap.org/styles/liberty';
  const STILE_MAPPA_SCURO = 'https://tiles.openfreemap.org/styles/dark';
  let stileAttuale = '';

  function stileMappa() {
    return document.documentElement.getAttribute('data-tema') === 'scuro' ? STILE_MAPPA_SCURO : STILE_MAPPA_CHIARO;
  }

  function cambiaStileMappa() {
    const nuovo = stileMappa();
    if (!mappa || nuovo === stileAttuale) return;
    stileAttuale = nuovo;
    mappa.once('style.load', () => {
      aggiungiLivelliPercorso();
      disegnaPercorso();
      disegnaTracciato();
      const zone = $('menu-zone');
      if (zone && zone.checked) mostraZone(true);
      aggiornaMarker();
      aggiornaVisibilitaFermate();
    });
    mappa.setStyle(nuovo, { diff: false });
  }

  function initMappa() {
    const elemento = $('mappa');
    if (!window.maplibregl) {
      elemento.classList.add('senza-mappa');
      elemento.innerHTML = '<p>Mappa non disponibile offline: la ricerca fermate funziona lo stesso.</p>';
      chiudiAttesaMappa();
      return;
    }
    mappa = new maplibregl.Map({
      container: elemento,
      style: stileMappa(),
      center: [11.3426, 44.4949],
      zoom: 13,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false
    });
    stileAttuale = stileMappa();
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
    // Pressione lunga: un punto qualsiasi diventa partenza o destinazione senza
    // passare dalla ricerca. Il tocco breve resta libero per le fermate.
    let attesaPressione = null;
    const fermaPressione = () => { if (attesaPressione) { clearTimeout(attesaPressione); attesaPressione = null; } };
    const avviaPressione = (punto) => {
      fermaPressione();
      attesaPressione = setTimeout(() => {
        attesaPressione = null;
        sopprimiTapMappa = true;
        menuPunto(punto);
      }, 550);
    };
    mappa.on('mousedown', (evento) => avviaPressione(evento.lngLat));
    mappa.on('touchstart', (evento) => {
      if (!evento.points || evento.points.length !== 1) { fermaPressione(); return; }
      avviaPressione(evento.lngLat);
    });
    ['mouseup', 'touchend', 'touchcancel', 'dragstart', 'zoomstart', 'movestart'].forEach((nome) => mappa.on(nome, fermaPressione));
    mappa.on('load', () => {
      chiudiAttesaMappa();
      aggiungiLivelliPercorso();
      aggiornaMarker();
      inquadra(false);
      disegnaTracciato();
    });
    mappa.on('style.load', aggiungiLivelliPercorso);
    mappa.on('styledata', nascondiPoiTransito);
    mappa.on('idle', aggiungiLivelliPercorso);
  }

  function aggiornaMarker() {
    if (!mappa) return;
    ['partenza', 'destinazione'].forEach((ruolo) => {
      const f = sel[ruolo];
      // In home il pin rosso della partenza non c'è: la partenza è la posizione
      // attuale e sulla mappa devono restare solo le fermate. Compare quando
      // c'è una destinazione, cioè quando il viaggio esiste davvero.
      if (ruolo === 'partenza' && !sel.destinazione) {
        if (marker[ruolo]) { marker[ruolo].remove(); marker[ruolo] = null; }
        return;
      }
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
    const durata = animato === false ? 0 : durataMovimento(600);
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
  // Le icone dei punti d'interesse dello stile affollano la mappa e le fermate
  // dell'OSM duplicano i nostri pin, che sono anche toccabili: si tengono solo
  // strade, edifici e nomi. Lo stile può finire di caricarsi dopo il primo
  // tentativo, quindi si ritenta a ogni cambio di stile.
  const LIVELLI_POI = ['poi_transit', 'poi_r20', 'poi_r7', 'poi_r1'];
  function nascondiPoiTransito() {
    if (!mappa) return;
    LIVELLI_POI.forEach((id) => {
      try {
        if (!mappa.getLayer(id)) return;
        if (mappa.getLayoutProperty(id, 'visibility') === 'none') return;
        mappa.setLayoutProperty(id, 'visibility', 'none');
      } catch (errore) { /* riproverà al prossimo cambio di stile */ }
    });
  }

  function aggiungiLivelliPercorso() {
    nascondiPoiTransito();
    if (!mappa || mappa.getSource('percorso')) return;
    try {
      creaLivelliPercorso();
    } catch (errore) { return; /* stile non pronto: si riproverà */ }
    aggiornaFermateMappa();
    aggiornaVisibilitaFermate();
  }

  // Le fermate sulla mappa servono a cercare: quando un percorso è scelto o la
  // navigazione è in corso coprirebbero solo il viaggio appena disegnato.
  function aggiornaVisibilitaFermate() {
    if (!mappa) return;
    const visibili = !navigazione.attiva && !(sel.partenza && sel.destinazione);
    const valore = visibili ? 'visible' : 'none';
    ['fermate-punti', 'fermate-nomi'].forEach((id) => {
      if (mappa.getLayer(id)) mappa.setLayoutProperty(id, 'visibility', valore);
    });
    // Con l'overlay delle zone acceso i cerchi dei raggruppamenti coprono
    // proprio le aree che si vogliono leggere: restano le fermate singole,
    // non i gruppi.
    const voceZone = $('menu-zone');
    const cluster = visibili && !(voceZone && voceZone.checked) ? 'visible' : 'none';
    ['fermate-cluster', 'fermate-cluster-numero'].forEach((id) => {
      if (mappa.getLayer(id)) mappa.setLayoutProperty(id, 'visibility', cluster);
    });
  }

  // Tutte le fermate del dataset su un solo GeoJSON: punti piccoli da vicino,
  // nome solo ad alta zoom. Sono 9.600, quindi niente simboli pesanti.
  function aggiornaFermateMappa() {
    if (!mappa) return;
    const sorgente = mappa.getSource('fermate-mappa');
    if (!sorgente || !fermate.length) return;
    const features = fermate
      .filter((f) => f.lat != null && f.lon != null)
      .map((f) => ({
        type: 'Feature',
        properties: {
          id: f.id,
          nome: nomeFermataBreve(f.nome, f.tipo),
          treno: f.tipo === 'treno' || f.tipo === 'entrambi' ? 1 : 0
        },
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] }
      }));
    sorgente.setData({ type: 'FeatureCollection', features: features });
  }

  /* ------------------------------------------------------------------ *
   * Tutte le linee sulla mappa (spento di default)
   * ------------------------------------------------------------------ */
  let formeLinee = null;
  let formeInCorso = null;
  // Quante corsie parallele si usano per le linee che condividono la strada.
  const CORSIE = 7;
  const PASSO_CORSIA = 1.6;           // px tra una corsia e la successiva

  // Il file è compresso e si scarica solo quando l'interruttore si accende:
  // chi non lo usa non paga il download.
  async function caricaFormeLinee() {
    if (formeLinee) return formeLinee;
    if (formeInCorso) return formeInCorso;
    formeInCorso = (async () => {
      let testo = null;
      try {
        const risposta = await fetchConTimeout(URL_TRACC_GZ, TIMEOUT_FETCH * 3);
        if (!risposta.ok) throw new Error('tracciati ' + risposta.status);
        if (typeof DecompressionStream === 'function' && risposta.body) {
          testo = await new Response(risposta.body.pipeThrough(new DecompressionStream('gzip'))).text();
        }
      } catch (errore) {
        testo = null;
      }
      if (!testo) {
        const semplice = await fetchConTimeout(URL_TRACC, TIMEOUT_FETCH * 3);
        if (!semplice.ok) throw new Error('tracciati ' + semplice.status);
        testo = await semplice.text();
      }
      const dati = JSON.parse(testo);
      // Per colorare serve sapere quale linea percorre ogni forma: gli orari
      // sono già in memoria per il calcolo dei percorsi (o arrivano adesso).
      let orari = null;
      try {
        if (typeof TPERRouting !== 'undefined' && TPERRouting.carica) {
          orari = await TPERRouting.carica(URL_ORARI_GZ, URL_ORARI);
        }
      } catch (errore) {
        orari = null;
      }
      if (!Object.keys(coloriLinee).length) {
        try {
          const rispostaColori = await fetchConTimeout(URL_COLORI, TIMEOUT_FETCH);
          if (rispostaColori.ok) {
            const datiColori = await rispostaColori.json();
            if (datiColori && datiColori.linee) coloriLinee = datiColori.linee;
          }
        } catch (errore) { /* si resta sul colore di riserva */ }
      }

      // Forma → linea che la usa di più: una forma può servire due linee, la
      // prevalente dà il colore.
      const lineaPerForma = new Map();
      const lineeTreno = new Set();
      if (orari && Array.isArray(orari.corse) && Array.isArray(orari.linee) && Array.isArray(dati.corse)) {
        orari.linee.forEach((linea) => { if (linea && linea[1] === 2) lineeTreno.add(String(linea[0])); });
        const conteggi = new Map();
        dati.corse.forEach((forma, indice) => {
          const corsa = orari.corse[indice];
          if (forma < 0 || !corsa) return;
          const linea = orari.linee[corsa[0]];
          if (!linea) return;
          if (!conteggi.has(forma)) conteggi.set(forma, new Map());
          const mappa = conteggi.get(forma);
          mappa.set(linea[0], (mappa.get(linea[0]) || 0) + 1);
        });
        conteggi.forEach((mappa, forma) => {
          let nome = null;
          let massimo = -1;
          mappa.forEach((quante, linea) => {
            if (quante > massimo) { massimo = quante; nome = linea; }
          });
          if (nome != null) lineaPerForma.set(forma, nome);
        });
      }

      // Ogni linea ha una corsia fissa: dove due linee percorrono la stessa
      // strada si disegnano affiancate invece che una sopra l'altra. L'ordine
      // è alfabetico e stabile, così la mappa non cambia da un avvio all'altro.
      const nomiLinee = Array.from(new Set(lineaPerForma.values()))
        .sort((a, b) => String(a).localeCompare(String(b), 'it', { numeric: true }));
      const corsiaDi = new Map();
      nomiLinee.forEach((nome, indice) => {
        corsiaDi.set(nome, (indice % CORSIE) - Math.floor(CORSIE / 2));
      });

      const features = (dati.forme || [])
        .map((forma, indice) => {
          // ~8 metri: toglie il tremolio del GPS del bus senza spostare la strada.
          const punti = Utilita.semplifica(decodificaPolilinea(forma), 0.00008);
          if (punti.length < 2) return null;
          const nome = lineaPerForma.get(indice);
          const treno = nome != null && lineeTreno.has(String(nome));
          // I treni restano neri come nel percorso scelto: il colore della
          // linea serve a distinguere le linee di bus.
          const colore = treno ? '#1A1A1A' : (coloreTracciato(nome) || '#C1121F');
          return {
            type: 'Feature',
            properties: { colore: colore, corsia: corsiaDi.has(nome) ? corsiaDi.get(nome) : 0 },
            geometry: { type: 'LineString', coordinates: punti }
          };
        })
        .filter(Boolean);
      formeLinee = { type: 'FeatureCollection', features: features };
      return formeLinee;
    })();
    try {
      return await formeInCorso;
    } finally {
      formeInCorso = null;
    }
  }

  // Stesso formato di routing.js (delta lat/lon in base 63), qui in [lon, lat]
  // perché è quello che si aspetta GeoJSON.
  function decodificaPolilinea(testo) {
    const punti = [];
    if (typeof testo !== 'string' || !testo.length) return punti;
    let indice = 0;
    let lat = 0;
    let lon = 0;
    const numero = () => {
      let risultato = 0;
      let shift = 0;
      let byte;
      do {
        byte = testo.charCodeAt(indice++) - 63;
        risultato |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return (risultato & 1) ? ~(risultato >> 1) : (risultato >> 1);
    };
    while (indice < testo.length) {
      lat += numero();
      lon += numero();
      punti.push([lon / 1e5, lat / 1e5]);
    }
    return punti;
  }

  const LIVELLI_LINEE = ['linee-tutte-bordo', 'linee-tutte', 'linee-stazioni'];

  async function mostraLineeTutte(attivo) {
    if (!mappa) return;
    if (mappa.getLayer('linee-tutte')) {
      LIVELLI_LINEE.forEach((id) => {
        if (mappa.getLayer(id)) mappa.setLayoutProperty(id, 'visibility', attivo ? 'visible' : 'none');
      });
      return;
    }
    if (!attivo) return;
    try {
      const dati = await caricaFormeLinee();
      if (!mappa || mappa.getLayer('linee-tutte')) return;
      mappa.addSource('linee-tutte', { type: 'geojson', data: dati });
      const sotto = mappa.getLayer('fermate-cluster') ? 'fermate-cluster' : undefined;
      // Bordo bianco sotto il colore: è quello che rende leggibili due linee
      // che si incrociano, come in una mappa della metropolitana.
      mappa.addLayer({
        id: 'linee-tutte-bordo',
        type: 'line',
        source: 'linee-tutte',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#FFFFFF',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4.2, 12, 6, 16, 8],
          'line-opacity': 0.92,
          // Corsia in pixel, non legata allo zoom: le linee parallele restano
          // separate anche allontanandosi.
          'line-offset': ['*', ['get', 'corsia'], PASSO_CORSIA]
        }
      }, sotto);
      mappa.addLayer({
        id: 'linee-tutte',
        type: 'line',
        source: 'linee-tutte',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'colore'], '#C1121F'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 12, 3, 16, 4.2],
          'line-opacity': 1,
          'line-offset': ['*', ['get', 'corsia'], PASSO_CORSIA]
        }
      }, sotto);
      // Fermate come punti della metro: cerchio bianco con anello scuro, sopra
      // la linea. I pin restano il bersaglio del tocco a zoom più alto.
      const punti = fermate
        .filter((f) => f.lat != null && f.lon != null)
        .map((f) => ({
          type: 'Feature',
          properties: { treno: f.tipo === 'treno' ? 1 : 0 },
          geometry: { type: 'Point', coordinates: [f.lon, f.lat] }
        }));
      mappa.addSource('linee-stazioni', { type: 'geojson', data: { type: 'FeatureCollection', features: punti } });
      mappa.addLayer({
        id: 'linee-stazioni',
        type: 'circle',
        source: 'linee-stazioni',
        // Le fermate come punti della metro si vedono da vicino: a scala di
        // città sarebbero novemila puntini sopra le linee.
        minzoom: 13,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 4.4],
          'circle-color': ['case', ['==', ['get', 'treno'], 1], '#1A1A1A', '#FFFFFF'],
          'circle-stroke-color': ['case', ['==', ['get', 'treno'], 1], '#FFFFFF', '#1A1A1A'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 1.8]
        }
      }, sotto);
    } catch (errore) {
      mostraToast('Tracciati delle linee non disponibili offline');
      const voce = $('menu-linee');
      if (voce) voce.checked = false;
    }
  }

  /* --- Zone tariffarie ----------------------------------------------------
   * I confini ufficiali TPER non sono pubblicati. L'Area Urbana di Bologna
   * (500 + zone neutre 501–509) viene disegnata come un bersaglio: disco
   * centrale per la 500 e una corona divisa in spicchi nella direzione delle
   * fermate per le neutre. Così non restano buchi tra una zona e l'altra e
   * la successione si legge a colpo d'occhio. Le zone extraurbane, che non
   * formano un anello attorno alla città, restano cerchi locali attorno alle
   * loro fermate. Tutto è una stima, non un confine ufficiale.
   */

  const MARGINE_ZONA = 1200;       // metri oltre la fermata "tipica"
  const RAGGIO_ZONA_MIN = 1600;    // una zona con poche fermate resta visibile
  const RAGGIO_ZONA_MAX = 12000;
  let popupZona = null;
  let zonaScelta = null;           // zona evidenziata, se c'è
  let zonePerZona = new Map();     // zona → feature della sua area

  function raggioZona(punti, centro, quantile) {
    const c = { lat: centro[1], lon: centro[0] };
    const distanze = punti
      .map((p) => distanzaMetri(c, { lat: p[1], lon: p[0] }))
      .sort((a, b) => a - b);
    if (!distanze.length) return RAGGIO_ZONA_MIN;
    const q = quantile == null ? 0.9 : quantile;
    const indice = Math.floor((distanze.length - 1) * q);
    return Math.max(RAGGIO_ZONA_MIN, Math.min(RAGGIO_ZONA_MAX, distanze[indice] + MARGINE_ZONA));
  }

  // Punto a `raggio` metri e `angolo` radianti (0 = nord, senso orario).
  function puntoPolare(centro, raggio, angolo) {
    const R = 6371000;
    const lat1 = (centro[1] * Math.PI) / 180;
    const lon1 = (centro[0] * Math.PI) / 180;
    const d = raggio / R;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(angolo)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(angolo) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
  }

  function settoreAnulare(centro, interno, esterno, da, a, passi) {
    const n = Math.max(6, Math.round(passi || 24));
    const anello = [];
    for (let i = 0; i <= n; i += 1) {
      anello.push(puntoPolare(centro, esterno, da + ((a - da) * i) / n));
    }
    for (let i = n; i >= 0; i -= 1) {
      anello.push(puntoPolare(centro, interno, da + ((a - da) * i) / n));
    }
    return anello;
  }

  // Direzione in radianti del punto rispetto al centro (0 = nord).
  function angoloVento(centro, punto) {
    const lat1 = (centro[1] * Math.PI) / 180;
    const lat2 = (punto[1] * Math.PI) / 180;
    const dLon = ((punto[0] - centro[0]) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  }

  function datiZone() {
    const perZona = new Map();
    fermate.forEach((f) => {
      if (f.zona == null || f.lat == null || f.lon == null) return;
      const zona = String(f.zona);
      if (!perZona.has(zona)) perZona.set(zona, []);
      perZona.get(zona).push([f.lon, f.lat]);
    });
    const voci = [];
    perZona.forEach((punti, zona) => {
      const centro = Utilita.centroide(punti);
      if (!centro) return;
      voci.push({
        zona: zona,
        punti: punti,
        centro: centro,
        etichetta: Tariffe.etichettaZona(zona),
        famiglia: zona === '500' ? 'urbana' : (Tariffe.isZonaUrbana(zona) ? 'neutra' : 'extraurbana')
      });
    });
    const aree = [];
    const areeUrbane = [];
    const etichette = [];
    zonePerZona = new Map();
    const registra = (voce, anello, centroEtichetta, extra) => {
      if (!anello || anello.length < 3) return;
      const forma = {
        type: 'Feature',
        id: 'zona-' + voce.zona,
        properties: Object.assign({
          zona: voce.zona,
          famiglia: voce.famiglia,
          titolo: voce.etichetta.titolo,
          nota: voce.etichetta.nota
        }, extra || {}),
        geometry: { type: 'Polygon', coordinates: [anello.concat([anello[0]])] }
      };
      (voce.famiglia === 'extraurbana' ? aree : areeUrbane).push(forma);
      zonePerZona.set(voce.zona, [forma]);
      etichette.push({
        type: 'Feature',
        properties: {
          zona: voce.zona,
          famiglia: voce.famiglia,
          titolo: voce.etichetta.titolo,
          nota: voce.etichetta.nota
        },
        geometry: { type: 'Point', coordinates: centroEtichetta }
      });
    };

    const urbana = voci.find((v) => v.zona === '500');
    const neutre = voci.filter((v) => v.famiglia === 'neutra');
    const extraurbane = voci.filter((v) => v.famiglia === 'extraurbana');

    // Le zone fuori dall'area urbana restano cerchi locali, disegnati sotto
    // il bersaglio di Bologna.
    extraurbane.forEach((voce) => {
      const raggio = raggioZona(voce.punti, voce.centro, 0.9);
      registra(voce, Utilita.cerchio(voce.centro, raggio, 64), voce.centro, { raggio: Math.round(raggio) });
    });

    if (urbana) {
      const centro = urbana.centro;
      const r500 = raggioZona(urbana.punti, centro, 0.5);
      registra(urbana, Utilita.cerchio(centro, r500, 64), centro, { raggio: Math.round(r500) });
      if (neutre.length) {
        const distanze = neutre.map((v) => distanzaMetri(
          { lat: centro[1], lon: centro[0] },
          { lat: v.centro[1], lon: v.centro[0] }
        ));
        const r1 = Math.max(r500 + 2600, Math.max.apply(null, distanze) + 1400);
        const ordinate = neutre.map((v) => ({
          voce: v,
          angolo: angoloVento(centro, v.centro)
        })).sort((a, b) => a.angolo - b.angolo);
        ordinate.forEach((voce, i) => {
          const n = ordinate.length;
          const precedente = i === 0 ? ordinate[n - 1].angolo - 2 * Math.PI : ordinate[i - 1].angolo;
          const successivo = i === n - 1 ? ordinate[0].angolo + 2 * Math.PI : ordinate[i + 1].angolo;
          const da = (precedente + voce.angolo) / 2;
          const a = (voce.angolo + successivo) / 2;
          const etichetta = puntoPolare(centro, (r500 + r1) / 2, (da + a) / 2);
          registra(
            voce.voce,
            settoreAnulare(centro, r500, r1, da, a, 28),
            etichetta,
            { raggio: Math.round(r1) }
          );
        });
      }
    } else {
      // Dati senza la 500: le neutre restano cerchi, invece di sparire.
      neutre.forEach((voce) => {
        const raggio = raggioZona(voce.punti, voce.centro, 0.9);
        registra(voce, Utilita.cerchio(voce.centro, raggio, 64), voce.centro, { raggio: Math.round(raggio) });
      });
    }

    // Nel gruppo urbano la corona neutra sta sotto il disco 500; le aree
    // extraurbane hanno un livello tutto loro, così non attraversano il
    // bersaglio di Bologna con i loro bordi.
    const priorita = (f) => (f.properties.zona === '500' ? 2 : (f.properties.famiglia === 'neutra' ? 1 : 0));
    areeUrbane.sort((a, b) => (priorita(a) - priorita(b)) || (b.properties.raggio - a.properties.raggio));
    return {
      aree: { type: 'FeatureCollection', features: aree },
      areeUrbane: { type: 'FeatureCollection', features: areeUrbane },
      etichette: { type: 'FeatureCollection', features: etichette }
    };
  }

  // L'evidenziazione è una sorgente a parte con le sole aree della zona
  // scelta: si svuota e si riempie, senza feature-state (che con le aree
  // annidate di MapLibre lasciava espressioni a metà).
  function evidenziaZona(zona) {
    if (!mappa || !mappa.getSource('zone-scelta')) return;
    mappa.getSource('zone-scelta').setData({
      type: 'FeatureCollection',
      features: (zona != null && zonePerZona.get(zona)) || []
    });
  }

  // Toglie l'evidenziazione e la scheda: si torna a vedere la mappa com'era.
  function spegniZonaScelta() {
    evidenziaZona(null);
    zonaScelta = null;
    if (popupZona) { popupZona.remove(); popupZona = null; }
  }

  // Zona della fermata più vicina al centro della mappa: è la stessa regola
  // con cui l'app assegna la zona a un indirizzo, quindi i due non si
  // contraddicono.
  function zonaAlCentro() {
    if (!mappa) return null;
    const centro = mappa.getCenter();
    const vicina = fermateVicine(centro.lat, centro.lng, 1)[0];
    return vicina && vicina.zona != null ? String(vicina.zona) : null;
  }

  // Pillola sotto la barra: dice che zona si sta guardando senza aprire nulla.
  function aggiornaZonaIndicatore() {
    const riga = $('zona-indicatore');
    const voce = $('menu-zone');
    if (!riga) return;
    if (!mappa || !voce || !voce.checked) { riga.hidden = true; riga.textContent = ''; return; }
    const zona = zonaAlCentro();
    riga.hidden = false;
    if (!zona) {
      riga.className = 'zona-indicatore extra';
      riga.dataset.zona = '';
      riga.textContent = 'Fuori zona';
      return;
    }
    const famiglia = zona === '500' ? 'urbana' : (Tariffe.isZonaUrbana(zona) ? 'neutra' : 'extraurbana');
    riga.className = 'zona-indicatore' + (famiglia === 'urbana' ? '' : ' extra');
    riga.dataset.zona = zona;
    riga.innerHTML = '<span class="zona-punto"></span>Zona ' + esc(zona) + ' · ' + famiglia;
  }

  function mostraZone(attivo) {
    if (!mappa) return;
    // Il controllo su isStyleLoaded() da solo è troppo severo: con una tile
    // lenta la mappa è già disegnata ma l'evento load non arriva mai. Se lo
    // stile ha i suoi livelli si può aggiungere l'overlay; altrimenti si
    // riprova sia su load sia su idle, invece di perdere il tocco.
    const stile = mappa.getStyle && mappa.getStyle();
    if (!stile || !stile.layers || !stile.layers.length) {
      if (attivo) {
        const riprova = () => {
          const voce = $('menu-zone');
          if (voce && voce.checked && !mappa.getLayer('zone-fill')) mostraZone(true);
        };
        mappa.once('load', riprova);
        mappa.once('idle', riprova);
      }
      return;
    }
    if (mappa.getLayer('zone-fill')) {
      ['zone-fill', 'zone-bordo', 'zone-urbana-fill', 'zone-urbana-bordo', 'zone-fill-scelta', 'zone-bordo-scelta', 'zone-etichette', 'zone-etichette-extra'].forEach((id) => {
        if (mappa.getLayer(id)) mappa.setLayoutProperty(id, 'visibility', attivo ? 'visible' : 'none');
      });
      if (!attivo) spegniZonaScelta();
      aggiornaZonaIndicatore();
      aggiornaVisibilitaFermate();
      return;
    }
    if (!attivo) return;
    try {
      // Sopra la cartografia ma sotto i livelli dell'app (partendo dall'alone
      // del GPS, che è il più in basso): fermate e percorso restano leggibili.
      const sotto = mappa.getLayer('utente-precisione') ? 'utente-precisione' : undefined;
      const dati = datiZone();
      mappa.addSource('zone', { type: 'geojson', data: dati.aree });
      mappa.addSource('zone-urbana', { type: 'geojson', data: dati.areeUrbane });
      mappa.addSource('zone-etichette', { type: 'geojson', data: dati.etichette });
      // Extraurbane: un velo e un confine leggero, senza invadere il
      // bersaglio di Bologna con cento cerchi in primo piano.
      mappa.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zone',
        minzoom: 9.5,
        paint: {
          'fill-color': '#6B6B6B',
          'fill-opacity': 0.025
        }
      }, sotto);
      mappa.addLayer({
        id: 'zone-bordo',
        type: 'line',
        source: 'zone',
        minzoom: 10.5,
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': '#6B6B6B',
          'line-width': 0.8,
          'line-opacity': 0.22
        }
      }, sotto);
      // Area urbana: disco 500 e corona delle neutre, sopra le extraurbane.
      mappa.addLayer({
        id: 'zone-urbana-fill',
        type: 'fill',
        source: 'zone-urbana',
        minzoom: 9.5,
        paint: {
          'fill-color': ['match', ['get', 'famiglia'], 'urbana', '#C1121F', '#6B6B6B'],
          'fill-opacity': ['match', ['get', 'famiglia'], 'urbana', 0.14, 0.06]
        }
      }, sotto);
      mappa.addLayer({
        id: 'zone-urbana-bordo',
        type: 'line',
        source: 'zone-urbana',
        minzoom: 9.5,
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'famiglia'], 'urbana', '#C1121F', '#6B6B6B'],
          'line-width': ['match', ['get', 'famiglia'], 'urbana', 2, 1.2],
          'line-opacity': ['match', ['get', 'famiglia'], 'urbana', 0.9, 0.65]
        }
      }, sotto);
      // La zona toccata, sopra le altre e sotto le etichette.
      mappa.addSource('zone-scelta', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      mappa.addLayer({
        id: 'zone-fill-scelta',
        type: 'fill',
        source: 'zone-scelta',
        paint: {
          'fill-color': ['match', ['get', 'famiglia'], 'urbana', '#C1121F', '#6B6B6B'],
          'fill-opacity': 0.16
        }
      }, sotto);
      mappa.addLayer({
        id: 'zone-bordo-scelta',
        type: 'line',
        source: 'zone-scelta',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'famiglia'], 'urbana', '#C1121F', '#6B6B6B'],
          'line-width': 2.5,
          'line-opacity': 0.95
        }
      }, sotto);
      mappa.addLayer({
        id: 'zone-etichette',
        type: 'symbol',
        source: 'zone-etichette',
        minzoom: 9.5,
        filter: ['!=', ['get', 'famiglia'], 'extraurbana'],
        layout: {
          'text-field': ['get', 'zona'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 11, 11, 13, 14, 14],
          'text-allow-overlap': false,
          'text-padding': 3
        },
        paint: {
          'text-color': ['match', ['get', 'famiglia'], 'urbana', '#C1121F', '#6B6B6B'],
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1.8,
          'text-halo-blur': 0.3
        }
      });
      mappa.addLayer({
        id: 'zone-etichette-extra',
        type: 'symbol',
        source: 'zone-etichette',
        minzoom: 11,
        filter: ['==', ['get', 'famiglia'], 'extraurbana'],
        layout: {
          'text-field': ['get', 'zona'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12],
          'text-allow-overlap': false,
          'text-padding': 4
        },
        paint: {
          'text-color': '#6B6B6B',
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1.4,
          'text-halo-blur': 0.3
        }
      });
      aggiornaZonaIndicatore();
      aggiornaVisibilitaFermate();
    } catch (errore) {
      mostraToast('Zone non disponibili con questi dati');
      const voce = $('menu-zone');
      if (voce) voce.checked = false;
    }
  }

  // Scheda della zona toccata: due righe, senza aprire il pannello. L'area si
  // accende e resta accesa finché non si tocca altrove.
  function mostraZonaToccata(feature, punto) {
    if (!mappa || !feature) return;
    const proprieta = feature.properties || {};
    const zona = String(proprieta.zona || '');
    if (!zona) return;
    if (zonaScelta !== zona) spegniZonaScelta();
    zonaScelta = zona;
    evidenziaZona(zona);
    const nodo = document.createElement('div');
    nodo.className = 'zona-scheda';
    nodo.innerHTML = '<b>' + esc(proprieta.titolo || ('Zona ' + zona)) + '</b>' +
      '<span>' + esc(proprieta.nota || '') + '</span>';
    if (popupZona) { popupZona.remove(); popupZona = null; }
    popupZona = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 6, className: 'zona-popup' })
      .setLngLat(punto)
      .setDOMContent(nodo)
      .addTo(mappa);
  }

  // Il pin delle fermate è un'immagine disegnata una volta su canvas: sui
  // display retina resta nitida grazie al pixelRatio 2x.
  const ICONA_PIN_FERMATA = 'pin-fermata';
  const ICONA_PIN_TRENO = 'pin-fermata-treno';

  // Il segno della fermata è un cerchio morbido, non una goccia con la punta:
  // niente linee rette, ombra appena accennata e lo stesso rosso del marchio.
  // I treni usano la variante scura.
  function immaginePinFermata(treno) {
    const scala = 2;
    const lato = 26;
    const tela = document.createElement('canvas');
    tela.width = lato * scala;
    tela.height = lato * scala;
    const ctx = tela.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scala, scala);
    const centro = lato / 2;
    const raggio = 9.1;
    const colore = treno ? '#1A1A1A' : '#C1121F';
    // L'ombra sta solo sotto il disco: dà profondità senza disegnare un gambo.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.26)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1.5;
    ctx.beginPath();
    ctx.arc(centro, centro, raggio, 0, Math.PI * 2);
    ctx.fillStyle = colore;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(centro, centro, raggio, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    // Foro bianco al centro, come il resto dei segni dell'app.
    ctx.beginPath();
    ctx.arc(centro, centro, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    return { immagine: ctx.getImageData(0, 0, tela.width, tela.height), scala: scala };
  }

  function creaLivelliPercorso() {
    const vuoto = { type: 'FeatureCollection', features: [] };
    // Precisione del GPS: sta sotto tutto, è solo un alone.
    mappa.addSource('utente', { type: 'geojson', data: vuoto });
    mappa.addLayer({
      id: 'utente-precisione', type: 'fill', source: 'utente',
      paint: { 'fill-color': '#C1121F', 'fill-opacity': 0.10 }
    });
    mappa.addLayer({
      id: 'utente-precisione-bordo', type: 'line', source: 'utente',
      paint: { 'line-color': '#C1121F', 'line-opacity': 0.35, 'line-width': 1 }
    });
    // Fermate: sotto i livelli del percorso, così il tracciato resta sopra.
    // A zoom basso si raggruppano in un cerchio con il numero di fermate.
    mappa.addSource('fermate-mappa', {
      type: 'geojson',
      data: vuoto,
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 14
    });
    mappa.addLayer({
      id: 'fermate-cluster',
      type: 'circle',
      source: 'fermate-mappa',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#FFFFFF',
        'circle-radius': ['step', ['get', 'point_count'], 15, 25, 19, 120, 24],
        'circle-stroke-color': '#C1121F',
        'circle-stroke-width': 2
      }
    });
    mappa.addLayer({
      id: 'fermate-cluster-numero',
      type: 'symbol',
      source: 'fermate-mappa',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12
      },
      paint: { 'text-color': '#1A1A1A' }
    });
    [[ICONA_PIN_FERMATA, false], [ICONA_PIN_TRENO, true]].forEach(([nome, treno]) => {
      if (mappa.hasImage(nome)) return;
      const pin = immaginePinFermata(treno);
      if (!pin) return;
      try {
        mappa.addImage(nome, pin.immagine, { pixelRatio: pin.scala });
      } catch (errore) { /* immagine non accettata: resta il pallino */ }
    });
    mappa.addLayer(mappa.hasImage(ICONA_PIN_FERMATA) && mappa.hasImage(ICONA_PIN_TRENO) ? {
      id: 'fermate-punti',
      type: 'symbol',
      source: 'fermate-mappa',
      minzoom: 12.5,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['case', ['==', ['get', 'treno'], 1], ICONA_PIN_TRENO, ICONA_PIN_FERMATA],
        'icon-anchor': 'center',
        // Crescono con lo zoom ma restano leggibili da lontano: sono anche il
        // bersaglio del tocco, quindi il pin è più grande di un simbolo
        // decorativo.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.68, 14, 0.88, 16, 1.08]
      }
    } : {
      id: 'fermate-punti',
      type: 'circle',
      source: 'fermate-mappa',
      minzoom: 12.5,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 3.2, 16, 7],
        'circle-color': ['case', ['==', ['get', 'treno'], 1], '#1A1A1A', '#FFFFFF'],
        'circle-stroke-color': ['case', ['==', ['get', 'treno'], 1], '#FFFFFF', '#1A1A1A'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12.5, 1.4, 16, 2]
      }
    });
    mappa.addLayer({
      id: 'fermate-nomi',
      type: 'symbol',
      source: 'fermate-mappa',
      minzoom: 15.5,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'nome'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.55],
        'text-anchor': 'top',
        'text-optional': true,
        'text-padding': 4
      },
      paint: {
        'text-color': '#1A1A1A',
        'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.2
      }
    });
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
    // Frecce lungo il tracciato: indicano il verso di percorrenza dei bus.
    if (!mappa.hasImage('freccia-percorso')) {
      const freccia = immagineFreccia();
      if (freccia) {
        try { mappa.addImage('freccia-percorso', freccia, { pixelRatio: 2 }); } catch (errore) { /* niente frecce */ }
      }
    }
    // Ricreare i livelli dell'app manda via le zone: se erano accese tornano.
    const voceZone = $('menu-zone');
    if (voceZone && voceZone.checked && !mappa.getLayer('zone-fill')) mostraZone(true);
    if (mappa.hasImage('freccia-percorso')) {
      mappa.addLayer({
        id: 'percorso-frecce',
        type: 'symbol',
        source: 'percorso',
        filter: ['all', ['==', ['get', 'modo'], 'bus'], ['!=', ['get', 'ufficiale'], false]],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 110,
          'icon-image': 'freccia-percorso',
          'icon-size': 0.6,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });
    }
  }

  // Freccia disegnata su canvas e ruotata da MapLibre lungo la linea.
  function immagineFreccia() {
    const scala = 2;
    const lato = 16;
    const tela = document.createElement('canvas');
    tela.width = lato * scala;
    tela.height = lato * scala;
    const ctx = tela.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scala, scala);
    ctx.beginPath();
    ctx.moveTo(lato / 2, 2);
    ctx.lineTo(lato - 3.5, lato - 3);
    ctx.lineTo(lato / 2, lato - 6);
    ctx.lineTo(3.5, lato - 3);
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = 'rgba(26,26,26,.55)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    return ctx.getImageData(0, 0, tela.width, tela.height);
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

  // OSRM pedonale è un servizio pubblico con limiti d'uso: un percorso chiede
  // una decina di tratti tutti insieme e il server risponde 429 (visto nei log).
  // Qui le richieste passano da una coda con una sola attiva e un secondo di
  // distanza, come chiede la policy del servizio demo; a un 429 si svuota la
  // coda per qualche secondo. I tratti restano diritti finché la geometria
  // arriva: nessun percorso si blocca per colpa del cammino.
  const piediCoda = { coda: [], attive: 0, massimo: 1, pausa: 0, sospesoFino: 0, timer: null };
  const PIEDI_INTERVALLO = 1000;   // ms fra due richieste OSRM
  const PIEDI_RIPROVA = 20000;     // ms dopo cui un errore di rete si può ritentare

  function accodaPiedi(chiave, esegui) {
    piediCoda.coda.push({ chiave, esegui });
    svuotaCodaPiedi();
  }

  function svuotaCodaPiedi() {
    if (!piediCoda.coda.length || piediCoda.attive >= piediCoda.massimo) return;
    const ora = Date.now();
    const attesa = Math.max(piediCoda.pausa - ora, piediCoda.sospesoFino - ora, 0);
    if (attesa > 0) {
      if (!piediCoda.timer) {
        piediCoda.timer = setTimeout(() => {
          piediCoda.timer = null;
          svuotaCodaPiedi();
        }, attesa);
      }
      return;
    }
    const voce = piediCoda.coda.shift();
    piediCoda.attive += 1;
    piediCoda.pausa = ora + PIEDI_INTERVALLO;
    Promise.resolve()
      .then(voce.esegui)
      .catch(() => { piediFalliti.add(voce.chiave); })
      .finally(() => {
        piediCoda.attive -= 1;
        svuotaCodaPiedi();
      });
    svuotaCodaPiedi();
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
    accodaPiedi(chiave, () => scaricaPiedi(da, a, chiave));
  }

  function scaricaPiedi(da, a, chiave) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_OSRM);
    return fetch(Piedi.url(da, a) + '?overview=full&geometries=geojson&steps=false', { signal: controller.signal })
      .then((risposta) => {
        if (risposta.status === 429) {
          // Troppe richieste: per un po' non si insiste, la coda si svuota.
          piediCoda.sospesoFino = Date.now() + 8000;
          piediCoda.coda.forEach((voce) => piediFalliti.add(voce.chiave));
          piediCoda.coda.length = 0;
          throw new Error('OSRM 429');
        }
        if (!risposta.ok) throw new Error('OSRM HTTP ' + risposta.status);
        return risposta.json();
      })
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
      .catch((errore) => {
        // Un 429 o una rete caduta non sono un verdetto sul tratto: si segna
        // fallito per non insistere subito, ma fra poco si potrà ritentare.
        piediFalliti.add(chiave);
        const transitorio = !errore || errore.name === 'AbortError' || /429|rate limit/i.test(errore.message || '');
        if (transitorio) setTimeout(() => piediFalliti.delete(chiave), PIEDI_RIPROVA);
      })
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

  // Tornare alla schermata iniziale azzera la navigazione: la tratta smette di
  // essere scelta, il percorso sparisce dalla mappa e il pannello si riduce.
  // Senza questo le linee del vecchio viaggio restavano disegnate sopra la
  // mappa come se la ricerca fosse ancora aperta.
  function azzeraNavigazione() {
    if (navigazione.attiva) fermaNavigazione(true);
    chiudiMini();
    sel.destinazione = null;
    impostaInput('destinazione');
    aggiornaMarker();
    salvaTratta();
    // Una risposta ancora in volo non deve ridisegnare il viaggio appena chiuso.
    routing.richiesta += 1;
    routing.chiave = null;
    routing.stato = 'idle';
    routing.esito = null;
    routing.opzioni = [];
    routing.piedi = null;
    routing.opzionePiedi = null;
    routing.candidatiDestinazione = null;
    routing.suggerimento = null;
    routing.avvisoRitardo = '';
    routing.aperto = -1;
    livePercorso.chiave = null;
    livePercorso.corsa = null;
    livePercorso.stato = 'idle';
    livePercorso.caricamento = false;
    if (livePercorsoAbort) {
      livePercorsoAbort.abort();
      livePercorsoAbort = null;
    }
    // Anche i ritardi delle altre tappe sono del viaggio appena chiuso.
    liveTappe.chiave = null;
    liveTappe.stato = 'idle';
    liveTappe.valori = [];
    liveTappe.esito = null;
    if (liveTappeAbort) {
      liveTappeAbort.abort();
      liveTappeAbort = null;
    }
    ultimeFeatures = [];
    inquadratoPerFermate = null;
    if (mappa) {
      ['percorso', 'percorso-fermate', 'percorso-nodi'].forEach((id) => {
        const sorgente = mappa.getSource(id);
        if (sorgente && typeof sorgente.setData === 'function') {
          sorgente.setData({ type: 'FeatureCollection', features: [] });
        }
      });
    }
    mostraVista('percorso');
    renderPercorso();
    impostaSheet('peek');
    inquadra();
    aggiornaUrl('replace');
  }

  /* ------------------------------------------------------------------ *
   * Navigazione guidata
   * ------------------------------------------------------------------ */
  const NAV_SOGLIA = 35;              // metri: sotto questa distanza il passo è raggiunto
  const NAV_SOGLIA_SALITA = 45;       // metri: sotto questa distanza sei alla fermata di salita
  const NAV_VELOCITA_PIEDI = 1.25;    // m/s, passo medio di una persona
  const NAV_ZOOM = 16.4;
  const NAV_ZOOM_GUIDA = 16.3;        // più vicino mentre si segue il percorso
  const NAV_ROTAZIONE_VELOCITA = 2.2; // m/s: sotto questa soglia la mappa resta a nord
  const NAV_INCLINAZIONE = 34;        // gradi di inclinazione durante la corsa

  // Icona dell'arrivo: una spunta, non un mezzo.
  const ICONA_FINE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  // Lo schermo deve restare acceso: senza wake lock il telefono si spegne e il
  // GPS smette di aggiornare proprio mentre si cammina.
  let svegliaNavigazione = null;

  function accendiSveglia() {
    if (!navigator.wakeLock || svegliaNavigazione) return;
    navigator.wakeLock.request('screen').then((blocco) => {
      svegliaNavigazione = blocco;
      blocco.addEventListener('release', () => { svegliaNavigazione = null; });
    }).catch(() => { /* browser che non lo consente: si prosegue */ });
  }

  function spegniSveglia() {
    if (!svegliaNavigazione) return;
    try { svegliaNavigazione.release(); } catch (errore) { /* già rilasciata */ }
    svegliaNavigazione = null;
  }

  // Tornando sull'app la sveglia va richiesta di nuovo: il browser la scioglie
  // quando la scheda va in background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigazione.attiva) accendiSveglia();
  });

  // Scrive solo se il testo cambia: la barra è una live region e riscriverla a
  // ogni fix GPS farebbe parlare lo screen reader senza motivo.
  function scriviTesto(id, valore) {
    const nodo = $(id);
    if (nodo && nodo.textContent !== valore) nodo.textContent = valore;
  }

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
    const destinazione = coordinataDi(sel.destinazione);
    const nomeDestinazione = sel.destinazione ? sel.destinazione.nome : '';
    if (routing.stato === 'piedi') {
      if (destinazione) {
        passi.push({ modo: 'piedi', azione: 'cammina', nome: nomeDestinazione, punto: destinazione });
      }
      return passi;
    }
    const esito = routing.esito;
    if (!esito || !esito.tappe || !esito.tappe.length) return passi;
    if (esito.camminoIniziale > 0) {
      const prima = esito.tappe[0].da ? coordinateFermata(esito.tappe[0].da) : null;
      if (prima) {
        passi.push({ modo: 'piedi', azione: 'cammina', fermata: true, nome: nomeFermata(esito.tappe[0].da), punto: prima });
      }
    }
    esito.tappe.forEach((tappa) => {
      const arrivo = coordinateFermata(tappa.a);
      if (!arrivo) return;
      const salita = tappa.da ? coordinateFermata(tappa.da) : null;
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      passi.push({
        modo: treno ? 'treno' : 'bus',
        azione: 'corsa',
        linea: tappa.linea,
        fermate: tappa.fermate,
        salita: salita,
        nomeSalita: tappa.da != null ? nomeFermata(tappa.da) : '',
        nome: nomeFermata(tappa.a),
        punto: arrivo
      });
    });
    if (esito.camminoFinale > 0 && destinazione) {
      passi.push({ modo: 'piedi', azione: 'cammina', nome: nomeDestinazione, punto: destinazione });
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

  // Cerchio di precisione attorno al punto GPS: 48 vertici bastano e non
  // pesano sul disegno. Il raggio è quello dichiarato dal fix, entro limiti
  // sensati (sotto i 20 m è rumore, sopra i 300 m è inutile).
  function cerchioPrecisione(lat, lon, raggio) {
    const punti = [];
    const latRad = (lat * Math.PI) / 180;
    for (let i = 0; i <= 48; i += 1) {
      const angolo = (i / 48) * Math.PI * 2;
      const dLat = (raggio * Math.cos(angolo)) / 111320;
      const dLon = (raggio * Math.sin(angolo)) / (111320 * Math.cos(latRad) || 1);
      punti.push([lon + dLon, lat + dLat]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [punti] } };
  }

  // Il pallino dell'utente resta sulla mappa finché il GPS è attivo: non solo
  // durante la navigazione, così ci si orienta anche prima di partire.
  function mostraPosizioneUtente(posizione) {
    const coords = posizione && posizione.coords;
    if (!coords) return;
    posizioneUtente = { lat: coords.latitude, lon: coords.longitude, precisione: coords.accuracy, ts: Date.now() };
    if (!mappa) return;
    const segnaposto = creaMarkerUtente();
    if (segnaposto) {
      segnaposto.setLngLat([coords.longitude, coords.latitude]);
      if (!markerUtenteAggiunto) { segnaposto.addTo(mappa); markerUtenteAggiunto = true; }
    }
    const sorgente = mappa.getSource('utente');
    if (sorgente) {
      const raggio = Math.max(20, Math.min(coords.accuracy || 30, 300));
      sorgente.setData({ type: 'FeatureCollection', features: [cerchioPrecisione(coords.latitude, coords.longitude, raggio)] });
    }
  }

  function avviaGps() {
    if (!navigator.geolocation || gpsWatch != null) return;
    gpsWatch = navigator.geolocation.watchPosition(
      mostraPosizioneUtente,
      () => { /* permesso negato: si resta senza pallino */ },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  // Un punto scelto a mano vale come un indirizzo: coordinate esatte per il
  // percorso, zona della fermata più vicina per il prezzo.
  function menuPunto(latlng) {
    if (!mappa || !window.maplibregl || !latlng) return;
    const lat = latlng.lat;
    const lon = latlng.lng;
    const vicina = fermateVicine(lat, lon, 1)[0];
    const nodo = document.createElement('div');
    nodo.className = 'punto-menu';
    nodo.innerHTML = '<button type="button" data-punto="partenza">Imposta come partenza</button>' +
      '<button type="button" data-punto="destinazione">Imposta come destinazione</button>';
    nodo.addEventListener('click', (evento) => {
      const scelta = evento.target.closest('[data-punto]');
      if (!scelta) return;
      if (popupPunto) { popupPunto.remove(); popupPunto = null; }
      selezionaFermata(scelta.getAttribute('data-punto'), {
        id: 'geo:' + lat.toFixed(5) + ',' + lon.toFixed(5),
        nome: 'Punto sulla mappa',
        indirizzo: lat.toFixed(5) + ', ' + lon.toFixed(5),
        lat: lat,
        lon: lon,
        zona: vicina ? vicina.zona : '500',
        tipo: 'indirizzo',
        genere: 'indirizzo',
        categoria: 'Punto sulla mappa'
      });
    });
    if (popupPunto) popupPunto.remove();
    popupPunto = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 4, className: 'punto-popup' })
      .setLngLat([lon, lat])
      .setDOMContent(nodo)
      .addTo(mappa);
  }

  function aggiornaNavFollow() {
    const centro = $('nav-centra');
    if (centro) centro.hidden = navigazione.follow;
  }

  // Segue il punto GPS. Se ci si muove abbastanza velocemente la mappa si
  // orienta nella direzione di marcia e si inclina, come nelle app di mappe;
  // a passo d'uomo resta a nord, così i nomi delle strade non girano.
  function inquadraNavigazione(punto, coords) {
    if (!mappa || !punto) return;
    const velocita = coords && isFinite(coords.speed) ? coords.speed : 0;
    const direzione = coords && coords.heading != null && isFinite(coords.heading) ? coords.heading : null;
    const guida = velocita > NAV_ROTAZIONE_VELOCITA && direzione != null;
    mappa.easeTo({
      center: [punto.lon, punto.lat],
      zoom: navigazione.inquadrato ? mappa.getZoom() : NAV_ZOOM_GUIDA,
      bearing: guida ? direzione : 0,
      pitch: guida ? NAV_INCLINAZIONE : 0,
      duration: navigazione.inquadrato ? 850 : 650
    });
    navigazione.inquadrato = true;
    navigazione.ultimoVolo = Date.now();
  }

  function centraNavigazione() {
    navigazione.follow = true;
    navigazione.inquadrato = false;
    navigazione.ultimoVolo = 0;
    aggiornaNavFollow();
    if (navigazione.ultima) inquadraNavigazione(navigazione.ultima, null);
    disegnaNavigazione();
  }

  // Segmenti del percorso sotto la barra: quanti passi sono fatti e quanti ne
  // restano, senza inventare una progressione metrica che non conosciamo.
  function segmentiProgresso() {
    const barra = $('nav-progresso');
    if (!barra) return;
    const passi = navigazione.passi || [];
    if (passi.length < 2) { barra.hidden = true; barra.innerHTML = ''; return; }
    const fatti = navigazione.arrivato ? passi.length : navigazione.indice;
    barra.hidden = false;
    if (barra.childElementCount !== passi.length) {
      barra.innerHTML = passi.map(() => '<i></i>').join('');
    }
    Array.prototype.forEach.call(barra.children, (segmento, i) => {
      const fatto = i < fatti;
      if (segmento.classList.contains('fatto') !== fatto) segmento.classList.toggle('fatto', fatto);
    });
  }

  // La barra in alto parla come un navigatore: cosa fare adesso, dove, quanto
  // manca. Per i mezzi il numero di fermate conta più dei metri in linea d'aria.
  function disegnaNavigazione() {
    if (!navigazione.attiva) return;
    const passi = navigazione.passi;
    const indice = Math.min(navigazione.indice, passi.length - 1);
    const passo = passi[indice];
    if (!passo) return;
    const distanza = distanzaInMetri(navigazione.ultima, passo.punto);
    const ultimo = indice >= passi.length - 1;
    const arrivato = ultimo && navigazione.ultima != null && distanza != null && distanza < NAV_SOGLIA;
    const inCorsa = passo.azione === 'corsa';
    const distanzaSalita = inCorsa && passo.salita && navigazione.ultima
      ? distanzaInMetri(navigazione.ultima, passo.salita)
      : null;
    const allaSalita = distanzaSalita != null && distanzaSalita < NAV_SOGLIA_SALITA;

    let titolo;
    let sotto;
    let destra;
    let icona;
    if (arrivato) {
      titolo = 'Sei arrivato';
      sotto = nomeFermataBreve(passo.nome, passo.modo);
      destra = '0 m';
      icona = ICONA_FINE;
      if (!navigazione.arrivato) {
        navigazione.arrivato = true;
        if (navigator.vibrate) { try { navigator.vibrate([90, 60, 90]); } catch (errore) { /* niente */ } }
      }
    } else if (!inCorsa) {
      titolo = passo.fermata ? 'Cammina fino alla fermata' : 'A piedi fino a';
      sotto = nomeFermataBreve(passo.nome, passo.modo);
      destra = navigazione.ultima ? metriTesto(distanza) : '…';
      icona = ICONA_PIEDANA;
    } else if (allaSalita) {
      titolo = 'Sali sul ' + (passo.modo === 'treno' ? 'treno ' : '') + passo.linea;
      sotto = 'Fermata ' + nomeFermataBreve(passo.nomeSalita, passo.modo);
      destra = 'Ora';
      icona = passo.modo === 'treno' ? ICONA_TRENO : ICONA_BUS;
    } else {
      titolo = 'Scendi a ' + nomeFermataBreve(passo.nome, passo.modo);
      const conto = passo.fermate > 1 ? passo.fermate + ' fermate' : '1 fermata';
      // La fermata di salita resta nel sottotitolo: se si è saliti da poco
      // aiuta a riconoscere la corsa giusta, senza ripetere "4 fermate".
      sotto = (passo.modo === 'treno' ? 'Treno ' : 'Bus ') + passo.linea +
        (passo.nomeSalita ? ' · da ' + nomeFermataBreve(passo.nomeSalita, passo.modo) : '');
      destra = conto;
      icona = passo.modo === 'treno' ? ICONA_TRENO : ICONA_BUS;
    }

    const nodoIcona = $('nav-ico');
    if (nodoIcona) {
      nodoIcona.className = 'nav-ico ' + (arrivato ? 'fine' : passo.modo);
      nodoIcona.innerHTML = icona;
    }
    scriviTesto('nav-titolo', titolo);
    scriviTesto('nav-sotto', sotto);
    scriviTesto('nav-distanza', destra);
    scriviTesto('nav-passo', passi.length > 1 ? (indice + 1) + ' di ' + passi.length : '');
    segmentiProgresso();

    // Arrivo previsto: a piedi si ricalcola dal punto in cui sei, con i mezzi
    // resta l'orario del viaggio scelto (è quello che conta per non perderlo).
    let minuti = null;
    if (routing.stato === 'piedi' && navigazione.ultima && distanza != null) {
      minuti = Math.max(1, Math.round(distanza / NAV_VELOCITA_PIEDI / 60));
      const adesso = new Date();
      const arrivoOra = new Date(adesso.getTime() + minuti * 60000);
      navigazione.arrivo = hhmm(arrivoOra.getHours() * 3600 + arrivoOra.getMinutes() * 60);
    } else if (routing.stato === 'ok' && routing.esito && routing.esito.arrivo != null) {
      const adesso = new Date();
      const ora = adesso.getHours() * 3600 + adesso.getMinutes() * 60 + adesso.getSeconds();
      minuti = Math.max(0, Math.round((routing.esito.arrivo + (routing.esito.camminoFinale || 0) - ora) / 60));
    }
    // A piedi si sa anche quanto manca: utile quando l'arrivo è vicino e il
    // tempo da solo non dice nulla.
    const resto = routing.stato === 'piedi' ? distanzaInMetri(navigazione.ultima, coordinataDi(sel.destinazione)) : null;
    const quando = minuti == null ? '' : ' · ' + (minuti < 1 ? 'meno di 1 min' : Utilita.durata(minuti));
    const quanto = resto == null ? '' : ' · ' + metriTesto(resto);
    scriviTesto('nav-eta', arrivato ? 'Arrivato' : (navigazione.arrivo || '—'));
    scriviTesto('nav-restanti', arrivato
      ? nomeLuogo(sel.destinazione)
      : 'arrivo previsto' + quando + quanto);
  }

  // Un passo alla volta: un fix solo non deve bruciare due istruzioni come
  // faceva il ciclo precedente, che poteva saltare una tappa intera.
  function avanzaPassi(punto) {
    const passi = navigazione.passi;
    const passo = passi[navigazione.indice];
    if (!passo) return;
    const distanza = distanzaInMetri(punto, passo.punto);
    if (distanza == null || distanza > NAV_SOGLIA) return;
    if (navigazione.indice < passi.length - 1) {
      navigazione.indice += 1;
      navigazione.arrivato = false;
    }
  }

  function aggiornaNavigazione(posizione) {
    if (!navigazione.attiva) return;
    const punto = { lat: posizione.coords.latitude, lon: posizione.coords.longitude };
    navigazione.precisione = isFinite(posizione.coords.accuracy) ? Math.round(posizione.coords.accuracy) : null;
    navigazione.ultima = punto;
    posizioneUtente = { lat: punto.lat, lon: punto.lon, ts: Date.now() };
    const marcatore = creaMarkerUtente();
    if (marcatore && mappa) {
      marcatore.setLngLat([punto.lon, punto.lat]).addTo(mappa);
      markerUtenteAggiunto = true;
      const sorgente = mappa.getSource('utente');
      if (sorgente && navigazione.precisione) {
        sorgente.setData({
          type: 'FeatureCollection',
          features: [cerchioPrecisione(punto.lat, punto.lon, Math.max(20, Math.min(navigazione.precisione, 300)))]
        });
      }
    }
    avanzaPassi(punto);
    avvisaDiscesa(punto);
    if (mappa && navigazione.follow) {
      const adesso = Date.now();
      // La mappa si muove solo quando serve: un easeTo a ogni fix GPS
      // renderebbe il trascinamento impossibile.
      if (!navigazione.inquadrato || adesso - navigazione.ultimoVolo > 1200) {
        inquadraNavigazione(punto, posizione.coords);
      }
    }
    disegnaNavigazione();
  }

  // Una fermata prima della discesa: vibrazione breve e testo per chi usa il
  // lettore di schermo. Ripetuta una volta sola per ogni fermata di discesa.
  function avvisaDiscesa(punto) {
    const passo = navigazione.passi[navigazione.indice];
    if (!passo || passo.azione !== 'corsa' || !passo.punto) return;
    const distanza = distanzaMetri(punto, passo.punto);
    if (distanza > 250) return;
    const chiave = passo.linea + '@' + passo.nome;
    if (navigazione.discesaAvvisata === chiave) return;
    navigazione.discesaAvvisata = chiave;
    if (navigator.vibrate) {
      try { navigator.vibrate([90, 60, 90]); } catch (errore) { /* niente vibrazione */ }
    }
    const sotto = $('nav-sotto');
    if (sotto) sotto.textContent = 'Scendi alla prossima: ' + nomeFermataBreve(passo.nome, passo.modo);
    // A schermo spento o app in background la vibrazione da sola non basta.
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      void mostraNotifica('Scendi alla prossima',
        nomeFermataBreve(passo.nome, passo.modo) + ' · ' + (passo.modo === 'treno' ? 'treno ' : 'bus ') + passo.linea,
        '', 'discesa-' + chiave);
    }
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
    // Navigazione nuova, avviso nuovo: anche se la fermata di discesa è la
    // stessa del viaggio precedente, la vibrazione deve rifarsi sentire.
    navigazione.discesaAvvisata = null;
    navigazione.follow = true;
    navigazione.inquadrato = false;
    // Se il GPS ha già un fix si parte da lì, senza aspettare il primo
    // aggiornamento per vedere la mappa centrata e la distanza giusta.
    navigazione.ultima = posizioneUtente ? { lat: posizioneUtente.lat, lon: posizioneUtente.lon } : null;
    navigazione.ultimoVolo = 0;
    navigazione.arrivato = false;
    navigazione.arrivo = arrivoPrevisto(passi);
    chiudiOverlay();
    document.body.classList.add('in-navigazione');
    // La scheda è nascosta: FAB, sfumatura e attribution seguono il pannello.
    document.documentElement.style.setProperty('--h-sheet', '128px');
    $('nav').hidden = false;
    $('nav-fondo').hidden = false;
    aggiornaNavFollow();
    disegnaNavigazione();
    if (navigazione.ultima) inquadraNavigazione(navigazione.ultima, null);
    aggiornaVisibilitaFermate();
    accendiSveglia();
    navigazione.watchId = navigator.geolocation.watchPosition(aggiornaNavigazione, erroreNavigazione, {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 2000
    });
  }

  function fermaNavigazione(silenzioso) {
    if (!navigazione.attiva) return;
    navigazione.attiva = false;
    spegniSveglia();
    if (navigazione.watchId != null) {
      try { navigator.geolocation.clearWatch(navigazione.watchId); } catch (e) { /* già fermo */ }
      navigazione.watchId = null;
    }
    if (markerUtente) {
      markerUtente.remove();
      markerUtente = null;
    }
    navigazione.passi = [];
    navigazione.indice = 0;
    navigazione.discesaAvvisata = null;
    navigazione.arrivato = false;
    navigazione.inquadrato = false;
    document.body.classList.remove('in-navigazione');
    $('nav').hidden = true;
    $('nav-fondo').hidden = true;
    segmentiProgresso();
    // La mappa torna piana e a nord: inclinazione e rotazione erano solo per
    // la guida.
    if (mappa) mappa.easeTo({ bearing: 0, pitch: 0, duration: durataMovimento(400) });
    impostaSheet(statoSheet);
    aggiornaVisibilitaFermate();
    if (!silenzioso) mostraToast('Navigazione terminata');
  }

  /* ------------------------------------------------------------------ *
   * Ricerca e selettore fermate
   * ------------------------------------------------------------------ */
  // Il motivo per cui una fermata è suggerita: "a 200 m da te", "ultima
  // usata". Un suggerimento senza spiegazione è solo una lista più lunga.
  function motivoVoce(f, titolo, indice) {
    if (titolo === 'Recenti') return indice === 0 ? 'ultima usata' : 'usata di recente';
    if (titolo === 'Vicine a te' && posizioneUtente) {
      return 'a ' + metriTesto(distanzaMetri(posizioneUtente, f)) + ' da te';
    }
    if (titolo === 'Vicine alla partenza' && sel.partenza) {
      return 'a ' + metriTesto(distanzaMetri(sel.partenza, f)) + ' dalla partenza';
    }
    return '';
  }

  // Il comune davanti al nome è lo stesso per metà lista e mangia lo spazio
  // utile: si toglie dal nome della maggioranza dei risultati, e resta intero
  // sulle righe di comuni diversi, che altrimenti non si distinguerebbero.
  function prefissoComune(nome) {
    const i = String(nome).indexOf(' - ');
    return i > 0 ? String(nome).slice(0, i) : '';
  }

  // Il nome completo del dataset è «Comune - Nome della fermata»: per le
  // fermate bus in elenco interessa solo la parte specifica, mentre il comune
  // resta nel dettaglio. Per le stazioni il nome davanti è parte del nome
  // (Casteldebole - Stazione), quindi si tiene tutto.
  function nomeFermataBreve(nome, tipo) {
    const testo = String(nome || '');
    // Il tipo manca nei passi a piedi e nei vecchi salvataggi: il suffisso
    // «- Stazione» basta a riconoscere una stazione anche in quei casi.
    if (tipo === 'treno' || tipo === 'entrambi' || /\s-\sStazione\s*$/i.test(testo)) return testo;
    const i = testo.indexOf(' - ');
    return i > 0 ? testo.slice(i + 3) : testo;
  }

  function dettaglioFermata(f) {
    if (!f || eIndirizzo(f)) return f ? (f.indirizzo || '') : '';
    return [prefissoComune(f.nome), f.indirizzo].filter(Boolean).join(' · ');
  }

  function nomeLuogo(luogo) {
    if (!luogo) return '';
    return eIndirizzo(luogo) ? luogo.nome : nomeFermataBreve(luogo.nome, luogo.tipo);
  }

  function nomiCompatti(items) {
    const mappa = new Map();
    items.forEach((f) => mappa.set(f.id, nomeFermataBreve(f.nome, f.tipo)));
    return mappa;
  }

  function voceHTML(f, ruolo, motivo, rimuovi, nome) {
    const classe = classeTipo(f.tipo);
    const mostrato = nome || nomeLuogo(f);
    const dettaglio = dettaglioFermata(f);
    const bottone = '<button class="voce" role="option" data-voce="' + esc(f.id) + '" data-ruolo="' + esc(ruolo) + '">' +
      '<span class="voce-ico ' + classe + '">' + iconaTipo(f.tipo) + '</span>' +
      '<span class="voce-testo"><span class="voce-nome"' +
      (mostrato === f.nome ? '' : ' title="' + esc(f.nome) + '"') + '>' + esc(mostrato) + '</span>' +
      (dettaglio ? '<span class="voce-indirizzo">' + esc(dettaglio) + '</span>' : '') +
      '<span class="voce-meta">' + esc(metaFermata(f)) + '</span>' +
      (motivo ? '<span class="voce-motivo">' + esc(motivo) + '</span>' : '') +
      '</span>' +
      (rimuovi ? '' : ICONA_PIU) +
      '</button>';
    if (!rimuovi) return bottone;
    // Niente bottoni dentro bottoni: la X dei recenti è un fratello della voce.
    return '<div class="voce-con-rimuovi" style="display:flex;align-items:center;gap:4px">' + bottone +
      '<button type="button" class="voce-rimuovi" data-rimuovi="' + esc(f.id) + '" aria-label="Rimuovi ' +
      esc(nomeFermataBreve(f.nome, f.tipo)) + ' dai recenti">' + ICONA_X + '</button></div>';
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

  function gruppiFermate(query, campo) {
    const risultati = cercaFermate(query);
    const centro = centroRicerca(campo);
    if (centro && risultati.length) {
      const espanso = Utilita.espandi ? Utilita.espandi(query) : query;
      const q = normalizza(espanso);
      // Il dataset antepone il comune ("Porretta Terme - Berzantina"): per la
      // ricerca conta il nome breve, altrimenti ogni fermata del comune
      // sembrerebbe cercata per nome. Il nome completo vale solo se coincide.
      const prefisso = (f) => normalizza(nomeLuogo(f)).indexOf(q) === 0 ||
        normalizza(f.nome) === q;
      const vicini = risultati
        .map((f) => ({ f: f, d: distanzaMetri(centro, f), prima: prefisso(f) }))
        // Le fermate che contengono la parola ma stanno dall'altra parte della
        // regione non aiutano: restano solo quelle vicine, mentre una fermata
        // cercata per nome resta trovabile anche se è lontana.
        .filter((voce) => voce.prima || voce.d <= 25000)
        .sort((a, b) => (Number(b.prima) - Number(a.prima)) || a.d - b.d)
        .slice(0, 6)
        .map((voce) => voce.f);
      return vicini.length ? [{ titolo: 'Fermate', items: vicini }] : [];
    }
    return risultati.length ? [{ titolo: 'Fermate', items: risultati }] : [];
  }

  /* --- Luoghi e indirizzi: pertinenza e vicinanza -------------------
   * Nominatim non ha un "vicino a me": si cerca prima in un riquadro
   * attorno alla partenza, al GPS o al centro della mappa e, solo se non
   * trova nulla, si allarga all'area servita dal bacino TPER. Così
   * "farmacia" restituisce le farmacie vicine, mentre "Porretta Terme"
   * continua a funzionare anche cercando da Bologna. I risultati vengono
   * poi riordinati per corrispondenza e distanza, non nell'ordine grezzo
   * del servizio.
   */
  function normalizzaRicerca(testo) {
    return normalizza(testo).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function centroRicerca(campo) {
    if (campo === 'destinazione' && sel.partenza && sel.partenza.lat != null && sel.partenza.lon != null) {
      return { lat: sel.partenza.lat, lon: sel.partenza.lon };
    }
    if (posizioneUtente && posizioneUtente.lat != null && posizioneUtente.lon != null &&
        (!posizioneUtente.ts || Date.now() - posizioneUtente.ts < 10 * 60 * 1000)) {
      return { lat: posizioneUtente.lat, lon: posizioneUtente.lon };
    }
    if (mappa && typeof mappa.getCenter === 'function') {
      const centro = mappa.getCenter();
      if (centro && isFinite(centro.lat) && isFinite(centro.lng)) {
        return { lat: centro.lat, lon: centro.lng };
      }
    }
    return null;
  }

  function viewboxLocale(centro) {
    const lat = 0.09;
    const lon = 0.12;
    return [centro.lon - lon, centro.lat + lat, centro.lon + lon, centro.lat - lat].join(',');
  }

  // Pertinenza testuale (nome, indirizzo, categoria) + vicinanza. Un nome
  // esatto batte un risultato generico lontano; a parità, vince il più vicino.
  function punteggioLuogo(luogo, queryNorm, centro) {
    const nome = normalizzaRicerca(luogo.nome);
    const contesto = normalizzaRicerca(luogo.indirizzo);
    const categoria = normalizzaRicerca(luogo.categoria);
    const testo = nome + ' ' + contesto + ' ' + categoria;
    let punteggio = 0;
    if (categoria === queryNorm) {
      // Ricerca per categoria ("farmacia", "bar", "parco"): conta soprattutto
      // la vicinanza, non il nome del singolo esercizio. È la differenza tra
      // una lista di nomi in ordine alfabetico e i risultati di Maps.
      if (nome === queryNorm) punteggio += 4;
      else if (nome.indexOf(queryNorm) === 0) punteggio += 2;
      else if (nome.indexOf(queryNorm) >= 0) punteggio += 1;
      punteggio += 40;
    } else {
      if (nome === queryNorm) punteggio += 120;
      else if (nome.indexOf(queryNorm) === 0) punteggio += 80;
      else if (nome.indexOf(queryNorm) >= 0) punteggio += 45;
      if (contesto.indexOf(queryNorm) >= 0) punteggio += 25;
      if (categoria.indexOf(queryNorm) >= 0) punteggio += 20;
    }
    const parole = queryNorm.split(' ').filter(Boolean);
    if (parole.length) {
      const coperte = parole.filter((parola) => testo.indexOf(parola) >= 0).length;
      punteggio += (coperte / parole.length) * 25;
    }
    if (/\d/.test(queryNorm) && luogo.genere === 'indirizzo') punteggio += 12;
    punteggio += Math.min(15, (Number(luogo.importanza) || 0) * 15);
    if (centro && luogo.distanza != null && isFinite(luogo.distanza)) {
      punteggio += Math.max(0, 30 - luogo.distanza / 150);
    }
    return punteggio;
  }

  function stessaVoceLuogo(a, b) {
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return false;
    const distanza = distanzaMetri(a, b);
    if (distanza < 8) return true;
    if (normalizzaRicerca(a.nome) !== normalizzaRicerca(b.nome)) return false;
    if (a.genere === 'indirizzo' && b.genere === 'indirizzo') return distanza < 300;
    return distanza < 50;
  }

  function ordinaLuoghi(luoghi, testo, campo) {
    const elenco = Array.isArray(luoghi) ? luoghi : [];
    const centro = centroRicerca(campo);
    const queryNorm = normalizzaRicerca(testo);
    const copia = elenco.map((luogo) => {
      const distanza = centro && luogo.lat != null && luogo.lon != null
        ? Math.round(distanzaMetri(centro, { lat: luogo.lat, lon: luogo.lon }))
        : (Number.isFinite(luogo.distanza) ? luogo.distanza : null);
      return Object.assign({}, luogo, { distanza: distanza });
    });
    copia.forEach((luogo) => { luogo.punteggio = punteggioLuogo(luogo, queryNorm, centro); });
    copia.sort((a, b) => (
      b.punteggio - a.punteggio ||
      (a.distanza == null ? Infinity : a.distanza) - (b.distanza == null ? Infinity : b.distanza)
    ));
    const unici = [];
    copia.forEach((luogo) => {
      if (unici.some((altro) => stessaVoceLuogo(altro, luogo))) return;
      unici.push(luogo);
    });
    return unici.slice(0, LUOGHI_MAX).map((luogo) => {
      const pulito = Object.assign({}, luogo);
      delete pulito.punteggio;
      return pulito;
    });
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
    const distanza = luogo.distanza != null && isFinite(luogo.distanza) ? metriTesto(luogo.distanza) : '';
    const meta = [categoria, distanza, luogo.zona ? 'zona ' + luogo.zona : ''].filter(Boolean).join(' · ');
    return '<button class="voce" role="option" data-indirizzo="1" data-lat="' + luogo.lat + '" data-lon="' + luogo.lon +
      '" data-nome="' + esc(luogo.nome) + '" data-dettaglio="' + esc(luogo.indirizzo || '') +
      '" data-genere="' + genere + '" data-categoria="' + esc(categoria) + '" data-ruolo="' + esc(ruolo) + '">' +
      '<span class="voce-ico ' + (genere === 'luogo' ? 'luogo' : 'geo') + '">' + ICONA_LUOGO + '</span>' +
      '<span class="voce-testo"><span class="voce-nome">' + esc(luogo.nome) + '</span>' +
      (luogo.indirizzo ? '<span class="voce-indirizzo">' + esc(luogo.indirizzo) + '</span>' : '') +
      '<span class="voce-meta">' + esc(meta) + '</span></span>' +
      ICONA_PIU +
      '</button>';
  }

  function skeletonRighe(quante) {
    let html = '';
    for (let i = 0; i < quante; i += 1) {
      html += '<div class="skeleton-riga" aria-hidden="true"><span></span><span></span><span></span></div>';
    }
    return html;
  }

  function chipSuggerimento(testo) {
    return '<button type="button" class="chip-suggerimento" data-chip="' + esc(testo) + '">' + esc(testo) + '</button>';
  }

  // Cose che esistono davvero a Bologna, per quando la ricerca non trova nulla.
  const CHIP_RICERCA = ['Piazza Maggiore', 'Stazione Centrale', 'via Zamboni', "Ospedale Sant'Orsola"];

  function disegnaSuggerimenti() {
    const lista = $('overlay-lista');
    if (!lista) return;
    lista.setAttribute('aria-busy', suggerimenti.caricamento ? 'true' : 'false');
    const campo = suggerimenti.campo || 'destinazione';
    let html = '';
    // La posizione attuale è la prima voce quando si sceglie da dove partire:
    // coordinate esatte, non la palina più vicina.
    if (campo === 'partenza' && posizioneUtente) {
      html += '<button class="voce" role="option" data-posizione="1" data-ruolo="partenza">' +
        '<span class="voce-ico geo">' + ICONA_MIRINO + '</span>' +
        '<span class="voce-testo"><span class="voce-nome">La mia posizione attuale</span>' +
        '<span class="voce-motivo">GPS · coordinate esatte</span></span>' + ICONA_PIU + '</button>';
    }
    html += suggerimenti.gruppi.map((gruppo) => {
      const recenti = gruppo.titolo === 'Recenti';
      const modifica = recenti && suggerimenti.modifica;
      const testa = recenti
        ? '<div class="gruppo-riga"><div class="gruppo-titolo">Recenti</div>' +
          '<button type="button" class="link-mini" data-azione="modifica-recenti">' +
          (modifica ? 'Fine' : 'Modifica') + '</button></div>'
        : '<div class="gruppo-titolo">' + esc(gruppo.titolo) + '</div>';
      const nomi = nomiCompatti(gruppo.items);
      return testa + gruppo.items.map((f, indice) =>
        voceHTML(f, campo, motivoVoce(f, gruppo.titolo, indice), modifica, nomi.get(f.id))
      ).join('');
    }).join('');
    if (suggerimenti.linee.length) {
      html += '<div class="gruppo-titolo">Linee</div>' + suggerimenti.linee.map((linea) =>
        '<button type="button" class="voce" role="option" data-linea="' + esc(linea.nome) + '">' +
        '<span class="voce-ico">' + (linea.tipo === 1 || linea.tipo === 2 ? ICONA_TRENO : ICONA_BUS) + '</span>' +
        '<span class="voce-testo"><span class="voce-nome">Linea ' + esc(linea.nome) + '</span>' +
        '<span class="voce-motivo">' + esc(linea.capolinea.slice(0, 3).join(' · ') +
          (linea.capolinea.length > 3 ? ' · +' + (linea.capolinea.length - 3) : '') || 'Nessuna direzione') +
        '</span></span>' + ICONA_PIU + '</button>'
      ).join('');
    }
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
      html += '<div class="gruppo-titolo">Luoghi e indirizzi</div>' + skeletonRighe(3);
    }
    if (suggerimenti.errore) {
      html += '<p class="testo-intro" style="padding:8px 10px 12px">Ricerca di luoghi e indirizzi non disponibile: le fermate qui sopra funzionano lo stesso.</p>';
    }
    if (!html) {
      // Nessun risultato: si suggerisce cosa cercare, invece di lasciare un
      // testo fermo. Le chip riempiono il campo e rilanciano la ricerca.
      html = '<p class="testo-intro" style="padding:12px 4px 6px">Nessun risultato per “' +
        esc(suggerimenti.query) + '”. Prova con:</p>' +
        '<div>' + CHIP_RICERCA.map(chipSuggerimento).join('') + '</div>';
    }
    lista.innerHTML = html;
  }

  function urlNominatim(testo, viewbox) {
    return NOMINATIM + '?format=jsonv2&addressdetails=1&namedetails=1&limit=' + LUOGHI_MAX +
      '&dedupe=1&accept-language=it&countrycodes=it' +
      '&viewbox=' + viewbox + '&bounded=1&q=' + encodeURIComponent(testo);
  }

  async function scaricaNominatim(url, token) {
    // Nominatim consente una richiesta al secondo: si aspetta il turno e si
    // annulla la richiesta precedente appena parte una ricerca nuova.
    const attesa = Math.max(0, ultimaRichiestaIndirizzi + NOMINATIM_PAUSA - Date.now());
    if (attesa) await new Promise((risolvi) => setTimeout(risolvi, attesa));
    if (token !== suggerimenti.token) return null;
    ultimaRichiestaIndirizzi = Date.now();
    if (indirizziAbort) indirizziAbort.abort();
    indirizziAbort = new AbortController();
    const risposta = await fetch(url, {
      signal: segnaleConTimeout(indirizziAbort.signal, TIMEOUT_NOMINATIM),
      headers: { Accept: 'application/json' }
    });
    if (!risposta.ok) throw new Error('Nominatim: ' + risposta.status);
    const elenco = await risposta.json();
    return Array.isArray(elenco) ? elenco : [];
  }

  async function chiediIndirizzi(testo, token) {
    const centro = centroRicerca(suggerimenti.campo);
    // Prima il quartiere: è quello che rende la ricerca simile a Maps quando
    // si cerca "farmacia" o "bar". Se il riquadro locale non ha nulla
    // (per esempio "Porretta Terme" cercata da Bologna), si allarga.
    let elenco = centro ? await scaricaNominatim(urlNominatim(testo, viewboxLocale(centro)), token) : [];
    if (elenco === null) return null;
    if (!elenco.length) {
      elenco = await scaricaNominatim(urlNominatim(testo, NOMINATIM_VIEWBOX), token);
      if (elenco === null) return null;
    }
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
        categoria: categoria,
        importanza: Number(voce.importance) || 0
      });
    });
    return ordinaLuoghi(trovati, testo, suggerimenti.campo);
  }

  function cercaIndirizzi(testo) {
    const chiave = normalizzaRicerca(testo);
    const token = suggerimenti.token + 1;
    suggerimenti.token = token;
    suggerimenti.errore = false;
    if (indirizziAbort) { indirizziAbort.abort(); indirizziAbort = null; }
    if (indirizziCache.has(chiave)) {
      suggerimenti.indirizzi = ordinaLuoghi(indirizziCache.get(chiave), testo, suggerimenti.campo);
      suggerimenti.caricamento = false;
      disegnaSuggerimenti();
      return;
    }
    // Cache su disco: un indirizzo già cercato torna subito, anche offline,
    // senza una nuova richiesta al servizio gratuito di OpenStreetMap.
    const salvati = leggiIndirizziCache(chiave);
    if (salvati) {
      indirizziCache.set(chiave, salvati);
      suggerimenti.indirizzi = ordinaLuoghi(salvati, testo, suggerimenti.campo);
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
      salvaIndirizziCache(chiave, esiti);
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

  function muoviFocusSuggerimenti(direzione) {
    const lista = $('overlay-lista');
    if (!lista) return;
    const voci = Array.prototype.slice.call(lista.querySelectorAll(
      'button[data-voce], button[data-linea], button[data-indirizzo], button[data-posizione]'
    ));
    if (!voci.length) return;
    const attuale = voci.indexOf(document.activeElement);
    const prossimo = direzione > 0
      ? (attuale < 0 ? 0 : Math.min(voci.length - 1, attuale + 1))
      : (attuale <= 0 ? voci.length - 1 : attuale - 1);
    voci[prossimo].focus();
  }

  // La ricerca è una schermata intera: il campo ha il focus e la lista usa
  // tutto lo spazio, invece di un pannello che copre il testo mentre si scrive.
  function apriCerca(ruolo) {
    campoAttivo = ruolo;
    const schermo = $('cerca');
    const input = $('cerca-input');
    if (!schermo || !input) return;
    input.value = sel[ruolo] ? sel[ruolo].nome : '';
    input.placeholder = ruolo === 'partenza' ? 'Da dove parti?' : 'Dove vai?';
    schermo.hidden = false;
    aggiornaPulisci();
    apriSuggerimenti(ruolo, input.value);
    preparaLinee();
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  function apriSuggerimenti(campo, query) {
    campoAttivo = campo;
    const testo = (query || '').trim();
    suggerimenti.campo = campo;
    suggerimenti.query = testo;
    suggerimenti.indirizzi = [];
    suggerimenti.errore = false;
    suggerimenti.caricamento = false;
    suggerimenti.linee = testo.length >= 1 ? lineeSuggerite(testo) : [];
    if (testo.length >= 1) preparaLinee();
    if (testo.length >= 2) {
      suggerimenti.gruppi = gruppiFermate(testo, campo);
    } else {
      suggerimenti.gruppi = gruppiSuggerimenti(campo);
    }
    if (testo.length >= LUOGHI_MIN) {
      cercaIndirizzi(testo);
    } else {
      // Anche con due caratteri una richiesta precedente va annullata: altrimenti
      // i risultati di "via" arriverebbero mentre l'utente ha già scritto "vi".
      suggerimenti.token += 1;
      if (indirizziAbort) { indirizziAbort.abort(); indirizziAbort = null; }
      disegnaSuggerimenti();
    }
  }

  function chiudiOverlay() {
    preferitoInCorso = null;
    if (voceAscolto) {
      try { voceAscolto.abort(); } catch (errore) { /* già fermo */ }
      voceAscolto = null;
    }
    suggerimenti.token += 1;
    if (indirizziAbort) { indirizziAbort.abort(); indirizziAbort = null; }
    const schermo = $('cerca');
    if (schermo) schermo.hidden = true;
    const input = $('cerca-input');
    if (input) input.blur();
  }

  /* --- Impostazioni tecniche ---------------------------------------------
   * Non stanno nel menu: si aprono solo scrivendo «admin» nella ricerca, che
   * è la stessa per partenza e destinazione.
   */
  function apriAdmin() {
    const pannello = $('admin');
    if (!pannello) return;
    campoAttivo = null;
    const proxy = $('input-proxy');
    if (proxy) proxy.value = leggi(K_PROXY) || '';
    renderEvitate();
    pannello.hidden = false;
    const chiudi = $('admin-chiudi');
    if (chiudi) chiudi.focus();
  }

  function chiudiAdmin() {
    const pannello = $('admin');
    if (pannello) pannello.hidden = true;
  }

  // Le stesse azioni servono al menu e al pannello tecnico: una sola copia.
  function rimuoviLineaEvitata(linea) {
    if (!linea) return;
    impostaLineeEvitate(lineeEvitate().filter((voce) => voce !== linea));
    mostraToast('Linea ' + linea + ' di nuovo proposta');
  }

  function aggiungiLineaEvitata() {
    const campo = $('input-evita');
    const valore = (campo && campo.value ? campo.value : '').trim().toUpperCase();
    if (!valore) return;
    if (!/^[A-Z0-9]{1,5}$/.test(valore)) {
      mostraToast('Numero di linea non valido');
      return;
    }
    impostaLineeEvitate(lineeEvitate().concat(valore));
    if (campo) campo.value = '';
    mostraToast('Linea ' + valore + ' esclusa dai percorsi');
  }

  function salvaProxy() {
    const campo = $('input-proxy');
    const valore = (campo && campo.value ? campo.value : '').trim();
    if (valore) scrivi(K_PROXY, valore); else localStorage.removeItem(K_PROXY);
    live.items = []; live.ts = 0; live.stato = 'idle';
    mostraToast(valore ? 'Relay salvato' : 'Relay predefinito ripristinato');
    caricaLive(true);
  }

  function aggiornaPulisci() {
    const pulsante = $('cerca-pulisci');
    const input = $('cerca-input');
    if (pulsante && input) pulsante.hidden = !input.value;
  }

  // I campi del pannello mostrano il valore scelto: non sono input, quindi
  // nessuna tastiera si apre quando si guarda la tratta.
  function impostaInput(ruolo) {
    const valore = $(ruolo === 'partenza' ? 'val-partenza' : 'val-destinazione');
    if (!valore) return;
    const f = sel[ruolo];
    valore.textContent = f ? nomeLuogo(f) : (ruolo === 'partenza' ? 'Da dove parti?' : 'Dove vai?');
    valore.classList.toggle('vuoto', !f);
  }

  function selezionaFermata(ruolo, f) {
    if (navigazione.attiva) fermaNavigazione(true);
    // Se si sceglie una fermata dagli orari o dalla linea, si torna al
    // percorso: l'URL non deve portarsi dietro la vista precedente.
    if (vistaAttiva !== 'percorso') mostraVista('percorso');
    sel[ruolo] = f;
    impostaInput(ruolo);
    if (!eIndirizzo(f)) aggiungiRecente(f);
    chiudiOverlay();
    aggiornaMarker();
    salvaTratta();
    // Una voce di cronologia per ogni scelta: il tasto indietro ripristina la
    // ricerca di prima (solo partenza, oppure il viaggio precedente).
    aggiornaUrl('push');
    live.fermata = null;
    live.items = [];
    live.ts = 0;
    live.stato = 'idle';
    if (!sel.partenza || !sel.destinazione) {
      impostaSheet('meta');
      renderPercorso();
      setTimeout(() => apriCerca(sel.partenza ? 'destinazione' : 'partenza'), 160);
      return;
    }
    stopLiveRuolo = ruolo;
    salvaQuando();
    mostraVista('percorso');
    impostaSheet('meta');
    inquadra();
    renderPercorso();
    calcolaPercorso();
    const corpo = $('sheet-corpo');
    if (corpo) corpo.scrollTop = 0;
  }

  // Le fermate si salvano per id, gli indirizzi per coordinate (l'id è finto).
  function luogoSalvato(luogo) {
    if (!luogo) return null;
    // Le coordinate del GPS non si salvano: si salvano solo fermate, indirizzi
    // e punti scelti a mano (privacy, come da vincoli).
    if (luogo.gps) return null;
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

  // Viaggi completi salvati dall'utente: partenza, destinazione, ora e modo.
  // Restano locali, come preferiti e fermate fissate.
  function viaggiSalvati() {
    const elenco = leggiJSON(K_VIAGGI);
    return Array.isArray(elenco) ? elenco.filter((voce) => voce && voce.destinazione) : [];
  }

  function etichettaViaggio(voce) {
    const da = voce.partenza ? nomeLuogo(voce.partenza) : 'La mia posizione';
    return da + ' → ' + nomeLuogo(voce.destinazione);
  }

  function salvaViaggio() {
    if (!sel.partenza || !sel.destinazione) {
      mostraToast('Scegli partenza e destinazione prima di salvare');
      return;
    }
    const partenza = luogoSalvato(sel.partenza);
    const destinazione = luogoSalvato(sel.destinazione);
    if (!destinazione) {
      mostraToast('Questa destinazione non si può salvare');
      return;
    }
    const voce = {
      id: Date.now().toString(36),
      partenza: partenza,
      destinazione: destinazione,
      orario: routing.orario || oraAdesso(),
      modo: routing.modo === 'arrivo' ? 'arrivo' : 'partenza'
    };
    const elenco = viaggiSalvati().filter((salvato) =>
      (salvato.destinazione.id !== destinazione.id) ||
      ((salvato.partenza && salvato.partenza.id) || '') !== ((partenza && partenza.id) || '') ||
      salvato.orario !== voce.orario || salvato.modo !== voce.modo);
    elenco.unshift(voce);
    scrivi(K_VIAGGI, JSON.stringify(elenco.slice(0, 5)));
    sincronizzaMenu();
    mostraToast('Viaggio salvato');
  }

  function rimuoviViaggio(id) {
    scrivi(K_VIAGGI, JSON.stringify(viaggiSalvati().filter((voce) => voce.id !== id)));
    sincronizzaMenu();
  }

  function renderViaggi() {
    const box = $('menu-viaggi');
    if (!box) return;
    const elenco = viaggiSalvati();
    box.innerHTML = elenco.length
      ? elenco.map((voce) => '<div class="menu-pref-riga">' +
          '<button type="button" class="menu-pref" data-viaggio="' + esc(voce.id) + '">' +
          '<span class="spazio">' + esc(etichettaViaggio(voce)) + '</span>' +
          '<span class="nota">' + esc(voce.orario) + (voce.modo === 'arrivo' ? ' · arrivo' : '') + '</span></button>' +
          '<button type="button" class="menu-pref-rimuovi" data-rimuovi-viaggio="' + esc(voce.id) +
          '" aria-label="Rimuovi ' + esc(etichettaViaggio(voce)) + '">' + Icone.svg('x', 15) + '</button></div>').join('')
      : '<p class="menu-sezione" style="padding-top:0">Nessun viaggio salvato.</p>';
  }

  function apriViaggioSalvato(id) {
    const voce = viaggiSalvati().filter((salvato) => salvato.id === id)[0];
    if (!voce) return;
    chiudiMenu();
    sel.partenza = luogoRipristinato(voce.partenza);
    sel.destinazione = luogoRipristinato(voce.destinazione);
    if (!sel.destinazione) return;
    impostaInput('partenza');
    impostaInput('destinazione');
    aggiornaMarker();
    salvaTratta();
    routing.modo = voce.modo === 'arrivo' ? 'arrivo' : 'partenza';
    routing.giorno = oggiISO();
    routing.orario = voce.orario || oraAdesso();
    const quando = dataDaGiornoEOra(routing.giorno, routing.orario);
    if (quando.getTime() < Date.now() - 5 * 60000) {
      if (routing.modo === 'arrivo') {
        const traUnOra = new Date(Date.now() + 60 * 60000);
        traUnOra.setMinutes(Math.ceil(traUnOra.getMinutes() / 5) * 5, 0, 0);
        routing.giorno = isoDi(traUnOra);
        routing.orario = due(traUnOra.getHours()) + ':' + due(traUnOra.getMinutes());
      } else {
        routing.orario = oraAdesso();
      }
    }
    routing.adesso = routing.modo === 'partenza' && routing.orario === oraAdesso();
    routing.chiave = null;
    salvaQuando();
    mostraVista('percorso');
    impostaSheet('meta');
    renderPercorso();
    inquadra();
    if (sel.partenza) calcolaPercorso();
    else setTimeout(partenzaDallaPosizione, 200);
  }

  /* ------------------------------------------------------------------ *
   * Calcolo zone e prezzo
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * Rendering: pannello percorso
   * ------------------------------------------------------------------ */
  // Quanto pannello resta visibile nella posizione ridotta: due campi, la
  // riga di data/ora e il pulsante di ricerca.
  // PEEK mostra i due campi e la riga data/ora interi: con i controlli a 44px
  // servono 168 + qualche pixel di margine.
  const PEEK_VISIBILE = 174;
  let quandoAperto = false;
  let alternativeAperte = false;

  function quandoEtichetta() {
    const d = dataDaGiorno(routing.giorno);
    const oggi = routing.giorno === oggiISO();
    const giorno = oggi ? 'Oggi' : (d ? d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : routing.giorno);
    // "Adesso" implica già oggi: ripetere "Oggi" allunga l'etichetta senza dire nulla.
    if (routing.adesso) return routing.orario ? 'Adesso · ' + routing.orario : 'Adesso';
    return (routing.modo === 'arrivo' ? 'Arrivo entro ' : 'Partenza ') + giorno + ' ' + routing.orario;
  }

  function rigaCampoHTML(ruolo) {
    const f = sel[ruolo];
    const eti = ruolo === 'partenza' ? 'Partenza' : 'Destinazione';
    const vuoto = ruolo === 'partenza' ? 'Da dove parti?' : 'Dove vai?';
    return '<div class="campo-riga">' +
      '<span class="pallino ' + (ruolo === 'partenza' ? 'pallino-p' : 'pallino-d') + '" aria-hidden="true"></span>' +
      '<button type="button" class="campo" data-campo="' + ruolo + '"' +
      (f ? ' title="' + esc(f.nome) + '"' : '') + '>' +
      '<span class="eti">' + eti + '</span>' +
      '<span class="val' + (f ? '' : ' vuoto') + '" id="val-' + ruolo + '">' + esc(f ? nomeLuogo(f) : vuoto) + '</span>' +
      '</button></div>';
  }

  function pannelloQuandoHTML() {
    const arrivo = routing.modo === 'arrivo';
    return '<div class="quando-pannello">' +
      '<div class="segmento" role="group" aria-label="Tipo di orario">' +
      '<button type="button" data-azione="modo-partenza" class="' + (arrivo ? '' : 'attivo') + '" aria-pressed="' + (arrivo ? 'false' : 'true') + '">Parti alle</button>' +
      '<button type="button" data-azione="modo-arrivo" class="' + (arrivo ? 'attivo' : '') + '" aria-pressed="' + (arrivo ? 'true' : 'false') + '">Arriva entro</button>' +
      '</div>' +
      '<div class="quando-campi">' +
      '<input id="input-data" type="date" value="' + esc(routing.giorno) + '" aria-label="Giorno">' +
      '<input id="input-ora" type="time" step="300" value="' + esc(routing.orario) + '" aria-label="' + (arrivo ? 'Ora di arrivo' : 'Ora di partenza') + '">' +
      '</div>' +
      '<div class="camminata">' +
      '<span class="eti">A piedi</span>' +
      '<input id="input-camminata" type="range" min="3" max="25" step="1" value="' + camminata + '" aria-label="Minuti disposti a camminare">' +
      '<output id="valore-camminata">' + camminata + ' min</output>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
      (arrivo
        ? '<button type="button" class="btn btn-tenue" style="flex:1" data-azione="tra-un-ora">Tra 1 ora</button>'
        : '<button type="button" class="btn btn-tenue" style="flex:1" data-azione="ora-adesso">Adesso</button>') +
      '</div></div>';
  }

  /* --- Preferiti ----------------------------------------------------- */
  // Casa e lavoro sono gli unici due posti che si ripetono ogni giorno: due
  // scorciatoie, non un elenco da gestire. Restano sul dispositivo.
  const PREFERITI_BASE = [
    { slot: 'casa', etichetta: 'Casa', icona: 'house', domanda: 'Dove è casa?' },
    { slot: 'lavoro', etichetta: 'Lavoro', icona: 'briefcase', domanda: 'Dove è il lavoro?' }
  ];
  const PREFERITI_MAX = 4;
  let preferitoInCorso = null;
  let preferitiModifica = false;

  function preferitiSalvati() {
    const salvati = leggiJSON(K_PREFERITI);
    return salvati && typeof salvati === 'object' ? salvati : {};
  }

  // Nomi, ordine e preferiti aggiunti stanno nella stessa voce (`_meta`): una
  // chiave in meno da dichiarare nella cookie policy e da portare nel backup.
  function preferitiMeta() {
    const meta = preferitiSalvati()._meta;
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
      nomi: m.nomi && typeof m.nomi === 'object' ? m.nomi : {},
      ordine: Array.isArray(m.ordine) ? m.ordine.filter((slot) => typeof slot === 'string') : [],
      extra: Array.isArray(m.extra)
        ? m.extra.filter((voce) => voce && typeof voce.slot === 'string' && typeof voce.etichetta === 'string')
          .slice(0, PREFERITI_MAX)
        : []
    };
  }

  function scriviPreferitiMeta(meta) {
    const salvati = preferitiSalvati();
    salvati._meta = meta;
    scrivi(K_PREFERITI, JSON.stringify(salvati));
  }

  // Casa e lavoro sono i due posti di sempre; chi vuole può rinominarli e
  // aggiungerne altri, e l'ordine è quello scelto nel menu.
  function elencoPreferiti() {
    const meta = preferitiMeta();
    const base = PREFERITI_BASE.map((voce) => ({
      slot: voce.slot,
      etichetta: meta.nomi[voce.slot] || voce.etichetta,
      icona: voce.icona,
      domanda: voce.domanda
    }));
    const extra = meta.extra.map((voce) => ({
      slot: voce.slot,
      etichetta: voce.etichetta,
      icona: 'map-pin',
      domanda: 'Dove si trova ' + voce.etichetta + '?'
    }));
    const tutti = base.concat(extra);
    if (!meta.ordine.length) return tutti;
    const posizione = (slot) => {
      const indice = meta.ordine.indexOf(slot);
      return indice < 0 ? 999 : indice;
    };
    return tutti.slice().sort((a, b) => posizione(a.slot) - posizione(b.slot));
  }

  function vocePreferito(slot) {
    return elencoPreferiti().find((voce) => voce.slot === slot) || null;
  }

  // Solo quelli ancora risolvibili: una fermata sparita dal dataset non deve
  // lasciare un pulsante che non porta da nessuna parte.
  function preferitiValidi() {
    const salvati = preferitiSalvati();
    return elencoPreferiti()
      .map((voce) => ({ slot: voce.slot, etichetta: voce.etichetta, icona: voce.icona, luogo: luogoRipristinato(salvati[voce.slot]) }))
      .filter((voce) => voce.luogo && voce.luogo.lat != null);
  }

  function salvaPreferito(slot, luogo) {
    if (!vocePreferito(slot)) return false;
    const compatto = luogo ? luogoSalvato(luogo) : null;
    if (luogo && !compatto) {
      mostraToast('La posizione attuale cambia: scegli una fermata o un indirizzo');
      return false;
    }
    const salvati = preferitiSalvati();
    if (compatto) salvati[slot] = compatto;
    else {
      delete salvati[slot];
      // Un preferito aggiunto senza posto non ha senso: si toglie anche dal menu.
      const meta = preferitiMeta();
      if (meta.extra.some((voce) => voce.slot === slot)) {
        meta.extra = meta.extra.filter((voce) => voce.slot !== slot);
        meta.ordine = meta.ordine.filter((s) => s !== slot);
        delete meta.nomi[slot];
        salvati._meta = meta;
      }
    }
    scrivi(K_PREFERITI, JSON.stringify(salvati));
    renderPreferiti();
    return true;
  }

  function rinominaPreferito(slot) {
    const voce = vocePreferito(slot);
    if (!voce) return;
    const nome = typeof window.prompt === 'function'
      ? window.prompt(testoUI('Nome del preferito', 'Favourite name'), voce.etichetta) : null;
    if (nome == null) return;
    const pulito = String(nome).trim().slice(0, 20);
    if (!pulito) return;
    const meta = preferitiMeta();
    meta.nomi[slot] = pulito;
    scriviPreferitiMeta(meta);
    renderPreferiti();
  }

  function spostaPreferito(slot, direzione) {
    const ordine = elencoPreferiti().map((voce) => voce.slot);
    const indice = ordine.indexOf(slot);
    const destinazione = indice + direzione;
    if (indice < 0 || destinazione < 0 || destinazione >= ordine.length) return;
    ordine.splice(destinazione, 0, ordine.splice(indice, 1)[0]);
    const meta = preferitiMeta();
    meta.ordine = ordine;
    scriviPreferitiMeta(meta);
    renderPreferiti();
  }

  function aggiungiPreferito() {
    const elenco = elencoPreferiti();
    if (elenco.length >= PREFERITI_MAX) {
      mostraToast(testoUI('Al massimo ' + PREFERITI_MAX + ' preferiti',
        'At most ' + PREFERITI_MAX + ' favourites'));
      return;
    }
    const nome = typeof window.prompt === 'function'
      ? window.prompt(testoUI('Nome del nuovo preferito, per esempio «Università»',
        'Name of the new favourite, for example “University”'), '') : null;
    if (nome == null) return;
    const pulito = String(nome).trim().slice(0, 20);
    if (!pulito) return;
    if (elenco.some((voce) => voce.etichetta.toLowerCase() === pulito.toLowerCase())) {
      mostraToast(testoUI('Hai già un preferito con questo nome',
        'You already have a favourite with this name'));
      return;
    }
    const usati = elenco.map((voce) => voce.slot);
    let slot = '';
    for (let numero = 3; numero <= 9 && !slot; numero += 1) {
      if (usati.indexOf('p' + numero) < 0) slot = 'p' + numero;
    }
    if (!slot) return;
    const meta = preferitiMeta();
    meta.extra = meta.extra.concat([{ slot: slot, etichetta: pulito }]);
    meta.ordine = usati.concat(slot);
    scriviPreferitiMeta(meta);
    // Subito la ricerca: un preferito senza posto non serve a niente.
    apriCercaPreferito(slot);
  }

  // Il menu mostra sempre lo stato vero: nessun preferito "fantasma" se il
  // posto è stato rimosso o non si risolve più.
  function renderPreferiti() {
    const riquadro = $('menu-preferiti');
    if (riquadro) {
      const validi = preferitiValidi();
      const elenco = elencoPreferiti();
      const righe = elenco.map((voce, indice) => {
        const scelto = validi.find((v) => v.slot === voce.slot);
        const acceso = scelto && avvisoAttivo(voce.slot);
        if (preferitiModifica) {
          return '<div class="menu-pref-riga modifica">' +
            '<span class="menu-pref-nome">' + esc(voce.etichetta) + '</span>' +
            '<span class="spazio"></span>' +
            '<button type="button" class="menu-pref-icona" data-azione="pref-su" data-slot="' + esc(voce.slot) +
            '" aria-label="Sposta su ' + esc(voce.etichetta) + '"' + (indice === 0 ? ' disabled' : '') + '>' +
            Icone.svg('arrow-up', 18) + '</button>' +
            '<button type="button" class="menu-pref-icona" data-azione="pref-giu" data-slot="' + esc(voce.slot) +
            '" aria-label="Sposta giù ' + esc(voce.etichetta) + '"' + (indice === elenco.length - 1 ? ' disabled' : '') + '>' +
            Icone.svg('arrow-down', 18) + '</button>' +
            '<button type="button" class="menu-pref-icona" data-azione="pref-rinomina" data-slot="' + esc(voce.slot) +
            '" aria-label="Rinomina ' + esc(voce.etichetta) + '">' + Icone.svg('pencil', 18) + '</button>' +
            (scelto
              ? '<button type="button" class="menu-pref-rimuovi" data-azione="pref-rimuovi" data-slot="' + esc(voce.slot) +
                '" aria-label="Rimuovi ' + esc(voce.etichetta) + '">' + ICONA_X + '</button>'
              : '') +
            '</div>';
        }
        // Con un posto impostato la riga porta lì; il segnaposto cambia il posto.
        return '<div class="menu-pref-riga">' +
          '<button type="button" class="menu-pref" data-azione="' + (scelto ? 'pref-vai' : 'pref-scegli') +
          '" data-slot="' + esc(voce.slot) + '">' +
          Icone.svg(voce.icona, 20) +
          '<span class="spazio">' + esc(voce.etichetta) + '</span>' +
          '<span class="nota' + (scelto ? '' : ' vuoto') + '">' +
          esc(scelto ? nomeBreve(scelto.luogo.nome) : 'Imposta') + '</span>' +
          '</button>' +
          (scelto
            ? '<button type="button" class="menu-pref-modifica" data-azione="pref-scegli" data-slot="' + esc(voce.slot) +
              '" aria-label="Cambia il posto di ' + esc(voce.etichetta) + '">' + Icone.svg('map-pin', 18) + '</button>' +
              '<button type="button" class="menu-pref-avviso' + (acceso ? ' acceso' : '') + '" data-azione="pref-avviso" data-slot="' +
              esc(voce.slot) + '" aria-pressed="' + (acceso ? 'true' : 'false') + '" aria-label="Avvisa quando devo uscire per il bus da ' +
              esc(voce.etichetta) + '">' + Icone.svg(acceso ? 'bell' : 'bell-off', 18) + '</button>' +
              '<button type="button" class="menu-pref-rimuovi" data-azione="pref-rimuovi" data-slot="' + esc(voce.slot) +
              '" aria-label="Rimuovi ' + esc(voce.etichetta) + '">' + ICONA_X + '</button>'
            : '') +
          '</div>';
      }).join('');
      riquadro.innerHTML = righe +
        '<div class="menu-pref-azioni">' +
        (elenco.length < PREFERITI_MAX
          ? '<button type="button" class="link-mini" data-azione="pref-aggiungi">Aggiungi preferito</button>'
          : '') +
        '<button type="button" class="link-mini" data-azione="pref-modifica">' +
        (preferitiModifica ? 'Fatto' : 'Modifica') + '</button>' +
        '</div>';
    }
    if (vistaAttiva === 'percorso' && !(sel.partenza && sel.destinazione)) renderPercorso();
  }

  /* --- Avvisi sul prossimo bus --------------------------------------- */
  // Notifica locale: non c'è un server, quindi parte solo mentre l'app è
  // aperta o in background recente. Con l'app chiusa del tutto servirebbe un
  // push con un backend, che qui non esiste.
  const AVVISO_MINUTI = 5;
  const AVVISO_INTERVALLO = 60000;
  const AVVISO_ARRIVO_MINUTI = 2;
  const AVVISO_ARRIVO_INTERVALLO = 15000;
  const PASSO_MINUTO_METRI = 75;      // 4,5 km/h: passo normale, semafori compresi
  let avvisiTimer = null;
  let avvisiArrivoTimer = null;
  const avvisiInviati = new Set();
  const avvisiArrivoInviati = new Set();

  function avvisiSalvati() {
    const salvati = leggiJSON(K_AVVISI);
    return salvati && typeof salvati === 'object' ? salvati : {};
  }

  function avvisoAttivo(slot) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    return !!avvisiSalvati()[slot];
  }

  function scriviAvviso(slot, attivo) {
    const salvati = avvisiSalvati();
    if (attivo) salvati[slot] = true;
    else delete salvati[slot];
    scrivi(K_AVVISI, JSON.stringify(salvati));
  }

  async function mostraNotifica(titolo, corpo, fermataId, tag) {
    const opzioni = {
      body: corpo,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: tag || 'muovi-bologna-avviso',
      renotify: true,
      data: { fermata: fermataId || '' }
    };
    try {
      const registrazione = await navigator.serviceWorker.ready;
      if (registrazione && registrazione.showNotification) {
        await registrazione.showNotification(titolo, opzioni);
        return true;
      }
    } catch (errore) { /* si prova con la notifica diretta */ }
    try {
      // Su Android new Notification() non è ammesso: resta un ripiego desktop.
      new Notification(titolo, opzioni);
      return true;
    } catch (errore) {
      return false;
    }
  }

  // Fermata da interrogare per un preferito: per un indirizzo vale la palina
  // più vicina, come per il tempo reale della scheda fermata.
  function fermataPerAvviso(luogo) {
    if (!luogo) return null;
    if (!eIndirizzo(luogo) && lineeDaInterrogare(luogo).length) return palinaConLinee(luogo);
    if (luogo.lat == null || luogo.lon == null) return null;
    return fermateVicine(luogo.lat, luogo.lon, 1)[0] || null;
  }

  // Minuti a piedi da un indirizzo alla fermata: distanza in linea d'aria con
  // un 25% di allungo per le strade. È una stima, e la notifica lo dice.
  function minutiCammino(da, a) {
    if (!da || !a) return null;
    const km = Tariffe.distanzaKm(da, a);
    if (km == null) return null;
    return Math.max(1, Math.round((km * 1000 * 1.25) / PASSO_MINUTO_METRI));
  }

  // Da casa serve uscire prima: la soglia diventa il cammino più un minuto di
  // margine. Sotto i tre minuti la fermata è sotto casa e vale l'avviso fisso.
  function minutiPerUscire(luogo, fermata) {
    if (!luogo || !fermata || !eIndirizzo(luogo)) return null;
    const minuti = minutiCammino(luogo, fermata);
    return minuti != null && minuti >= 3 ? minuti : null;
  }

  async function controllaAvvisi() {
    const attivi = preferitiValidi().filter((voce) => avvisoAttivo(voce.slot));
    if (!attivi.length) return;
    const giorno = oggiISO();
    for (const voce of attivi) {
      const fermata = fermataPerAvviso(voce.luogo);
      if (!fermata) continue;
      const linea = lineeDaInterrogare(fermata)[0];
      if (!linea) continue;
      let arrivi = [];
      try {
        arrivi = parseHellobus(await queryHellobus(fermata.id, linea));
      } catch (errore) {
        continue;
      }
      // Da un indirizzo la soglia è il tempo a piedi: l'avviso serve a uscire
      // di casa, non a sapere che il bus passerà mentre sei ancora sul divano.
      const esci = minutiPerUscire(voce.luogo, fermata);
      const soglia = esci || AVVISO_MINUTI;
      const prossimo = arrivi
        .filter((a) => a.minuti != null && a.minuti >= 0 && a.minuti <= soglia)
        .sort((a, b) => a.minuti - b.minuti)[0];
      if (!prossimo) continue;
      const chiave = [voce.slot, prossimo.linea, prossimo.ora, giorno].join('|');
      if (avvisiInviati.has(chiave)) continue;
      avvisiInviati.add(chiave);
      const titolo = esci
        ? 'Esci ora: bus ' + prossimo.linea + ' tra ' + prossimo.minuti + ' min'
        : 'Bus ' + prossimo.linea + ' tra ' + prossimo.minuti + ' min';
      const corpo = esci
        ? voce.etichetta + ' · ' + esci + ' min a piedi fino a ' + nomeBreve(fermata.nome) +
          ' · bus alle ' + prossimo.ora
        : voce.etichetta + ' · ' + nomeBreve(voce.luogo.nome) + ' · ' + prossimo.ora;
      await mostraNotifica(titolo, corpo, fermata.id, esci ? 'esci-' + chiave : undefined);
      await avvisaUltimaCorsa(voce, fermata, giorno);
    }
    // I promemoria del Worker seguono quello che l'app ha appena calcolato.
    sincronizzaPush();
  }

  /* ------------------------------------------------------------------ *
   * Ultima corsa
   * ------------------------------------------------------------------ */
  // La sera l'errore che costa non è perdere un bus, è perdere l'ultimo. Una
  // notifica sola per fermata e per giorno, un quarto d'ora prima.
  const ULTIMA_SOGLIA = 15;
  const K_ULTIME = 'tperzc_ultime_v1';
  const K_FERIALE = 'tperzc_feriale_v1';

  function ultimaCorsaDaFermata(fermata) {
    const indice = lineeIndice();
    if (!indice || !fermata) return null;
    const attive = serviziDelGiorno();
    let migliore = null;
    lineaDi(fermata).forEach((nome) => {
      const linea = Linee.lineaDi(indice, nome);
      if (!linea) return;
      // Senza capolinea si guardano tutte le direzioni: la domanda è «l'ultimo
      // bus che passa di qui stasera», non «l'ultimo verso una direzione».
      const ultima = Linee.ultimaAllaFermata(linea, null, fermata.id, attive);
      if (ultima && (!migliore || ultima.secondi > migliore.secondi)) {
        migliore = { secondi: ultima.secondi, corsa: ultima.corsa, linea: linea.nome };
      }
    });
    return migliore;
  }

  // La guardia è su disco: senza, ogni ricarica nella mezz'ora finale avrebbe
  // ripetuto la stessa notifica.
  function ultimaGiaAvvisata(chiave) {
    const salvate = leggiJSON(K_ULTIME) || {};
    return !!salvate[chiave];
  }

  function segnaUltimaAvvisata(chiave) {
    const salvate = leggiJSON(K_ULTIME) || {};
    salvate[chiave] = Date.now();
    // Bastano gli ultimi giorni: la chiave contiene già la data.
    Object.keys(salvate).forEach((voce) => {
      if (Date.now() - Number(salvate[voce]) > 8 * 24 * 3600 * 1000) delete salvate[voce];
    });
    scrivi(K_ULTIME, JSON.stringify(salvate));
  }

  // Con il push attivo il promemoria lo tiene il Worker: così l'ultima corsa
  // arriva anche se l'app è chiusa da ore. Venti minuti prima, una volta al
  // giorno, solo per le fermate con gli avvisi accesi.
  // Le partenze vere dei preferiti con gli avvisi accesi, lette dall'orario
  // GTFS e datate sul Worker: «Bus 13 tra 5 min» arriva anche con l'app chiusa,
  // con la stessa soglia della notifica locale (5 minuti, o il tempo a piedi
  // quando il preferito è un indirizzo). Oltre dodici ore non si va: tanto
  // l'app risincronizza la prossima volta che si apre.
  const PUSH_BUS_QUANTI = 3;
  const PUSH_BUS_FINESTRA_ORE = 12;
  const PUSH_BUS_DISTANZA_MIN = 10;

  function promemoriaProssimiBus() {
    const elenco = [];
    if (!window.Push || typeof Push.pianificaPartenze !== 'function') return elenco;
    if (typeof TPERRouting === 'undefined' || !TPERRouting.partenzeFermata) return elenco;
    preferitiValidi().filter((voce) => avvisoAttivo(voce.slot)).forEach((voce) => {
      const fermata = fermataPerAvviso(voce.luogo);
      if (!fermata) return;
      const esci = minutiPerUscire(voce.luogo, fermata);
      const soglia = esci || AVVISO_MINUTI;
      const partenze = [];
      // Oggi e domani: il servizio comincia alle 04:00, quindi una corsa dopo
      // mezzanotte appartiene al giorno prima.
      for (let scarto = 0; scarto <= 1; scarto += 1) {
        const giorno = new Date();
        giorno.setHours(12, 0, 0, 0);
        giorno.setDate(giorno.getDate() + scarto);
        const iso = isoDi(giorno);
        const base = dataDaGiornoEOra(iso, '04:00').getTime();
        let corse = [];
        try {
          corse = TPERRouting.partenzeFermata(fermata.id, dataDaGiornoEOra(iso, '04:00')) || [];
        } catch (errore) {
          corse = [];
        }
        corse.forEach((corsa) => {
          partenze.push({
            linea: corsa.linea,
            orario: corsa.orario,
            quando: base + (Number(corsa.orario) - 4 * 3600) * 1000
          });
        });
      }
      Push.pianificaPartenze(partenze, Date.now(), {
        sogliaMinuti: soglia,
        quanti: PUSH_BUS_QUANTI,
        finestraOre: PUSH_BUS_FINESTRA_ORE,
        distanzaMinima: PUSH_BUS_DISTANZA_MIN
      }).forEach((corsa) => {
        elenco.push({
          id: 'bus-' + voce.slot + '-' + corsa.linea + '-' + Math.round(corsa.quando / 60000),
          quando: corsa.quando,
          titolo: esci
            ? 'Esci ora: bus ' + corsa.linea + ' tra ' + esci + ' min'
            : 'Bus ' + corsa.linea + ' tra ' + soglia + ' min',
          corpo: voce.etichetta + ' · ' + nomeBreve(fermata.nome) + ' · bus alle ' + hhmm(corsa.orario),
          fermata: fermata.id,
          tag: 'muovi-bologna-avviso'
        });
      });
    });
    return elenco;
  }

  function promemoriaPush() {
    const elenco = [];
    const inizio = new Date();
    inizio.setHours(0, 0, 0, 0);
    preferitiValidi().filter((voce) => avvisoAttivo(voce.slot)).forEach((voce) => {
      const fermata = fermataPerAvviso(voce.luogo);
      if (!fermata) return;
      const ultima = ultimaCorsaDaFermata(fermata);
      if (!ultima) return;
      const quando = inizio.getTime() + (ultima.secondi - 20 * 60) * 1000;
      if (quando <= Date.now()) return;
      elenco.push({
        id: 'ultima-' + voce.slot + '-' + oggiISO(),
        quando: quando,
        titolo: 'Ultima corsa alle ' + hhmm(ultima.secondi),
        corpo: 'Linea ' + ultima.linea + ' da ' + nomeBreve(fermata.nome) + ': dopo non passa più',
        fermata: fermata.id,
        tag: 'ultima-' + voce.slot
      });
    });
    return promemoriaProssimiBus().concat(elenco, promemoriaFeriale());
  }

  function sincronizzaPush() {
    if (!window.Push || !Push.attivo()) return;
    Push.sincronizza(promemoriaPush());
  }

  /* ------------------------------------------------------------------ *
   * Promemoria feriale
   * ------------------------------------------------------------------ */
  // «Ogni giorno feriale alle 7:35 dimmi quando passa il prossimo bus da
  // Casa». Con l'app aperta parte la notifica locale; con il push attivo lo
  // stesso promemoria viene datato sul Worker per i prossimi giorni feriali.
  function ferialeSalvato() {
    const salvato = leggiJSON(K_FERIALE);
    return salvato && typeof salvato === 'object' ? salvato : {};
  }

  function ferialeConfig() {
    const salvato = ferialeSalvato();
    const validi = preferitiValidi();
    const ora = /^\d{2}:\d{2}$/.test(String(salvato.ora || '')) ? String(salvato.ora) : '07:35';
    const slot = validi.some((voce) => voce.slot === salvato.slot) ? salvato.slot : (validi[0] || {}).slot || '';
    return { attivo: !!salvato.attivo && !!slot, ora: ora, slot: slot, ultimo: String(salvato.ultimo || '') };
  }

  function scriviFeriale(valori) {
    const salvato = ferialeSalvato();
    Object.keys(valori).forEach((chiave) => { salvato[chiave] = valori[chiave]; });
    scrivi(K_FERIALE, JSON.stringify(salvato));
  }

  // Prima partenza dopo l'ora scelta, dal dataset del giorno: nessuna rete,
  // così il promemoria funziona anche con il telefono in tasca e lo schermo
  // spento da un pezzo (le notifiche locali partono dall'app aperta).
  function prossimoBusDa(fermata, giorno, oraSecondi) {
    if (!fermata || typeof TPERRouting === 'undefined' || !TPERRouting.partenzeFermata) return null;
    let elenco = [];
    try {
      elenco = TPERRouting.partenzeFermata(fermata.id, dataDaGiornoEOra(giorno, '04:00')) || [];
    } catch (errore) {
      return null;
    }
    const dopo = elenco
      .filter((voce) => voce.orario >= oraSecondi)
      .sort((a, b) => a.orario - b.orario);
    return dopo[0] || null;
  }

  function oraInSecondi(ora) {
    const trovata = /^(\d{2}):(\d{2})$/.exec(String(ora || ''));
    if (!trovata) return null;
    return parseInt(trovata[1], 10) * 3600 + parseInt(trovata[2], 10) * 60;
  }

  function testoCorsaBus(bus, fermata, voce) {
    if (!bus) return 'Apri l\'app per vedere il prossimo bus da ' + nomeBreve(fermata.nome);
    return 'Linea ' + bus.linea + ' alle ' + hhmm(bus.orario) + ' da ' + nomeBreve(fermata.nome) +
      ' · ' + voce.etichetta;
  }

  // I prossimi giorni feriali con l'orario del bus già dentro: il Worker non
  // deve calcolare niente, gli basta spedire alla data giusta.
  function promemoriaFeriale() {
    const config = ferialeConfig();
    if (!config.attivo) return [];
    const voce = preferitiValidi().find((p) => p.slot === config.slot);
    const fermata = voce ? fermataPerAvviso(voce.luogo) : null;
    const secondi = oraInSecondi(config.ora);
    if (!voce || !fermata || secondi == null) return [];
    const elenco = [];
    for (let scarto = 0; scarto <= 8 && elenco.length < 7; scarto += 1) {
      const giorno = new Date();
      giorno.setHours(12, 0, 0, 0);
      giorno.setDate(giorno.getDate() + scarto);
      const indice = (giorno.getDay() + 6) % 7; // 0 = lunedì
      if (indice > 4) continue;
      const iso = isoDi(giorno);
      const quando = dataDaGiornoEOra(iso, config.ora).getTime();
      if (quando <= Date.now()) continue;
      const bus = prossimoBusDa(fermata, iso, secondi);
      elenco.push({
        id: 'feriale-' + iso,
        quando: quando,
        titolo: 'Prossimo bus da ' + voce.etichetta,
        corpo: testoCorsaBus(bus, fermata, voce),
        fermata: fermata.id,
        tag: 'feriale'
      });
    }
    return elenco;
  }

  // Notifica locale all'ora scelta, dal lunedì al venerdì.
  async function controllaFeriale() {
    const config = ferialeConfig();
    if (!config.attivo) return;
    const adesso = new Date();
    if ((adesso.getDay() + 6) % 7 > 4) return;
    if (due(adesso.getHours()) + ':' + due(adesso.getMinutes()) !== config.ora) return;
    const giorno = oggiISO();
    if (config.ultimo === giorno) return;
    const voce = preferitiValidi().find((p) => p.slot === config.slot);
    const fermata = voce ? fermataPerAvviso(voce.luogo) : null;
    const secondi = oraInSecondi(config.ora);
    if (!voce || !fermata || secondi == null) return;
    const bus = prossimoBusDa(fermata, giorno, secondi);
    // Senza un bus (orari non ancora caricati, giorno senza servizio) non si
    // segna niente: al minuto dopo si riprova, invece di perdere il promemoria.
    if (!bus) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    scriviFeriale({ ultimo: giorno });
    await mostraNotifica(
      'Prossimo bus da ' + voce.etichetta,
      testoCorsaBus(bus, fermata, voce),
      fermata.id,
      'feriale'
    );
  }

  function renderFeriale() {
    const riga = $('menu-feriale');
    if (!riga) return;
    const config = ferialeConfig();
    const validi = preferitiValidi();
    riga.checked = config.attivo;
    const campoOra = $('menu-feriale-ora');
    if (campoOra) campoOra.value = config.ora;
    const campoLuogo = $('menu-feriale-luogo');
    if (campoLuogo) {
      campoLuogo.innerHTML = validi.map((voce) =>
        '<option value="' + esc(voce.slot) + '">' + esc(voce.etichetta) + '</option>'
      ).join('');
      if (config.slot) campoLuogo.value = config.slot;
      campoLuogo.disabled = !validi.length;
    }
    const nota = $('menu-feriale-nota');
    if (nota) {
      const voce = vocePreferito(config.slot);
      const nome = voce ? voce.etichetta : testoUI('casa', 'home');
      nota.textContent = !validi.length
        ? testoUI('Imposta prima un preferito: il promemoria parte da lì.',
          'Set a favourite first: the reminder starts from there.')
        : config.attivo
          ? testoUI('Ogni giorno feriale alle ' + config.ora + ', dal lunedì al venerdì, il prossimo bus da ' + nome + '.',
            'Every weekday at ' + config.ora + ', Monday to Friday, the next bus from ' + nome + '.')
          : testoUI('Un promemoria al giorno, dal lunedì al venerdì, dal preferito scelto.',
            'One reminder a day, Monday to Friday, from the chosen favourite.');
    }
  }

  async function impostaFeriale(attivo) {
    if (attivo) {
      const permesso = await permessoNotifiche();
      renderNotificheMenu();
      // Il promemoria resta salvato anche senza permesso: le notifiche si
      // possono attivare dopo, e con il push il Worker non dipende da questa
      // schermata. Senza permesso, però, non arriva niente.
      if (permesso !== 'granted') {
        mostraToast(permesso === 'denied'
          ? 'Notifiche bloccate: il promemoria resta salvato ma non arriva'
          : 'Notifiche non attivate: il promemoria resta salvato ma non arriva');
      }
    }
    scriviFeriale({ attivo: !!attivo });
    renderFeriale();
    avviaAvvisi();
    sincronizzaPush();
    mostraToast(attivo
      ? testoUI('Promemoria feriale attivo', 'Weekday reminder on')
      : testoUI('Promemoria feriale spento', 'Weekday reminder off'));
  }

  /* ------------------------------------------------------------------ *
   * Mappa offline della zona di casa
   * ------------------------------------------------------------------ */
  // I tasselli vettoriali della mappa sono l'unica parte che smette di
  // funzionare senza rete. Restano in una cache dedicata: quello che si è già
  // visto non si riscarica (meno dati) e la zona salvata si apre anche offline.
  const CACHE_MAPPA = 'muovi-bologna-mappa';
  const TASSELLI_MAX = 900;

  function tasselliAttorno(lat, lon, raggio) {
    const punti = [];
    [12, 13, 14].forEach((z) => {
      const scala = Math.pow(2, z);
      const x0 = Math.floor((lon + 180) / 360 * scala);
      const latRad = lat * Math.PI / 180;
      const y0 = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scala);
      for (let dx = -raggio; dx <= raggio; dx += 1) {
        for (let dy = -raggio; dy <= raggio; dy += 1) {
          const x = ((x0 + dx) % scala + scala) % scala;
          const y = y0 + dy;
          if (y < 0 || y >= scala) continue;
          punti.push([z, x, y]);
        }
      }
    });
    return punti;
  }

  // Lo stile dichiara dove stanno i tasselli: si leggono dal suo JSON invece di
  // scrivere a mano un indirizzo che il fornitore può cambiare.
  async function modelliMappa() {
    const risposta = await fetch(stileMappa(), { cache: 'force-cache' });
    if (!risposta.ok) throw new Error('stile non disponibile');
    const stile = await risposta.json();
    const modelli = [];
    const fonti = stile.sources || {};
    const nomi = Object.keys(fonti);
    for (let i = 0; i < nomi.length; i += 1) {
      const fonte = fonti[nomi[i]];
      // Solo i vettoriali: le fonti raster (natural earth) esistono a pochi
      // livelli di zoom e a 12–14 risponderebbero 404 per ogni tassello.
      if (!fonte || fonte.type !== 'vector') continue;
      let tilejson = fonte;
      if (fonte.url) {
        try {
          const dettaglio = await fetch(fonte.url, { cache: 'force-cache' });
          if (!dettaglio.ok) continue;
          tilejson = await dettaglio.json();
        } catch (errore) { continue; }
      }
      (tilejson.tiles || []).forEach((modello) => {
        if (modelli.indexOf(modello) < 0) modelli.push(modello);
      });
    }
    return { modelli: modelli, stile: stile };
  }

  function indirizzoTassello(modello, z, x, y) {
    const indirizzo = String(modello)
      .replace(/\{z\}/g, z).replace(/\{x\}/g, x).replace(/\{y\}/g, y);
    // Segnaposto che non conosciamo ({ratio}, {quadkey}): meglio saltarlo che
    // salvare in cache un 404.
    return /[{}]/.test(indirizzo) ? null : indirizzo;
  }

  async function salvaMappaCasa() {
    if (typeof caches === 'undefined') {
      mostraToast('Questo browser non permette di salvare la mappa');
      return;
    }
    const casa = preferitiValidi().find((voce) => voce.slot === 'casa');
    const centro = casa && casa.luogo ? casa.luogo
      : (mappa && mappa.getCenter ? { lat: mappa.getCenter().lat, lon: mappa.getCenter().lng } : null);
    if (!centro) {
      mostraToast('Imposta Casa o sposta la mappa sulla zona che ti serve');
      return;
    }
    mostraToast('Salvo la mappa attorno a casa…');
    let dati = null;
    try {
      dati = await modelliMappa();
    } catch (errore) {
      mostraToast('Mappa non raggiungibile: serve la rete per salvarla');
      return;
    }
    const indirizzi = [];
    const aggiungi = (indirizzo) => { if (indirizzo && indirizzi.indexOf(indirizzo) < 0) indirizzi.push(indirizzo); };
    tasselliAttorno(centro.lat, centro.lon, 2).forEach((punto) => {
      dati.modelli.forEach((modello) => aggiungi(indirizzoTassello(modello, punto[0], punto[1], punto[2])));
    });
    // Senza stile, sprite e caratteri la mappa salvata non si disegna.
    aggiungi(stileMappa());
    if (dati.stile.sprite) {
      aggiungi(dati.stile.sprite + '.json');
      aggiungi(dati.stile.sprite + '.png');
    }
    if (dati.stile.glyphs) {
      const caratteri = [];
      (dati.stile.layers || []).forEach((livello) => {
        const font = livello && livello.layout && livello.layout['text-font'];
        if (Array.isArray(font) && font.length) {
          const nome = font.join(',');
          if (caratteri.indexOf(nome) < 0) caratteri.push(nome);
        }
      });
      caratteri.forEach((font) => {
        ['0-255', '256-511'].forEach((intervallo) => {
          aggiungi(String(dati.stile.glyphs)
            .replace('{fontstack}', encodeURIComponent(font))
            .replace('{range}', intervallo));
        });
      });
    }
    const cache = await caches.open(CACHE_MAPPA);
    let salvati = 0;
    for (let i = 0; i < indirizzi.length && salvati < TASSELLI_MAX; i += 1) {
      const indirizzo = indirizzi[i];
      if (await cache.match(indirizzo)) { salvati += 1; continue; }
      try {
        const risposta = await fetch(indirizzo, { cache: 'force-cache' });
        if (risposta && (risposta.ok || risposta.type === 'opaque')) {
          await cache.put(indirizzo, risposta);
          salvati += 1;
        }
      } catch (errore) { /* un tassello mancante non ferma gli altri */ }
    }
    await potaMappa(cache);
    await renderMappa();
    mostraToast(salvati ? 'Zona di casa salvata: ' + salvati + ' file' : 'Niente da salvare: controlla la connessione');
  }

  async function potaMappa(cache) {
    const chiavi = await cache.keys();
    for (let i = 0; i < chiavi.length - TASSELLI_MAX; i += 1) await cache.delete(chiavi[i]);
  }

  async function statMappa() {
    if (typeof caches === 'undefined') return { file: 0, byte: 0 };
    const cache = await caches.open(CACHE_MAPPA);
    const chiavi = await cache.keys();
    // Il peso si misura su un campione: leggere 900 corpi a ogni apertura del
    // menu bloccherebbe il telefono per niente.
    const campione = chiavi.slice(0, 80);
    let byte = 0;
    for (let i = 0; i < campione.length; i += 1) {
      const risposta = await cache.match(campione[i]);
      if (!risposta) continue;
      const lunghezza = Number(risposta.headers.get('content-length'));
      if (lunghezza > 0) byte += lunghezza;
      else {
        try { byte += (await risposta.clone().blob()).size; } catch (errore) { /* nulla */ }
      }
    }
    if (chiavi.length > campione.length && campione.length) byte = byte / campione.length * chiavi.length;
    return { file: chiavi.length, byte: Math.round(byte) };
  }

  async function renderMappa() {
    const nota = $('menu-mappa-nota');
    if (!nota) return;
    const stat = await statMappa();
    const peso = stat.byte ? ' · ' + testoUI('circa ', 'about ') + (stat.byte / 1048576).toFixed(1) + ' MB' : '';
    nota.textContent = stat.file
      ? testoUI(stat.file + ' file della mappa sul telefono' + peso +
        '. La zona salvata si apre anche senza rete.',
        stat.file + ' map files on your phone' + peso +
        '. The saved area opens even offline.')
      : testoUI('I tasselli della mappa già visti restano sul telefono: non si riscaricano e la zona funziona senza rete.',
        'Map tiles you have already seen stay on your phone: they are not downloaded again and that area works offline.');
  }

  async function svuotaMappa() {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_MAPPA);
    await renderMappa();
    mostraToast('Mappa salvata cancellata');
  }

  async function avvisaUltimaCorsa(voce, fermata, giorno) {
    const ultima = ultimaCorsaDaFermata(fermata);
    if (!ultima) return;
    const mancano = Math.round((ultima.secondi - secondiAdesso()) / 60);
    if (mancano < 0 || mancano > ULTIMA_SOGLIA) return;
    const chiave = ['ultima', voce.slot, giorno, ultima.linea, ultima.secondi].join('|');
    if (ultimaGiaAvvisata(chiave)) return;
    segnaUltimaAvvisata(chiave);
    const quando = mancano <= 0 ? 'adesso' : 'tra ' + mancano + ' min';
    await mostraNotifica(
      'Ultima corsa ' + quando,
      'Linea ' + ultima.linea + ' alle ' + hhmm(ultima.secondi) + ' da ' + nomeBreve(fermata.nome) + ': dopo non passa più',
      fermata.id,
      'ultima-' + voce.slot
    );
  }

  function avviaAvvisi() {
    if (avvisiTimer) return;
    avvisiTimer = setInterval(() => { controllaAvvisi(); controllaFeriale(); }, AVVISO_INTERVALLO);
    controllaAvvisi();
    controllaFeriale();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        controllaAvvisi();
        controllaAvvisoArrivo();
        controllaFeriale();
      }
    });
  }

  async function permessoNotifiche() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      return await Notification.requestPermission();
    } catch (errore) {
      return 'denied';
    }
  }

  function renderNotificheMenu() {
    const stato = $('menu-notifiche-stato');
    if (!stato) return;
    if (typeof Notification === 'undefined') stato.textContent = 'Non supportate';
    else if (Notification.permission === 'granted') stato.textContent = 'Attive';
    else if (Notification.permission === 'denied') stato.textContent = 'Bloccate';
    else stato.textContent = 'Attiva';
    // Su iPhone il permesso esiste solo con l'app nella schermata Home.
    const soloHome = $('menu-notifiche-ios');
    if (soloHome) soloHome.hidden = !notificheSoloDaHome();
    // Con il push attivo la nota «solo ad app aperta» non è più vera.
    const nota = $('menu-notifiche-nota');
    const pushAttivo = !!(window.Push && Push.attivo());
    if (nota) nota.hidden = pushAttivo;
    const riga = $('menu-push');
    const notaPush = $('menu-push-nota');
    const pronto = !!(window.Push && Push.configurato() && Push.supportato());
    if (riga) {
      riga.checked = !!(pronto && Push.attivo());
      const etichetta = riga.closest('.voce-menu');
      if (etichetta) etichetta.hidden = !pronto;
    }
    if (notaPush) notaPush.hidden = !(pronto && pushAttivo);
  }

  async function attivaNotificheMenu() {
    renderNotificheMenu();
    if (notificheSoloDaHome()) {
      mostraToast('Su iPhone aggiungi prima l\'app alla Home: Condividi → Aggiungi alla Home');
      return;
    }
    const permesso = await permessoNotifiche();
    renderNotificheMenu();
    if (permesso === 'granted') {
      avviaAvvisi();
      mostraToast("Notifiche attive: tocca la campanella di un preferito o l'avviso a 2 minuti di una corsa (con l'app aperta o in background)");
    } else if (permesso === 'denied') {
      mostraToast('Notifiche bloccate: riattivale dalle impostazioni del sito');
    } else if (permesso === 'unsupported') {
      mostraToast('Questo browser non supporta le notifiche');
    } else {
      mostraToast('Notifiche non attivate');
    }
  }

  // Su iPhone le notifiche e il service worker esistono solo con l'app
  // aggiunta alla Home: senza dirlo, il permesso sembra semplicemente rotto.
  function notificheSoloDaHome() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    const inHome = window.navigator.standalone === true ||
      !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return !inHome;
  }

  // Tema: scelta esplicita dell'utente, altrimenti quella del sistema.
  function temaPreferito() {
    const salvato = leggi(K_TEMA);
    if (salvato === 'scuro') return true;
    if (salvato === 'chiaro') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applicaTema(scuro, salva) {
    document.documentElement.setAttribute('data-tema', scuro ? 'scuro' : 'chiaro');
    // La barra di sistema segue il tema, altrimenti resta bianca su fondo scuro.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', scuro ? '#121212' : '#FFFFFF');
    const check = $('menu-tema');
    if (check) check.checked = scuro;
    // La mappa segue il tema: senza questo la scheda resta scura e la mappa
    // bianca, che è il punto in cui il tema sembrava rotto.
    cambiaStileMappa();
    if (salva) scrivi(K_TEMA, scuro ? 'scuro' : 'chiaro');
  }

  /* ------------------------------------------------------------------ *
   * Testo grande
   * ------------------------------------------------------------------ */
  // Sul bus, controsole e con le mani occupate, il testo da 12 px non si legge.
  // Si ingrandisce il contenuto del pannello e del menu, non la mappa.
  function testoGrande() {
    return leggi(K_TESTO) === 'grande';
  }

  function applicaTesto(grande, salva) {
    document.documentElement.setAttribute('data-testo', grande ? 'grande' : 'normale');
    const check = $('menu-testo');
    if (check) check.checked = !!grande;
    if (salva) scrivi(K_TESTO, grande ? 'grande' : 'normale');
  }

  /* ------------------------------------------------------------------ *
   * Backup dei dati locali
   * ------------------------------------------------------------------ */
  // Preferiti, viaggi, storico ritardi e impostazioni vivono solo in questo
  // telefono: cambiare dispositivo o svuotare i dati del sito li cancella.
  function scaricaBackup() {
    const pacchetto = Utilita.esportaDati(window.localStorage);
    if (!pacchetto.chiavi) {
      mostraToast('Nessun dato da esportare');
      return;
    }
    const blob = new Blob([JSON.stringify(pacchetto, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'muovi-bologna-' + oggiISO() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    mostraToast('Backup pronto: ' + pacchetto.chiavi + ' voci');
  }

  async function ripristinaBackup(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      mostraToast('File troppo grande per un backup');
      return;
    }
    let pacchetto = null;
    try {
      pacchetto = JSON.parse(await file.text());
    } catch (errore) {
      pacchetto = null;
    }
    if (!pacchetto || !pacchetto.dati) {
      mostraToast('File non valido');
      return;
    }
    if (!window.confirm('Importare il backup? I dati attuali con lo stesso nome vengono sostituiti.')) return;
    const esito = Utilita.applicaDati(window.localStorage, pacchetto);
    if (!esito.scritte) {
      mostraToast('Nessun dato importato');
      return;
    }
    mostraToast('Ripristinate ' + esito.scritte + ' voci: ricarico');
    setTimeout(() => location.reload(), 900);
  }

  // La corsa avvisata può essere in anticipo o in ritardo: se il tempo reale
  // della stessa corsa è in memoria (da meno di tre minuti), l'avviso lo segue
  // invece di fidarsi dell'orario di tabella.
  function corsaAvvisata() {
    if (!live.avvisa || !live.items || !live.items.length) return null;
    if (!live.ts || Date.now() - live.ts > 3 * 60000) return null;
    const programmato = minutiA(live.avvisa.ora);
    let migliore = null;
    live.items.forEach((voce) => {
      if (String(voce.linea).toUpperCase() !== live.avvisa.linea) return;
      if (voce.minuti == null) return;
      const scarto = voce.minuti - programmato;
      // Oltre venti minuti di distanza è un'altra corsa della stessa linea.
      if (Math.abs(scarto) > 20) return;
      if (!migliore || Math.abs(scarto) < Math.abs(migliore.scarto)) {
        migliore = { voce: voce, scarto: scarto };
      }
    });
    return migliore;
  }

  // Avviso a 2 minuti della corsa scelta negli orari: una sola notifica per
  // fermata, linea, ora e giorno, anche se il controllo gira ogni 15 secondi.
  function controllaAvvisoArrivo() {
    if (!live.avvisa || !live.fermata) return;
    if (routing.giorno && routing.giorno !== oggiISO()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const trovata = corsaAvvisata();
    const reale = !!(trovata && trovata.voce.tipo === 'live');
    const minuti = trovata ? trovata.voce.minuti : minutiA(live.avvisa.ora);
    if (minuti == null || minuti < 0) return;
    const chiave = [oggiISO(), live.fermata.id, live.avvisa.linea, live.avvisa.ora].join('|');
    // Bus rallentato dopo la notifica: la corsa torna lontana, quindi l'avviso
    // si riarma e riparte davvero due minuti prima del passaggio reale.
    if (avvisiArrivoInviati.has(chiave) && minuti > AVVISO_ARRIVO_MINUTI + 2) {
      avvisiArrivoInviati.delete(chiave);
    }
    if (minuti > AVVISO_ARRIVO_MINUTI) return;
    if (avvisiArrivoInviati.has(chiave)) return;
    avvisiArrivoInviati.add(chiave);
    const quando = reale ? trovata.voce.ora : live.avvisa.ora;
    const titolo = 'Bus ' + live.avvisa.linea + ' tra ' + Math.max(0, minuti) + ' min' +
      (reale ? ' (tempo reale)' : '');
    const corpo = nomeLuogo(live.fermata) + ' · ore ' + quando;
    void mostraNotifica(titolo, corpo, live.fermata.id, 'arrivo-' + chiave);
  }

  function avviaAvvisiArrivo() {
    if (avvisiArrivoTimer) return;
    avvisiArrivoTimer = setInterval(() => { controllaAvvisoArrivo(); }, AVVISO_ARRIVO_INTERVALLO);
    controllaAvvisoArrivo();
  }

  async function alternaAvvisoArrivo(linea, ora) {
    if (live.avvisa && live.avvisa.linea === linea && live.avvisa.ora === ora) {
      live.avvisa = null;
      renderLive();
      mostraToast('Avviso rimosso');
      return;
    }
    live.avvisa = { linea: linea, ora: ora };
    renderLive();
    const permesso = await permessoNotifiche();
    renderNotificheMenu();
    if (permesso === 'granted') {
      avviaAvvisiArrivo();
      controllaAvvisoArrivo();
      mostraToast('Ti avviso 2 minuti prima con una notifica (con app aperta o in background)');
    } else if (permesso === 'denied') {
      mostraToast("Avviso solo nell'app: notifiche bloccate dalle impostazioni del sito");
    } else if (permesso === 'unsupported') {
      mostraToast("Avviso solo nell'app: questo browser non supporta le notifiche");
    } else {
      mostraToast("Avviso solo nell'app: notifiche non attivate");
    }
  }

  async function alternaAvviso(slot) {
    const voce = vocePreferito(slot);
    if (!voce) return;
    if (avvisoAttivo(slot)) {
      scriviAvviso(slot, false);
      renderPreferiti();
      mostraToast('Avvisi spenti per ' + voce.etichetta);
      return;
    }
    const permesso = await permessoNotifiche();
    renderNotificheMenu();
    if (permesso === 'unsupported') {
      mostraToast('Questo browser non supporta le notifiche');
      return;
    }
    if (permesso === 'denied') {
      mostraToast('Notifiche bloccate: riattivale dalle impostazioni del sito');
      return;
    }
    if (permesso !== 'granted') {
      mostraToast('Notifiche non attivate');
      return;
    }
    scriviAvviso(slot, true);
    renderPreferiti();
    avviaAvvisi();
    controllaAvvisi();
    const fermata = fermataPerAvviso(voce.luogo);
    const esci = minutiPerUscire(voce.luogo, fermata);
    mostraToast(esci
      ? 'Ti avviso quando devi uscire: circa ' + esci + ' min a piedi fino a ' + nomeBreve(fermata.nome)
      : 'Ti avviso 5 minuti prima del bus da ' + voce.etichetta +
        " (con l'app aperta o in background)");
  }

  function apriCercaPreferito(slot) {
    const voce = vocePreferito(slot);
    if (!voce) return;
    chiudiMenu();
    preferitoInCorso = slot;
    apriCerca('destinazione');
    const input = $('cerca-input');
    if (!input) return;
    input.value = '';
    input.placeholder = voce.domanda;
    aggiornaPulisci();
    apriSuggerimenti('destinazione', '');
  }

  // Azioni dei preferiti: le usano sia il pannello sia il menu, che hanno due
  // gestori diversi. Restituisce true quando l'azione è stata gestita qui.
  function azionePreferito(azione, pulsante) {
    if (azione === 'pref-vai') {
      const scelto = preferitiValidi().find((v) => v.slot === pulsante.getAttribute('data-slot'));
      // Il menu deve chiudersi prima della ricerca: altrimenti resta sotto e
      // ricompare quando si chiude l'overlay.
      chiudiMenu();
      if (scelto) selezionaFermata('destinazione', scelto.luogo);
      return true;
    }
    if (azione === 'pref-scegli') {
      apriCercaPreferito(pulsante.getAttribute('data-slot'));
      return true;
    }
    if (azione === 'pref-avviso') {
      alternaAvviso(pulsante.getAttribute('data-slot'));
      return true;
    }
    if (azione === 'pref-rimuovi') {
      const slot = pulsante.getAttribute('data-slot');
      scriviAvviso(slot, false);
      const voce = vocePreferito(slot);
      if (salvaPreferito(slot, null)) mostraToast((voce ? voce.etichetta : 'Preferito') + ' rimosso');
      return true;
    }
    if (azione === 'pref-rinomina') {
      rinominaPreferito(pulsante.getAttribute('data-slot'));
      return true;
    }
    if (azione === 'pref-su') {
      spostaPreferito(pulsante.getAttribute('data-slot'), -1);
      return true;
    }
    if (azione === 'pref-giu') {
      spostaPreferito(pulsante.getAttribute('data-slot'), 1);
      return true;
    }
    if (azione === 'pref-aggiungi') {
      aggiungiPreferito();
      return true;
    }
    if (azione === 'pref-modifica') {
      preferitiModifica = !preferitiModifica;
      renderPreferiti();
      return true;
    }
    if (azione === 'apri-preferiti') {
      apriMenu();
      const riquadro = $('menu-preferiti');
      if (riquadro) riquadro.scrollIntoView({ block: 'center' });
      return true;
    }
    return false;
  }

  // Scegliere una voce nella ricerca serve sia al percorso sia ai preferiti:
  // cambia solo cosa se ne fa.
  function scegliLuogo(ruolo, luogo) {
    if (!preferitoInCorso) {
      selezionaFermata(ruolo, luogo);
      return;
    }
    const slot = preferitoInCorso;
    preferitoInCorso = null;
    if (!salvaPreferito(slot, luogo)) return;
    chiudiOverlay();
    const voce = vocePreferito(slot);
    mostraToast((voce ? voce.etichetta : 'Preferito') + ' salvato');
  }

  // Stato vuoto con azioni: tre chip che riempiono la ricerca in un tocco.
  function bloccoVuotoHTML() {
    if (sel.partenza && sel.destinazione) return '';
    const preferiti = preferitiValidi();
    let html = '<div class="vuoto-block">';
    // Prima ciò che è tuo (casa, lavoro), poi le mete generiche.
    if (preferiti.length) {
      html += '<div class="pref-chips">' + preferiti.map((voce) =>
        '<button type="button" class="chip-pref" data-azione="pref-vai" data-slot="' + voce.slot + '">' +
        Icone.svg(voce.icona, 16) + '<span>' + voce.etichetta + ' · ' + esc(nomeBreve(voce.luogo.nome)) + '</span></button>'
      ).join('') + '</div>';
    } else {
      // Una riga sola, e sparisce appena ci sono i preferiti: serve a far
      // scoprire la funzione, non a occupare spazio per sempre.
      html += '<button type="button" class="pref-aggiungi" data-azione="apri-preferiti">Salva casa e lavoro</button>';
    }
    html += '</div>';
    return html;
  }

  // Onboarding: tre slide, una volta sola, con Salta sempre disponibile.
  const onboarding = { slide: 0 };

  function mostraOnboarding() {
    if (leggi(K_ONBOARDING) === '1') return;
    const schermo = $('onboarding');
    if (!schermo) return;
    onboarding.slide = 0;
    schermo.hidden = false;
    aggiornaOnboarding();
  }

  function aggiornaOnboarding() {
    const slide = document.querySelectorAll('.ob-slide');
    Array.prototype.forEach.call(slide, (el, indice) => { el.hidden = indice !== onboarding.slide; });
    const punti = document.querySelectorAll('.ob-punto');
    Array.prototype.forEach.call(punti, (el, indice) => el.classList.toggle('attivo', indice === onboarding.slide));
    const avanti = $('ob-avanti');
    if (avanti) avanti.textContent = onboarding.slide >= slide.length - 1 ? 'Inizia' : 'Avanti';
  }

  function chiudiOnboarding() {
    const schermo = $('onboarding');
    if (schermo) schermo.hidden = true;
    scrivi(K_ONBOARDING, '1');
  }

  /* ------------------------------------------------------------------ *
   * Tasto indietro del browser: chiude un livello invece di uscire
   * ------------------------------------------------------------------ */
  // Lo stato della storia può sopravvivere a un ricaricamento: il flag parte
  // da lì invece che sempre da false.
  let statoPercorsoInStoria = !!(window.history && history.state && history.state.tper);

  // Il viaggio appena calcolato deve avere una voce con i suoi parametri: se
  // l'URL non li contiene ancora (tratta ripristinata dal salvataggio) si
  // aggiunge qui. Se li contiene, la voce è già stata creata alla scelta
  // della fermata e non se ne aggiunge una doppia.
  function segnalaStoriaPercorso() {
    if (!window.history || !history.pushState) return;
    const p = new URLSearchParams(location.search);
    if (p.get('da') && p.get('a')) { statoPercorsoInStoria = true; return; }
    aggiornaUrl('push');
    statoPercorsoInStoria = true;
  }

  // La voce consumata dall'indietro non esiste più: senza riallineare il flag
  // il percorso successivo non aggiungeva la sua voce e il tasto indietro
  // usciva dall'app.
  function aggiornaVoceStoria() {
    statoPercorsoInStoria = !!(window.history && history.state && history.state.tper);
  }

  // C'è ancora qualcosa che l'indietro può chiudere?
  function restaUnLivello() {
    if ($('onboarding') && !$('onboarding').hidden) return true;
    if ($('impostazioni') && !$('impostazioni').hidden) return true;
    if (!$('cerca').hidden) return true;
    if ($('drawer').classList.contains('aperto')) return true;
    if (statoSheet === 'piena' || statoSheet === 'meta') return true;
    return !!(sel.destinazione || miniFermata);
  }

  function indietroBrowser() {
    // Voce nostra con i parametri: si ripristina la ricerca precedente (solo
    // partenza, viaggio prima, linea o orari), non solo un livello di pannello.
    if (window.history && history.state && history.state.tper) {
      applicaStatoUrl();
      return;
    }
    try {
      indietroLivelli();
    } finally {
      aggiornaVoceStoria();
      // La voce consumata copriva un solo livello: se ne restano altri si
      // ricrea subito, così il prossimo indietro chiude un altro livello
      // invece di far uscire dall'app.
      if (!statoPercorsoInStoria && restaUnLivello()) segnalaStoriaPercorso();
    }
  }

  // Un livello per volta: overlay, menu, dettaglio, metà, poi il percorso.
  function indietroLivelli() {
    if ($('onboarding') && !$('onboarding').hidden) { chiudiOnboarding(); return; }
    if ($('impostazioni') && !$('impostazioni').hidden) { chiudiImpostazioni(); apriMenu(); return; }
    if (!$('cerca').hidden) { chiudiOverlay(); return; }
    if ($('drawer').classList.contains('aperto')) { chiudiMenu(); return; }
    if (statoSheet === 'piena') { impostaSheet('meta'); return; }
    if (statoSheet === 'meta' && (sel.partenza || sel.destinazione)) { impostaSheet('peek'); return; }
    if (sel.destinazione) { azzeraNavigazione(); return; }
    if (miniFermata) chiudiMini();
  }

  // Unica sorgente del pannello: campi, data/ora e risultato.
  function renderPercorso() {
    const vista = $('vista-percorso');
    if (!vista) return;
    const tratta = !!(sel.partenza && sel.destinazione);
    vista.classList.toggle('con-percorso', tratta);
    // Una sola superficie: partenza, destinazione e quando nella stessa
    // scheda. La riga del quando separata aggiungeva un blocco e uno stacco
    // inutili tra i campi e l'orario.
    vista.innerHTML =
      '<div class="campi">' + rigaCampoHTML('partenza') + rigaCampoHTML('destinazione') +
      '<div class="campo-riga campo-quando">' +
      '<button type="button" class="quando-btn" id="btn-quando" aria-expanded="' + (quandoAperto ? 'true' : 'false') + '">' +
      ICONA_OROLOGIO + '<span>' + esc(quandoEtichetta()) + '</span>' + ICONA_GIU + '</button>' +
      (sel.partenza && sel.destinazione
        ? '<button type="button" class="icona" data-azione="inverti" aria-label="Inverti e pianifica il ritorno">' + ICONA_SCAMBIA + '</button>'
        : '') +
      '</div>' +
      '</div>' +
      (quandoAperto ? pannelloQuandoHTML() : '') +
      (tratta ? '' : bloccoVuotoHTML()) +
      // Niente pulsante "Cerca percorso" senza destinazione: sarebbe un vicolo
      // cieco, e copriva le fermate vicine che sono il vero punto di partenza.
      '<div id="vista-risultato"></div>';
    collegaCampi();
    disegnaPercorso();
    // La riga del quando sta dentro la scheda: se il contenuto cambia mentre il
    // pannello è ridotto, il PEEK va rimisurato o taglia l'ultima riga.
    if (statoSheet === 'peek' && !trascinando) {
      requestAnimationFrame(() => applicaTrasformazione(traslazionePer('peek'), false));
    }
  }

  function collegaCampi() {
    const quando = $('btn-quando');
    if (quando) quando.addEventListener('click', () => { quandoAperto = !quandoAperto; renderPercorso(); });
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
    // Quanto si è disposti a camminare: cambia il raggio di ricerca a piedi.
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
        preparaCammini(true);
        routing.chiave = null;
        calcolaPercorso();
      });
    }
  }

  function totaleMinuti(e) {
    const uscita = Math.max(0, e.partenza - (e.camminoIniziale || 0));
    const arrivo = e.arrivo + (e.camminoFinale || 0);
    return Math.max(1, Math.round((arrivo - uscita) / 60));
  }

  // Sotto i 400 m il pianificatore usa solo il cammino: non serve un biglietto.
  function trattaAPiedi() {
    return !!(sel.partenza && sel.destinazione &&
      sel.partenza.lat != null && sel.partenza.lon != null &&
      sel.destinazione.lat != null && sel.destinazione.lon != null &&
      distanzaMetri(sel.partenza, sel.destinazione) < 400);
  }

  // Il prezzo dipende dal mezzo: se l'itinerario usa un treno vale la tariffa
  // regionale a km, altrimenti quella a zone.
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

  // Il people mover ha una tariffa separata: se l'itinerario scelto usa MEX
  // non si applica né il biglietto urbano né la tariffa regionale a km.
  function tappaMex() {
    const scelta = (routing.opzioni && routing.opzioni.length)
      ? (routing.opzioni[routing.aperto >= 0 ? routing.aperto : 0] || routing.esito)
      : routing.esito;
    if (!scelta || !Array.isArray(scelta.tappe)) return null;
    return scelta.tappe.find((tappa) => String(tappa.linea).toUpperCase() === 'MEX') || null;
  }

  function tariffaCorrente() {
    if (!sel.partenza || !sel.destinazione) return null;
    const tappa = tappaMex();
    if (tappa) {
      // Il tratto MEX può essere raggiunto a piedi da una palina bus: per la
      // tariffa contano gli estremi della monorotaia, non quelli del cammino.
      const da = fermataPerId(tappa.da) || sel.partenza;
      const a = fermataPerId(tappa.a) || sel.destinazione;
      const mex = Tariffe.calcolaMex(da, a);
      if (mex) return mex;
    }
    return Tariffe.calcola(sel.partenza, sel.destinazione, abbonamento, trenoNellItinerario());
  }

  function lineeBadge(e) {
    return (e.tappe || []).map((tappa) => {
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      const stile = !treno && tappa.colore
        ? ' style="background:' + esc(tappa.colore) + ';color:' + esc(Utilita.testoSuColore(tappa.colore, tappa.coloreTesto)) + '"'
        : '';
      return '<span class="linea' + (treno ? ' treno' : '') + '"' + stile + '>' + esc(tappa.linea) + '</span>';
    }).join('');
  }

  function htmlRiepilogo(r) {
    if (routing.stato !== 'ok' || !routing.esito) return '';
    const e = routing.esito;
    const prezzo = r && r.prezzo != null ? (r.prezzo === 0 ? 'Incluso' : euro(r.prezzo)) : '';
    const tappa = e.tappe && e.tappe[0];
    // L'orario di arrivo è il dato che si guarda per primo dopo la durata.
    const arrivo = e.arrivo + (e.camminoFinale || 0);
    let meta = 'Arrivo ' + hhmm(arrivo) + ' · ' + (tappa ? 'Linea ' + tappa.linea : 'A piedi');
    if (tappa) meta += ' · ' + tappa.fermate + (tappa.fermate === 1 ? ' fermata' : ' fermate');
    if (e.cambi) meta += ' · ' + (e.cambi === 1 ? '1 cambio' : e.cambi + ' cambi');
    const piedi = Math.round(((e.camminoIniziale || 0) + (e.camminoFinale || 0)) / 60);
    if (piedi >= 1) meta += ' · a piedi ' + piedi + ' min';
    // Abbonamento: una spunta accanto al prezzo, non un altro chip in alto.
    const spunta = prezzo === 'Incluso'
      ? '<span class="spunta-abb" role="img" aria-label="Coperto dall\'abbonamento urbano">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg></span>'
      : '';
    return '<div class="riepilogo">' +
      '<div class="riep-titolo">' + Utilita.durata(totaleMinuti(e)) + (prezzo ? ' · ' + esc(prezzo) + spunta : '') + htmlAvvisoPiano(e) + '</div>' +
      '<div class="riep-meta">' + esc(meta) + '</div>' +
      htmlSuggerimenti() +
      '<div class="riep-azioni">' +
      '<button type="button" class="btn btn-primario" data-azione="avvia-navigazione">Avvia</button>' +
      '<button type="button" class="btn btn-tenue" data-azione="dettagli">Dettagli</button>' +
      '<button type="button" class="btn btn-tenue" data-azione="salva-viaggio">Salva</button>' +
      '</div></div>';
  }

  // Un tratto a piedi è "stimato" quando OSRM non ha ancora dato la geometria:
  // il tempo viene dalla distanza in linea d'aria e va dichiarato, non spacciato
  // per un dato di strada. La geometria può arrivare dopo, e l'etichetta sparisce.
  function fermataDi(valore) {
    if (!valore) return null;
    return typeof valore === 'string' ? fermataPerId(valore) : valore;
  }

  function piediStimati(e) {
    if (!e) return false;
    const senzaGeometria = (da, a) => {
      const p = fermataDi(da);
      const q = fermataDi(a);
      if (!p || !q || p.lat == null || p.lon == null || q.lat == null || q.lon == null) return false;
      // La cache pedonale è per direzione, ma la lunghezza non cambia: un tratto
      // chiesto da destinazione a candidata vale anche al contrario.
      return !geometriaPiedi([p.lon, p.lat], [q.lon, q.lat]) &&
        !geometriaPiedi([q.lon, q.lat], [p.lon, p.lat]);
    };
    if ((e.camminoIniziale || 0) > 0 && senzaGeometria(sel.partenza, e.da)) return true;
    if ((e.camminoFinale || 0) > 0 && senzaGeometria(e.a, sel.destinazione)) return true;
    return (e.tappe || []).some((t) => t.camminoPrima && (t.camminoPrima.secondi || 0) > 0 &&
      senzaGeometria(t.camminoPrima.da, t.da));
  }

  function htmlAlternative() {
    const opzioni = routing.opzioni || [];
    if (opzioni.length < 2 && !routing.opzionePiedi) return '';
    const scelto = routing.aperto >= 0 ? routing.aperto : 0;
    const righe = opzioni.map((e, indice) => {
      const uscita = Math.max(0, e.partenza - (e.camminoIniziale || 0));
      const arrivo = e.arrivo + (e.camminoFinale || 0);
      const piedi = Math.round(((e.camminoIniziale || 0) + (e.camminoFinale || 0)) / 60);
      const meta = Utilita.durata(totaleMinuti(e)) + ' · ' +
        (e.cambi === 0 ? 'diretto' : e.cambi === 1 ? '1 cambio' : e.cambi + ' cambi') +
        (piedi ? ' · a piedi ' + piedi + ' min' : '');
      // Il margine è già calcolato dalla ricerca: qui si mostra, e sotto i due
      // minuti si dice che è poco invece di lasciarlo scoprire a destinazione.
      const margine = routing.modo === 'arrivo' && e.margine != null
        ? Math.round(e.margine / 60) : null;
      const note =
        (margine != null && margine >= 0
          ? ' · ' + margine + ' min di margine' +
            (e.margine < MARGINE_POCO ? ' <span class="margine-poco">poco margine</span>' : '')
          : '') +
        (piediStimati(e) ? ' · <span class="piedi-stimati">tempi a piedi stimati</span>' : '');
      return '<button type="button" class="opzione-riga" data-opzione="' + indice + '" aria-current="' + (indice === scelto ? 'true' : 'false') + '">' +
        '<span class="testo"><span class="orari">' + hhmm(uscita) + ' → ' + hhmm(arrivo) + '</span>' +
        '<span class="meta">' + esc(meta) + note + '</span></span>' +
        '<span class="linee">' + lineeBadge(e) + '</span></button>';
    }).join('');
    const aperte = alternativeAperte || statoSheet === 'piena';
    const altre = Math.max(1, opzioni.length - 1 + (routing.opzionePiedi ? 1 : 0));
    return '<button type="button" class="altre" data-azione="altre" aria-expanded="' + (aperte ? 'true' : 'false') + '">' +
      '<span>Altre ' + altre + ' soluzioni</span>' + ICONA_GIU + '</button>' +
      '<div class="opzioni"' + (aperte ? '' : ' hidden') + '>' + righe + htmlPiediAlternativa() + '</div>';
  }

  // Alternativa a piedi fino a 2 km: una riga nella lista che c'è già, non una
  // scheda nuova. Si sceglie come le altre proposte.
  function htmlPiediAlternativa() {
    const offerta = routing.opzionePiedi;
    if (!offerta) return '';
    return '<button type="button" class="opzione-riga" data-opzione="piedi" aria-current="' +
      (routing.stato === 'piedi' ? 'true' : 'false') + '">' +
      '<span class="testo"><span class="orari">A piedi · ' + offerta.minuti + ' min</span>' +
      '<span class="meta">' + offerta.metri + ' m, senza cambi</span></span>' +
      '<span class="linee"></span></button>';
  }

  function mostraPiedi() {
    const offerta = routing.opzionePiedi;
    if (!offerta || !sel.partenza || !sel.destinazione) return;
    if (sel.partenza.lat == null || sel.destinazione.lat == null) return;
    routing.stato = 'piedi';
    routing.piedi = {
      metri: offerta.metri,
      minuti: offerta.minuti,
      chiave: Piedi.chiave(
        [sel.partenza.lon, sel.partenza.lat],
        [sel.destinazione.lon, sel.destinazione.lat]
      )
    };
    disegnaPercorso();
  }

  // Consigli sul biglietto: solo fatti che l'app conosce davvero (zone, mezzo,
  // listino). Meglio nessun consiglio che un risparmio inventato.
  function consigliBiglietto(r) {
    const consigli = [];
    if (!r || r.prezzo == null || r.prezzo === 0) return consigli;
    const p = sel.partenza;
    const d = sel.destinazione;
    const urbane = !!(p && d && Tariffe.isZonaUrbana(p.zona) && Tariffe.isZonaUrbana(d.zona));
    if (urbane) {
      consigli.push('Tratta tutta in area urbana: <b>l\'abbonamento urbano</b> (zone 500–509) la copre.');
    }
    if (trenoNellItinerario().treno) {
      consigli.push('Sul treno il prezzo segue i chilometri (tariffa regionale 2ª classe), non le zone.');
    } else if (!urbane) {
      consigli.push('Fuori dalle zone 500–509 il biglietto urbano non basta: serve l\'integrazione.');
    }
    return consigli.slice(0, 2);
  }

  function bigliettoHTML(r) {
    if (!r) return '';
    const prezzo = r.prezzo === null ? '—' : (r.prezzo === 0 ? 'Incluso' : euro(r.prezzo));
    const nota = r.prezzo === 0 ? 'Nessun costo aggiuntivo' : r.prezzoNota;
    const consigli = consigliBiglietto(r);
    return '<details class="biglietto">' +
      '<summary><span class="b-prezzo">' + esc(prezzo) + '</span><span class="b-nota">' + esc(nota) + '</span></summary>' +
      '<div class="b-corpo">' +
      '<span class="b-stato">' + esc(r.titolo) + '</span>' +
      (r.avviso ? '<p>' + esc(r.avviso) + '</p>' : '') +
      '<div class="riga b-riga"><span class="etichetta">Ho l\'abbonamento urbano' +
      '<button type="button" class="btn-info" data-azione="spiega-abbonamento" aria-expanded="false"' +
      ' aria-label="Cosa copre l\'abbonamento urbano">i</button></span>' +
      '<span class="interruttore"><input type="checkbox" id="check-abbonamento"' + (abbonamento ? ' checked' : '') +
      ' aria-label="Ho l\'abbonamento urbano"><span class="binario"></span></span></div>' +
      '<p class="b-spiega" id="spiega-abbonamento" hidden>L\'abbonamento urbano copre la zona 500 (Bologna città) e le zone neutre 501–509. Per uscire servono le integrazioni extraurbane.</p>' +
      (consigli.length ? '<p class="b-conviene">' + consigli[0] + '</p>' : '') +
      convieneHTML(r) +
      '<a href="' + URL_UFFICIALE + '" target="_blank" rel="noopener">Calcolatore TPER</a>' +
      '</div></details>';
  }

  // Confronto biglietti/abbonamento: il prezzo dell'abbonamento non è nei dati
  // aperti TPER, quindi lo scrive chi lo paga invece di inventarlo.
  function convieneHTML(r) {
    if (!r || !r.prezzo || r.prezzo <= 0) return '';
    return '<details class="conviene" data-prezzo="' + esc(String(r.prezzo)) + '">' +
      '<summary>Ti conviene l\'abbonamento?</summary>' +
      '<div class="conviene-corpo">' +
      '<label class="conviene-riga"><span>Corse a settimana</span>' +
      '<input type="number" id="conviene-corse" inputmode="numeric" min="1" max="60" step="1" value="10"></label>' +
      '<label class="conviene-riga"><span>Abbonamento al mese (€)</span>' +
      '<input type="number" id="conviene-prezzo" inputmode="decimal" min="0" step="0.10" placeholder="39,00"></label>' +
      '<p class="conviene-esito" id="conviene-esito" role="status"></p>' +
      '<p class="micro" style="margin:0">Ogni corsa costa ' + esc(euro(r.prezzo)) +
      '. Il prezzo dell\'abbonamento non è nei dati aperti: scrivi quello che paghi davvero.</p>' +
      '</div></details>';
  }

  function aggiornaConvenienza() {
    const esito = $('conviene-esito');
    if (!esito) return;
    const box = esito.closest('.conviene');
    if (!box) return;
    const campoCorse = $('conviene-corse');
    const campoPrezzo = $('conviene-prezzo');
    const prezzoAbbonamento = campoPrezzo ? Number(campoPrezzo.value) : NaN;
    const conto = Tariffe.convenienza({
      corseSettimana: campoCorse ? Number(campoCorse.value) : NaN,
      prezzoAbbonamento: prezzoAbbonamento,
      prezzoCorsa: Number(box.getAttribute('data-prezzo'))
    });
    if (!conto) {
      esito.textContent = 'Scrivi quante corse fai a settimana.';
      return;
    }
    const testa = 'Con ' + conto.corseMese + ' corse al mese spendi ' + euro(conto.spesaMese) + ' in biglietti';
    if (conto.conviene === null) {
      esito.textContent = testa + '. Scrivi il prezzo dell\'abbonamento per il confronto.';
    } else if (conto.conviene) {
      esito.textContent = testa + ': l\'abbonamento conviene già da ' + conto.sogliaCorse +
        ' corse al mese e con il tuo risparmi ' + euro(conto.risparmio) + '.';
    } else {
      esito.textContent = testa + ', meno dell\'abbonamento da ' + euro(prezzoAbbonamento) +
        ': per ora non conviene. Conviene da ' + conto.sogliaCorse + ' corse al mese.';
    }
  }

  function htmlDettaglio(r) {
    const e = routing.esito;
    if (routing.stato !== 'ok' || !e) return '';
    return '<div class="dettaglio">' +
      '<h2 class="sez">Viaggio</h2>' +
      VistaPercorso.dettaglio(e, etichettaFermata) +
      '<div class="live-percorso" id="live-percorso" hidden></div>' +
      bigliettoHTML(r) +
      '</div>';
  }

  // Quando non c'è più nulla nella finestra di ricerca, il pulsante non deve
  // mandare l'utente a un orario arbitrario: si cerca la prima corsa utile
  // nelle prossime 24 ore, a passi di 15 minuti, e la si apre davvero.
  async function cercaProssimaCorsa() {
    if (!sel.partenza || !sel.destinazione) return;
    if (typeof TPERRouting === 'undefined') return;
    mostraToast('Cerco la prossima corsa…');
    try {
      if (!TPERRouting.disponibile()) await TPERRouting.carica(URL_ORARI_GZ, URL_ORARI);
      const da = candidatiPercorso(sel.partenza);
      const a = candidatiPercorso(sel.destinazione);
      if (!da.length || !a.length) {
        mostraToast('Nessuna fermata con orari vicino a questa ricerca');
        return;
      }
      let inizio = dataDaGiornoEOra(routing.giorno, routing.orario);
      if (!isFinite(inizio.getTime()) || inizio.getTime() < Date.now()) inizio = new Date();
      inizio.setSeconds(0, 0);
      inizio.setMinutes(Math.ceil(inizio.getMinutes() / 15) * 15);
      const scadenza = Date.now() + 4500;
      const limite = inizio.getTime() + 24 * 3600000;
      for (let quando = inizio; quando.getTime() <= limite; quando = new Date(quando.getTime() + 15 * 60000)) {
        if (Date.now() > scadenza) break;
        const esito = TPERRouting.calcola(da, a, quando, {
          maxCambi: 3,
          vietate: vietatePer(),
          camminoMax: camminata * 60,
        });
        if (esito && !esito.errore) {
          // Il motore può restituire una corsa che parte molto dopo l'istante
          // di ricerca: si apre l'ora reale della prima corsa, non il minuto
          // da cui si è partiti a cercare.
          const prima = esito.tappe && esito.tappe[0];
          let uscita = quando;
          if (prima && prima.partenza != null) {
            const base = dataDaGiornoEOra(isoDi(quando), '00:00');
            const secondi = prima.partenza - (esito.camminoIniziale || 0) - 60;
            const calcolata = new Date(base.getTime() + secondi * 1000);
            if (isFinite(calcolata.getTime())) uscita = calcolata;
          }
          routing.modo = 'partenza';
          aggiornaQuando(isoDi(uscita), due(uscita.getHours()) + ':' + due(uscita.getMinutes()), false);
          mostraToast('Prima corsa utile: ' + due(uscita.getHours()) + ':' + due(uscita.getMinutes()));
          return;
        }
        const pausa = respira();
        if (pausa) await pausa;
      }
    } catch (errore) { /* si resta nello stato vuoto */ }
    mostraToast('Nessuna corsa utile trovata nelle prossime 24 ore');
  }

  function htmlStatoPercorso() {
    if (routing.stato === 'caricamento' || routing.stato === 'idle') {
      return '<div class="schema" aria-busy="true"><span></span><span></span><span></span></div>';
    }
    if (routing.stato === 'errore') {
      // Una riga, non un banner: il percorso non c'è, ma l'app resta usabile.
      return '<div class="box">Dati non aggiornati · ' +
        '<button type="button" class="link" data-azione="riprova-percorso" style="min-height:0;padding:0">riprova</button>' +
        (routing.errore ? '<span class="micro" style="margin:6px 0 0">' + esc(routing.errore) + '</span>' : '') + '</div>';
    }
    if (routing.stato === 'piedi') {
      return '<div class="box">Ci arrivi a piedi: ' + routing.piedi.metri + ' m, circa ' + routing.piedi.minuti + ' min.' +
        (routing.opzioni && routing.opzioni.length
          ? '<div style="margin-top:10px"><button type="button" class="btn btn-tenue" data-azione="torna-bus">Mostra il bus</button></div>'
          : '') + '</div>';
    }
    if (routing.stato === 'messaggio') {
      const codice = routing.esito && routing.esito.errore;
      const testo = codice === 'senza-orari'
        ? 'Nessuna fermata con orari entro ' + camminata + ' min a piedi. Prova ad aumentare i minuti a piedi.'
        : 'Percorso non disponibile per queste fermate.';
      return '<div class="box">' + esc(testo) + '</div>';
    }
    if (routing.stato === 'nessuno') {
      const testo = routing.modo === 'arrivo'
        ? 'Nessun viaggio arriva entro le ' + esc(routing.orario) + ' con ' +
          Math.round(MARGINE_ARRIVO / 60) + ' minuti di margine.'
        : 'Nessun viaggio a quest\'ora.';
      const evitate = lineeEvitate();
      return '<div class="box">' + esc(testo) +
        (evitate.length
          ? '<div class="micro" style="margin-top:6px">Stai evitando ' + esc(evitate.join(', ')) +
            ': toglile dal menu → Linee da evitare per rivederle.</div>'
          : '') +
        '<div style="margin-top:10px"><button type="button" class="btn btn-tenue" data-azione="prossima-corsa">Cerca la prossima corsa</button></div></div>';
    }
    if (routing.stato === 'ok') {
      return htmlAlternative() + htmlDettaglio(tariffaCorrente());
    }
    return '';
  }

  // Fermate fissate: oltre a Casa e Lavoro, le due o tre che si usano ogni
  // giorno (scuola, palestra, stazione). Massimo tre, per non fare un secondo
  // elenco di preferiti.
  function fermateFisse() {
    const ids = leggiJSON(K_FISSE);
    return (Array.isArray(ids) ? ids : []).map(fermataPerId).filter(Boolean).slice(0, 3);
  }

  function secondiAdesso() {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  // Prossime partenze reali da una fermata, su tutte le linee del dataset.
  function prossimeAllaFermata(id, limite) {
    const indice = lineeIndice();
    if (!indice) return [];
    const attive = serviziDelGiorno();
    const ora = secondiAdesso();
    const elenco = [];
    indice.forEach((linea) => {
      linea.gruppi.forEach((gruppo) => {
        const k = gruppo.fermate.lastIndexOf(id);
        if (k < 0 || k >= gruppo.fermate.length - 1) return;
        Linee.partenze(linea, gruppo.capolinea, attive, k).forEach((voce) => {
          if (voce.fermata === id && voce.secondi >= ora) {
            elenco.push({ linea: linea.nome, secondi: voce.secondi, capolinea: gruppo.capolinea });
          }
        });
      });
    });
    return elenco.sort((a, b) => a.secondi - b.secondi).slice(0, limite || 3);
  }

  function listaViciniHTML() {
    let elenco;
    if (sel.partenza && sel.partenza.lat != null) {
      elenco = senzaDoppioni(fermateVicine(sel.partenza.lat, sel.partenza.lon, 10, sel.partenza.id)
        .filter((f) => f.nome !== sel.partenza.nome)).slice(0, 6);
    } else {
      elenco = posizioneUtente
        ? senzaDoppioni(fermateVicine(posizioneUtente.lat, posizioneUtente.lon, 8)).slice(0, 6)
        : fermatePrincipali();
    }
    const fisse = fermateFisse();
    let testa = '';
    if (fisse.length) {
      testa = fisse.map((f) => {
        const prossima = prossimeAllaFermata(f.id, 1)[0];
        return '<button type="button" class="voce" data-apri-fissa="' + esc(f.id) + '">' +
          '<span class="voce-ico">' + ICONA_BUS + '</span>' +
          '<span class="voce-testo"><span class="voce-nome">' + esc(nomeFermataBreve(f.nome, f.tipo)) + '</span>' +
          '<span class="voce-motivo">' + (prossima
            ? 'Linea ' + esc(prossima.linea) + ' · ' + esc(hhmm(prossima.secondi))
            : 'Tocca per gli orari') + '</span></span>' + ICONA_PIU + '</button>';
      }).join('');
    }
    if (!elenco.length) return testa;
    const titolo = sel.partenza && sel.partenza.lat != null ? 'Vicine a ' + nomeLuogo(sel.partenza) : 'Fermate vicine';
    const nomi = nomiCompatti(elenco);
    return testa + '<div class="gruppo">' + esc(titolo) + '</div>' +
      elenco.map((f) => voceHTML(f, 'destinazione', '', false, nomi.get(f.id))).join('');
  }

  // Il pannello si ridisegna quando cambia la tariffa (abbonamento) o la scelta.
  function aggiornaCardBiglietto() {
    const card = document.querySelector('.biglietto');
    if (!card) return;
    const r = tariffaCorrente();
    if (!r) return;
    const prezzo = r.prezzo === null ? '—' : (r.prezzo === 0 ? 'Incluso' : euro(r.prezzo));
    const nota = card.querySelector('.b-nota');
    const testa = card.querySelector('.b-prezzo');
    if (testa) testa.textContent = prezzo;
    if (nota) nota.textContent = r.prezzo === 0 ? 'Nessun costo aggiuntivo' : r.prezzoNota;
  }

  function collegaRisultato() {
    const check = $('check-abbonamento');
    if (check) {
      check.addEventListener('change', () => {
        impostaAbbonamento(check.checked);
        sincronizzaMenu();
        renderPercorso();
      });
    }
  }

  // Un solo tasto in alto a sinistra: indietro quando c'è qualcosa da chiudere
  // (percorso o orari di una fermata), hamburger nella schermata iniziale.
  function aggiornaBarra() {
    const haPercorso = !!(sel.partenza && sel.destinazione);
    // Anche una scelta incompleta deve poter essere annullata: con la sola
    // destinazione il tasto torna indietro, non sparisce lasciando l'utente
    // senza modo di chiudere la ricerca. La posizione automatica non conta:
    // in home il tasto resta il menu.
    const haScelta = !!sel.destinazione || !!(sel.partenza && !sel.partenza.gps);
    const torna = haScelta || vistaAttiva !== 'percorso';
    const barra = $('barra');
    if (!barra) return;
    barra.classList.toggle('torna', torna);
    const tasto = $('btn-menu');
    if (tasto) {
      tasto.setAttribute('aria-label', torna ? 'Torna indietro' : 'Apri il menu');
      if (torna) tasto.removeAttribute('aria-controls');
      else tasto.setAttribute('aria-controls', 'drawer');
    }
    // Con la freccia a sinistra, il menu si apre dal tasto a destra.
    const menuDestra = $('btn-menu-destra');
    if (menuDestra) menuDestra.hidden = !torna;
    const inquadra = $('btn-inquadra');
    if (inquadra) inquadra.hidden = !(haPercorso && routing.stato === 'ok');
    // Il titolo si compone solo con entrambi i capi scelti: aprendo gli orari
    // di una fermata senza percorso il vecchio codice leggeva null.nome.
    document.title = (sel.partenza && sel.destinazione)
      ? nomeLuogo(sel.partenza) + ' → ' + nomeLuogo(sel.destinazione) + ' · Muovi Bologna'
      : 'Muovi Bologna';
    const piede = $('drawer-aggiornato');
    if (piede) {
      const [anno, mese, giorno] = String(aggiornato || '').split('-');
      piede.textContent = anno ? 'Dati aggiornati al ' + giorno + '/' + mese + '/' + anno : 'Dati locali';
    }
    aggiornaVisibilitaFermate();
  }

  /* Mini-card della fermata: orari e impostazione come partenza o arrivo. */
  function apriMini(f) {
    if (!f) return;
    miniFermata = f;
    const box = $('mini-fermata');
    if (!box) return;
    $('mini-nome').textContent = nomeLuogo(f);
    const linee = lineaDi(f).slice(0, 4);
    $('mini-meta').textContent = (eIndirizzo(f) ? 'Indirizzo' : 'Palina ' + f.id) +
      (dettaglioFermata(f) ? ' · ' + dettaglioFermata(f) : '') +
      ' · zona ' + f.zona + (linee.length ? ' · ' + linee.join(' · ') : '');
    box.hidden = false;
    // La mini-card occupa il bordo inferiore: i comandi mappa si tolgono.
    const comandi = $('mappa-comandi');
    if (comandi) comandi.hidden = true;
  }

  function chiudiMini() {
    miniFermata = null;
    const box = $('mini-fermata');
    if (box) box.hidden = true;
    const comandi = $('mappa-comandi');
    if (comandi) comandi.hidden = false;
  }

  function apriOrari(f, opzioni) {
    if (!f) return;
    chiudiMini();
    live.fermata = f;
    live.stopId = null;
    live.items = [];
    live.ts = 0;
    live.stato = 'idle';
    live.avviso = '';
    live.aperto = -1;
    live.avvisa = null;
    // Gli orari programmati arrivano dal GTFS: se non sono ancora in memoria
    // si caricano adesso e la vista si ridisegna da sola.
    if (typeof TPERRouting !== 'undefined' && TPERRouting.carica &&
        !(typeof TPERRouting.disponibile === 'function' && TPERRouting.disponibile())) {
      TPERRouting.carica(URL_ORARI_GZ, URL_ORARI).then(() => {
        if (vistaAttiva === 'orari' && fermataLive() === f) renderLive();
      }).catch(() => { /* resta il tempo reale */ });
    }
    mostraVista('orari');
    impostaSheet('piena');
    if (!opzioni || opzioni.storia !== false) aggiornaUrl('push');
    caricaLive(true);
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

  /* ------------------------------------------------------------------ *
   * Viaggio condivisibile: lo stato nei parametri dell'URL
   * ------------------------------------------------------------------ */
  // Una fermata si condivide per id; un indirizzo per coordinate e nome.
  function parametroLuogo(luogo) {
    if (!luogo) return null;
    // La posizione GPS non finisce negli URL condivisi: è un dato personale e
    // l'app non lo salva mai. La partenza da qui resta solo in memoria.
    if (luogo.gps) return null;
    if (luogo.id && !/^geo:/.test(luogo.id) && fermataPerId(luogo.id)) return luogo.id;
    if (luogo.lat == null || luogo.lon == null) return null;
    return [luogo.lat.toFixed(5), luogo.lon.toFixed(5), nomeBreve(luogo.nome || '')].join(',');
  }

  // `push` crea una voce vera di cronologia quando la ricerca cambia (scelta
  // di una fermata, linea o orari): il tasto indietro del browser torna al
  // viaggio precedente, non soltanto riscrive l'URL.
  function aggiornaUrl(modo) {
    if (!window.history || !history.replaceState) return;
    const p = new URLSearchParams();
    const da = parametroLuogo(sel.partenza);
    const a = parametroLuogo(sel.destinazione);
    if (da) p.set('da', da);
    if (a) p.set('a', a);
    if (routing.giorno) p.set('g', routing.giorno);
    if (!routing.adesso && routing.orario) p.set('o', routing.orario);
    if (routing.modo === 'arrivo') p.set('m', 'arrivo');
    if (lineaVista.nome) p.set('linea', lineaVista.nome);
    if (vistaAttiva === 'orari' && live.fermata) p.set('fermata', live.fermata.id);
    const q = p.toString();
    const indirizzo = location.pathname + (q ? '?' + q : '') + location.hash;
    try {
      if (modo === 'push' && !ripristinandoStoria) {
        const profondita = (history.state && history.state.tper ? history.state.profondita : 0) + 1;
        history.pushState({ tper: true, profondita: profondita }, '', indirizzo);
      } else {
        const stato = history.state && history.state.tper ? history.state : { tper: true, profondita: 0 };
        history.replaceState(stato, '', indirizzo);
      }
    } catch (errore) { /* alcuni browser limitano replaceState */ }
  }

  function luogoDaParam(valore) {
    if (!valore) return null;
    const fermata = fermataPerId(valore);
    if (fermata) return fermata;
    const pezzi = String(valore).split(',');
    if (pezzi.length < 2) return null;
    const lat = parseFloat(pezzi[0]);
    const lon = parseFloat(pezzi[1]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const vicina = fermateVicine(lat, lon, 1)[0];
    return {
      id: 'geo:' + lat.toFixed(5) + ',' + lon.toFixed(5),
      nome: pezzi.slice(2).join(',') || 'Punto scelto',
      indirizzo: '',
      lat: lat, lon: lon,
      zona: vicina ? vicina.zona : '500',
      tipo: 'indirizzo', genere: 'indirizzo', categoria: 'Punto scelto'
    };
  }

  function luogoDaPosizione(posizione, nome) {
    const lat = Number(posizione.lat);
    const lon = Number(posizione.lon);
    const vicina = fermateVicine(lat, lon, 1)[0];
    return {
      id: 'geo:' + lat.toFixed(5) + ',' + lon.toFixed(5),
      nome: nome || 'La mia posizione',
      indirizzo: '',
      lat: lat,
      lon: lon,
      zona: vicina ? vicina.zona : '500',
      tipo: 'indirizzo',
      genere: 'indirizzo',
      categoria: 'Posizione attuale',
      gps: true
    };
  }

  function luogoDaCoordinate(lat, lon, nome) {
    const vicina = fermateVicine(lat, lon, 1)[0];
    return {
      id: 'geo:' + Number(lat).toFixed(5) + ',' + Number(lon).toFixed(5),
      nome: nome || 'Luogo condiviso',
      indirizzo: '',
      lat: lat,
      lon: lon,
      zona: vicina ? vicina.zona : '500',
      tipo: 'indirizzo',
      genere: 'luogo',
      categoria: 'Luogo condiviso'
    };
  }

  async function geocodificaCondivisione(testo) {
    const url = NOMINATIM + '?format=jsonv2&addressdetails=1&namedetails=1&limit=1&dedupe=1&accept-language=it&countrycodes=it' +
      '&q=' + encodeURIComponent(testo);
    const risposta = await fetch(url, {
      signal: segnaleConTimeout(null, TIMEOUT_NOMINATIM),
      headers: { Accept: 'application/json' }
    });
    if (!risposta.ok) return null;
    const elenco = await risposta.json();
    const voce = Array.isArray(elenco) ? elenco[0] : null;
    if (!voce) return null;
    const lat = parseFloat(voce.lat);
    const lon = parseFloat(voce.lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const indirizzo = voce.address || {};
    const via = indirizzo.road || indirizzo.pedestrian || indirizzo.footway || indirizzo.square || '';
    const civico = indirizzo.house_number ? ' ' + indirizzo.house_number : '';
    const nome = nomeNominatim(voce) || ((via + civico).trim() || String(voce.display_name || '').split(',')[0].trim());
    return {
      id: 'geo:' + lat.toFixed(5) + ',' + lon.toFixed(5),
      nome: nome || testo,
      indirizzo: voce.display_name || '',
      lat: lat,
      lon: lon,
      zona: (fermateVicine(lat, lon, 1)[0] || {}).zona || '500',
      tipo: 'indirizzo',
      genere: genereNominatim(voce),
      categoria: categoriaNominatim(voce)
    };
  }

  // Web Share Target: un luogo condiviso da Maps, WhatsApp o dal browser
  // diventa la destinazione. Se il link ha coordinate non serve geocodificare;
  // altrimenti si prova il nome della fermata e, solo dopo, Nominatim.
  async function gestisciCondivisione(parametri) {
    const titolo = parametri.get('title') || '';
    const testo = parametri.get('text') || '';
    const link = parametri.get('url') || '';
    const contenuto = [titolo, testo, link].filter(Boolean).join(' ');
    if (!contenuto) return;
    const coord = Utilita.coordinateCondivise(contenuto);
    let luogo = null;
    if (coord) {
      luogo = luogoDaCoordinate(coord.lat, coord.lon, Utilita.testoCondiviso(titolo || testo) || 'Luogo condiviso');
    } else {
      const query = Utilita.testoCondiviso(testo || titolo);
      if (query) {
        const fermata = cercaFermate(query)[0];
        if (fermata) luogo = fermata;
        else {
          try { luogo = await geocodificaCondivisione(query); } catch (errore) { luogo = null; }
        }
      }
    }
    if (!luogo) {
      mostraToast('Luogo condiviso non riconosciuto');
      return;
    }
    sel.destinazione = luogo;
    impostaInput('destinazione');
    aggiornaMarker();
    salvaTratta();
    routing.chiave = null;
    mostraVista('percorso');
    impostaSheet('meta');
    renderPercorso();
    aggiornaUrl('replace');
    if (sel.partenza) calcolaPercorso();
    else setTimeout(partenzaDallaPosizione, 150);
    mostraToast('Destinazione condivisa: ' + nomeBreve(luogo.nome));
  }

  // Letto una volta all'avvio: i parametri vincono sulla tratta salvata.
  function leggiUrl() {
    const p = new URLSearchParams(location.search);
    let usato = false;
    const da = luogoDaParam(p.get('da'));
    const a = luogoDaParam(p.get('a'));
    if (da) { sel.partenza = da; usato = true; }
    if (a) { sel.destinazione = a; usato = true; }
    const g = p.get('g');
    if (/^\d{4}-\d{2}-\d{2}$/.test(g || '')) { routing.giorno = g; usato = true; }
    const o = p.get('o');
    if (/^\d{2}:\d{2}$/.test(o || '')) { routing.orario = o; routing.adesso = false; usato = true; }
    if (p.get('m') === 'arrivo') { routing.modo = 'arrivo'; usato = true; }
    if (usato) { routing.chiave = null; salvaQuando(); }
    // La voce corrente è nostra ma non ha un «prima»: all'avvio il tasto
    // indietro non deve riaprire un viaggio che non esiste.
    try { history.replaceState({ tper: true, profondita: 0 }, '', location.href); } catch (errore) { /* niente */ }
    return p;
  }

  // Stato completo ricostruito dall'URL: serve al tasto indietro del browser.
  // A differenza di leggiUrl, che all'avvio lascia la tratta salvata quando i
  // parametri mancano, qui l'assenza di un capo significa che non c'era.
  function applicaStatoUrl() {
    const p = new URLSearchParams(location.search);
    ripristinandoStoria = true;
    try {
      if (navigazione.attiva) fermaNavigazione(true);
      if (!$('cerca').hidden) chiudiOverlay();
      if ($('drawer').classList.contains('aperto')) chiudiMenu();
      if (miniFermata) chiudiMini();
      sel.partenza = luogoDaParam(p.get('da'));
      sel.destinazione = luogoDaParam(p.get('a'));
      impostaInput('partenza');
      impostaInput('destinazione');
      const g = p.get('g');
      routing.giorno = /^\d{4}-\d{2}-\d{2}$/.test(g || '') ? g : oggiISO();
      const o = p.get('o');
      routing.adesso = !/^\d{2}:\d{2}$/.test(o || '');
      routing.orario = routing.adesso ? oraAdesso() : o;
      routing.modo = p.get('m') === 'arrivo' ? 'arrivo' : 'partenza';
      // Una risposta ancora in volo per lo stato precedente non deve
      // sovrascrivere quello che il tasto indietro ha appena ripristinato.
      routing.richiesta += 1;
      routing.chiave = null;
      routing.stato = 'idle';
      routing.esito = null;
      routing.opzioni = [];
      routing.piedi = null;
      routing.opzionePiedi = null;
      routing.suggerimento = null;
      routing.avvisoRitardo = '';
      routing.aperto = -1;
      salvaQuando();
      aggiornaMarker();
      salvaTratta();
      const linea = p.get('linea');
      const fermata = fermataPerId(p.get('fermata'));
      lineaVista.nome = linea ? linea.toUpperCase() : null;
      lineaVista.capolinea = null;
      vistaRitorno = linea ? 'linea' : null;
      if (fermata) {
        apriOrari(fermata, { storia: false });
      } else if (lineaVista.nome) {
        apriLinea(lineaVista.nome, { storia: false });
      } else {
        vistaRitorno = null;
        mostraVista('percorso');
        if (sel.partenza && sel.destinazione) calcolaPercorso();
        else { renderPercorso(); impostaSheet('peek'); }
      }
    } finally {
      ripristinandoStoria = false;
    }
    aggiornaUrl('replace');
    // Ripristinando una voce senza partenza (un link condiviso non contiene
    // mai il GPS) si riparte dalla posizione attuale, come in home.
    if (!sel.partenza && !p.get('da')) setTimeout(partenzaDallaPosizione, 250);
  }

  // Prima di disegnare o calcolare, data e ora devono avere un valore. In
  // modalità "adesso" l'ora segue il tempo reale a ogni ridisegno.
  function assicuraQuando() {
    if (!routing.giorno) routing.giorno = oggiISO();
    if (routing.adesso) {
      // Dopo mezzanotte la data salvata è quella di ieri: in modalità "adesso"
      // il giorno segue l'orologio, altrimenti il pannello orari resta vuoto.
      const oggi = oggiISO();
      if (routing.giorno !== oggi) {
        routing.giorno = oggi;
        routing.orario = oraAdesso();
        routing.chiave = null;
        const campoData = $('input-data');
        if (campoData) campoData.value = oggi;
        salvaQuando();
      }
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
    // La riga «Quando» è fuori dal risultato: senza questo aggiornamento
    // resterebbe all'orario precedente dopo un cambio o un ritorno.
    const etichetta = $('btn-quando');
    if (etichetta) {
      etichetta.innerHTML = ICONA_OROLOGIO + '<span>' + esc(quandoEtichetta()) + '</span>' + ICONA_GIU;
    }
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

  // Firma del percorso: linee usate e orari di partenza. Con i soli modi due
  // strade diverse risultavano uguali; con le sole linee due corse della stessa
  // linea a qualche minuto di distanza collassavano in una.
  function firmaLinee(e) {
    return (e.tappe || []).map((tappa) => tappa.linea).join('>');
  }

  function firmaPercorso(e) {
    return firmaLinee(e) + '#' + (e.tappe || []).map((tappa) => tappa.partenza).join('>');
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
    const ordinati = Array.from(perPercorso.values());
    ordinati.sort((x, y) => (arrivo
      ? y.arrivoDestinazione - x.arrivoDestinazione
      : x.arrivoDestinazione - y.arrivoDestinazione));
    // Prima una proposta per ogni sequenza di linee (la diversità che interessa
    // davvero), poi le varianti di orario della stessa linea.
    const scelti = [];
    const perLinee = new Set();
    ordinati.forEach((esito) => {
      const linee = firmaLinee(esito);
      if (perLinee.has(linee)) return;
      perLinee.add(linee);
      scelti.push(esito);
    });
    // Poi al massimo una variante di orario per sequenza: cinque copie della
    // stessa linea a dodici minuti di distanza non sono alternative.
    const perSequenza = new Map();
    scelti.forEach((esito) => perSequenza.set(firmaLinee(esito), 1));
    ordinati.forEach((esito) => {
      if (scelti.length >= 6 || scelti.indexOf(esito) >= 0) return;
      const linea = firmaLinee(esito);
      const quante = perSequenza.get(linea) || 0;
      if (quante >= 2) return;
      perSequenza.set(linea, quante + 1);
      scelti.push(esito);
    });
    return scelti.slice(0, 6);
  }

  // "Arriva entro" non accetta l'ultimo minuto utile: un viaggio che arriva
  // alle 14:31 per una scadenza alle 14:32 è valido sulla carta e
  // irraggiungibile nella pratica. Si cerca con 5 minuti di margine e sotto i 2
  // il margine viene segnalato come "poco".
  const MARGINE_ARRIVO = 5 * 60;      // secondi di margine richiesti sulla scadenza
  const MARGINE_POCO = 2 * 60;        // secondi sotto i quali il margine è poco

  // Finestra continua: si cerca ogni minuto su un'ora e mezza, non solo in
  // quattro istanti. Con gli offset fissi una corsa che parte al minuto 7 non
  // veniva mai vista e il percorso “migliore” era solo il primo trovato.
  const FINESTRA_SECONDI = 90 * 60;
  const PASSO_SECONDI = 60;
  const PROPOSTE_PRIMA_DI_FERMARSI = 4;
  const ATTESA_MAX = 3600;   // secondi: oltre un'ora di attesa la proposta non serve

  // Cedere il controllo al browser solo a pagina visibile: in una scheda in
  // background i timer sono rallentati a circa un secondo e un ciclo di novanta
  // giri resterebbe appeso per minuti. Nascosta, la ricerca fila via di seguito.
  function respira() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return null;
    return new Promise((risolvi) => setTimeout(risolvi, 0));
  }

  // A piedi fino a 2 km è un'alternativa vera, non solo il caso sotto i 400 m:
  // si calcola con OSRM quando la geometria è in cache e si confronta col bus.
  const PIEDI_ALTERNATIVA_MAX = 2000;

  function opzionePiedi() {
    const p = sel.partenza;
    const d = sel.destinazione;
    if (!p || !d || p.lat == null || p.lon == null || d.lat == null || d.lon == null) return null;
    const aria = distanzaMetri(p, d);
    if (!(aria >= 400 && aria <= PIEDI_ALTERNATIVA_MAX)) return null;
    const secondi = camminoReale([p.lon, p.lat], [d.lon, d.lat], aria);
    return { metri: Math.round(aria), secondi: secondi, minuti: Math.max(1, Math.round(secondi / 60)) };
  }

  // Il motore restituisce il viaggio che arriva prima a una data ora. Per avere
  // alternative come su Google Maps non basta spostare la partenza di qualche
  // minuto (uscivano quattro varianti della stessa linea): si ricalcola
  // vietando a turno la linea principale, così compare un'altra strada.
  async function calcolaOpzioni(da, a, base, evitata) {
    const arrivo = routing.modo === 'arrivo';
    const extraVietate = evitata ? [evitata] : null;
    // La scadenza si confronta come istante assoluto: dopo mezzanotte i
    // secondi del giorno ripartono da zero, mentre le corse serali hanno
    // orari oltre 86400 (es. 00:39 = 88740).
    // La scadenza vera resta quella scelta: il margine si toglie solo alla
    // soglia di accettazione, così "margine" continua a significare il tempo
    // che avanza davvero rispetto all'ora richiesta.
    const limiteReale = arrivo ? base.getTime() : null;
    const limite = arrivo ? base.getTime() - MARGINE_ARRIVO * 1000 : null;
    routing.scadenza = arrivo ? secondiDelGiorno(base) : null;
    const esiti = [];
    let errore = null;

    function calcola(quando, vietate) {
      return TPERRouting.calcola(da, a, quando, {
        maxCambi: 3,
        vietate: vietatePer(vietate).concat(extraVietate || []),
        camminoMax: camminata * 60
      });
    }

    // Tentativi 0/1/2/3 cambi: il diretto si prova sempre per primo, così non
    // può risultare “migliore” un tre-cambi solo perché è l'unico cercato. Se
    // il diretto non c'è si confrontano uno e tre cambi e vince chi arriva
    // prima: cercare solo il primo cambio trovato vuol dire accettare un
    // itinerario più lento senza saperlo.
    function calcolaConCambi(quando) {
      const comuni = {
        camminoMax: camminata * 60,
        vietate: vietatePer(extraVietate)
      };
      const prova = (cambi) => {
        const esito = TPERRouting.calcola(da, a, quando, Object.assign({ maxCambi: cambi }, comuni));
        if (esito && esito.errore) { errore = errore || esito; return null; }
        return esito || null;
      };
      const diretto = prova(0);
      if (diretto) return diretto;
      const uno = prova(1);
      const tre = prova(3);
      if (uno && tre) return tre.arrivo < uno.arrivo ? tre : uno;
      if (uno || tre) return uno || tre;
      return prova(2);
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
      // L'attesa alla fermata non è viaggio: un bus che parte nove ore dopo
      // l'ora chiesta non è una soluzione da proporre.
      const primaCorsa = (esito.tappe[0] || {}).partenza;
      if (primaCorsa != null) {
        const attesa = primaCorsa - (esito.camminoIniziale || 0) - esito.richiesta;
        if (attesa > ATTESA_MAX) return;
      }
      // Il tempo passato ad aspettare che arrivi il minuto giusto è tempo perso
      // dall'utente: senza contarlo, "veloce" premia chi parte mezz'ora dopo
      // solo perché il bus è già lì.
      const rimandato = Math.max(0, Math.round((quando.getTime() - base.getTime()) / 1000));
      if (rimandato) {
        // punteggio() calcola e memorizza esito.punteggio: dopo si può sommare.
        if (typeof TPERRouting.punteggio === 'function') TPERRouting.punteggio(esito);
        const misure = esito.punteggio;
        if (misure) {
          misure.tempoTotale += rimandato;
          misure.costoVeloce += rimandato;
          misure.costoOttimizzato += rimandato;
        }
      }
      esito.margine = arrivo ? Math.round((limiteReale - arrivoDestinazione) / 1000) : null;
      esito.arrivoDestinazione = arrivoDestinazione;
      segnaUltimaCorsa(esito);
      esito.quandoRichiesta = quando;
      esiti.push(esito);
    }

    // In modalità arrivo la finestra si apre all'indietro dalla scadenza.
    const passo = arrivo ? -PASSO_SECONDI : PASSO_SECONDI;
    // Tetto di tempo: su un telefono lento la finestra intera non deve poter
    // tenere in scacco il pannello. Quello che si è trovato resta valido.
    const scadenzaRicerca = Date.now() + 2500;
    for (let scarto = 0; Math.abs(scarto) <= FINESTRA_SECONDI; scarto += passo) {
      if (esiti.length && Date.now() > scadenzaRicerca) break;
      const quando = new Date(base.getTime() + scarto * 1000);
      const prima = esiti.length;
      aggiungi(calcolaConCambi(quando), quando);
      if (esiti.length > prima) {
        const lineeDistinte = new Set(esiti.map(firmaLinee)).size;
        if (lineeDistinte >= PROPOSTE_PRIMA_DI_FERMARSI) break;
      }
      // Il ciclo è sincrono: ogni cinque minuti si restituisce il controllo al
      // browser, altrimenti novanta giri di RAPTOR bloccano il pannello.
      if ((Math.abs(scarto) / PASSO_SECONDI) % 5 === 0) {
        const pausa = respira();
        if (pausa) await pausa;
      }
    }

    let migliore = null;
    esiti.forEach((esito) => {
      if (!migliore || esito.arrivoDestinazione < migliore.arrivoDestinazione) migliore = esito;
    });

    // Il motore sa già costruire un pool attorno alla richiesta: si aggiunge a
    // quello dell'app, così esiste davvero la soluzione comoda (un bus diretto
    // più lento di dieci minuti non emerge escludendo solo le linee migliori).
    if (migliore && typeof TPERRouting.alternative === 'function') {
      const dalMotore = TPERRouting.alternative(da, a, migliore.quandoRichiesta, {
        maxCambi: 3,
        camminoMax: camminata * 60,
        vietate: vietatePer(extraVietate)
      });
      (dalMotore || []).forEach((esito) => aggiungi(esito, migliore.quandoRichiesta));
    }

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
    // Anche qui finestra continua, con un cambio solo (per un treno + bus non
    // serve esplorare tre cambi) e passo di cinque minuti: le coppie sono poche
    // e il minuto esatto non sposta nulla.
    const conTreno = da.concat(a).some((fermata) => fermata.tipo === 'treno' || fermata.tipo === 'entrambi');
    if (conTreno) {
      const coppie = [];
      da.forEach((origine) => {
        a.forEach((destinazione) => {
          if (origine.id === destinazione.id) return;
          if (origine.tipo === 'treno' || destinazione.tipo === 'treno' ||
              origine.tipo === 'entrambi' || destinazione.tipo === 'entrambi') {
            coppie.push([origine, destinazione]);
          }
        });
      });
      for (const coppia of coppie.slice(0, 6)) {
        for (let scarto = 0; scarto <= FINESTRA_SECONDI; scarto += 300) {
          const quando = new Date(base.getTime() + (arrivo ? -scarto : scarto) * 1000);
          const esito = TPERRouting.calcola([coppia[0]], [coppia[1]], quando, {
            maxCambi: 1,
            camminoMax: camminata * 60,
            vietate: vietatePer(extraVietate)
          });
          if (esito && !esito.errore) { aggiungi(esito, quando); break; }
          const pausa = respira();
          if (pausa) await pausa;
        }
      }
    }

    return { esiti: selezionaEsiti(esiti, arrivo), errore: errore, piedi: opzionePiedi() };
  }

  // Un solo avviso sul percorso scelto: il cambio troppo stretto per essere
  // tranquillo. Non è un confronto fra proposte, è un rischio del viaggio.
  function htmlAvvisoPiano(esito) {
    if (!esito || !esito.punteggio || !esito.punteggio.cambioRischioso) return '';
    return '<span class="badge-piano rischio">Cambio stretto</span>';
  }

  // Meteo attuale sulla zona di partenza: pesa solo i tratti a piedi dentro il
  // calcolo. Non blocca mai la ricerca e non produce nessun testo in scheda.
  async function caricaMeteo() {
    if (meteo.caricamento) return;
    if (meteo.ts && Date.now() - meteo.ts < METEO_TTL) return;
    const punto = sel.partenza && sel.partenza.lat != null
      ? sel.partenza
      : { lat: 44.4949, lon: 11.3426, nome: 'Bologna' };
    meteo.caricamento = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const risposta = await fetch(METEO_URL +
        '?latitude=' + Number(punto.lat).toFixed(3) +
        '&longitude=' + Number(punto.lon).toFixed(3) +
        '&current=temperature_2m,precipitation,rain,snowfall,weather_code,wind_speed_10m' +
        '&timezone=auto', { signal: controller.signal });
      if (!risposta.ok) throw new Error('meteo ' + risposta.status);
      const dati = await risposta.json();
      const ora = (dati && dati.current) || {};
      const codice = Number(ora.weather_code);
      const mm = Number(ora.precipitation) || 0;
      const neve = Number(ora.snowfall) || 0;
      const vento = Number(ora.wind_speed_10m) || 0;
      const bagnato = mm > 0.1 || neve > 0 || METEO_BAGNATO.indexOf(codice) >= 0;
      const pesante = bagnato || vento >= 40;
      const cambiato = pesante !== meteo.camminoPesante;
      meteo.ts = Date.now();
      meteo.pioggia = bagnato;
      meteo.neve = neve;
      meteo.mm = mm;
      meteo.vento = vento;
      meteo.codice = isFinite(codice) ? codice : null;
      meteo.temperatura = isFinite(Number(ora.temperature_2m)) ? Number(ora.temperature_2m) : null;
      meteo.luogo = String(punto.nome || 'Bologna').split(' - ')[0];
      meteo.camminoPesante = pesante;
      meteo.errore = null;
      // Se il tempo è cambiato il percorso già mostrato non è più quello
      // scelto con i pesi giusti: si ricalcola una volta sola.
      if (cambiato && sel.partenza && sel.destinazione && routing.stato === 'ok') {
        routing.chiave = null;
        calcolaPercorso();
      } else {
        renderPercorso();
      }
    } catch (errore) {
      meteo.errore = errore;
      // Non si ritenta a ogni ricalcolo: il meteo è un extra, non un requisito.
      meteo.ts = Date.now();
    } finally {
      clearTimeout(timer);
      meteo.caricamento = false;
    }
  }

  // Due righe di testo, non una scheda: la corsa scartata perché in forte
  // ritardo e il consiglio di camminare alla fermata dopo.
  function htmlSuggerimenti() {
    let html = '';
    if (routing.avvisoRitardo) {
      html += '<p class="nota-percorso">' + esc(routing.avvisoRitardo) + '</p>';
    }
    const s = routing.suggerimento;
    if (s) {
      html += '<p class="nota-percorso">Se cammini ' + s.minuti + ' min a ' + esc(s.nome) +
        ' arrivi ' + s.risparmio + ' min prima.</p>';
    }
    return html;
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

  function etichettaFermata(id) {
    const f = fermataPerId(id);
    return f ? nomeFermataBreve(f.nome, f.tipo) : String(id);
  }

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

  // Cammino reale: la lunghezza della geometria OSRM quando è già in cache,
  // altrimenti la stima lineare con la maggiorazione della strada. Il tratto
  // mancante si chiede in background (dove ha senso: chiedere OSRM per ogni
  // coppia di fermate sarebbe una raffica di richieste) e dal giro dopo i tempi
  // sono quelli veri. Ritorna secondi, come vuole il motore.
  function camminoReale(da, a, metriLineari, chiediOsm) {
    const lineari = metriLineari != null ? metriLineari : (da && a ? distanzaTra(da, a) : 0);
    if (da && a) {
      const geometria = geometriaPiedi(da, a);
      if (geometria) {
        const metri = Piedi.lunghezza(geometria);
        if (metri > 1) return Math.round((metri * 1.3) / 1.2);
      } else if (chiediOsm !== false && lineari > 250) {
        // Sotto i 250 m il percorso pedonale non cambia la scelta: non si chiede.
        chiediPiedi(da, a);
      }
    }
    return Math.round((lineari * 1.3) / 1.2);
  }

  const CANDIDATI_MAX = 10;
  const CANDIDATI_RAGGIO_MAX = 800;   // metri: oltre non è più "la fermata qui"

  // Due paline con lo stesso nome a pochi passi sono la stessa fermata: senza
  // questo i candidati si riempivano di gemelle e il motore provava dieci volte
  // lo stesso punto.
  function gemelle(a, b) {
    if (!a || !b || a.id === b.id) return false;
    if (normalizza(a.nome) !== normalizza(b.nome)) return false;
    return distanzaMetri(a, b) <= 100;
  }

  // Come fanno i pianificatori veri: si può salire anche alle fermate a pochi
  // passi da quella scelta. Con dieci candidati pesati sulla frequenza una
  // fermata a 400 m con cinque linee vale più di una a 100 m con una sola.
  function candidatiPercorso(fermata) {
    const disponibili = fermateConOrari();
    const elenco = [];
    if (disponibili.has(fermata.id)) elenco.push({ id: fermata.id, cammino: 0, tipo: fermata.tipo });
    if (fermata.lat == null || fermata.lon == null) return elenco;
    const raggio = Math.min(CANDIDATI_RAGGIO_MAX, raggioCamminata());
    const vicini = fermateVicine(fermata.lat, fermata.lon, 60, fermata.id)
      .filter((vicina) => disponibili.has(vicina.id))
      .map((vicina) => ({ fermata: vicina, distanza: distanzaMetri(fermata, vicina) }))
      .filter((voce) => voce.distanza <= raggio)
      .map((voce) => {
        // Le stazioni ferroviarie non devono sparire solo perché ci sono cinque
        // paline bus più vicine: senza di loro non nasce nessun bus + treno.
        const treno = voce.fermata.tipo === 'treno' || voce.fermata.tipo === 'entrambi';
        voce.punteggio = (lineaDi(voce.fermata).length + (treno ? 4 : 0) + 1) / (voce.distanza + 100);
        return voce;
      })
      .sort((a, b) => b.punteggio - a.punteggio || a.distanza - b.distanza);
    const scelti = [];
    vicini.forEach((voce) => {
      if (elenco.length + scelti.length >= CANDIDATI_MAX) return;
      if (scelti.some((altra) => gemelle(altra.fermata, voce.fermata))) return;
      scelti.push(voce);
    });
    scelti.forEach((voce) => {
      elenco.push({
        id: voce.fermata.id,
        cammino: camminoReale([fermata.lon, fermata.lat], [voce.fermata.lon, voce.fermata.lat], voce.distanza),
        tipo: voce.fermata.tipo
      });
    });
    return elenco;
  }

  // Cambio a piedi tra fermate vicine: le paline opposte stanno a 50–150 m, ma
  // se l'utente è disposto a camminare si può cambiare anche tra fermate più
  // lontane (fino al raggio scelto). Oltre 12 fermate per fermata non serve.
  const CAMMINO_CAMBIO = 300;   // metri minimi garantiti
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
    const perId = new Map(fermate.map((f) => [f.id, f]));
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
        const altra = perId.get(voce.id);
        coppie.push([
          f.id,
          voce.id,
          camminoReale([f.lon, f.lat], altra ? [altra.lon, altra.lat] : null, voce.metri, false)
        ]);
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
    const box = $('vista-risultato');
    if (!box) return;
    assicuraQuando();
    // La scheda legge da qui quanti minuti a piedi sono concessi.
    routing.camminata = camminata;
    aggiornaBarra();
    if (!sel.destinazione) {
      // Tornando in home non deve restare il tracciato del viaggio precedente:
      // la mappa mostra solo le fermate.
      if (mappa) {
        ['percorso', 'percorso-fermate', 'percorso-nodi'].forEach((id) => {
          const sorgente = mappa.getSource(id);
          if (sorgente && typeof sorgente.setData === 'function') {
            sorgente.setData({ type: 'FeatureCollection', features: [] });
          }
        });
      }
      ultimeFeatures = [];
      inquadratoPerFermate = null;
      box.innerHTML = listaViciniHTML();
      aggiornaScrim();
      return;
    }
    const r = tariffaCorrente();
    box.innerHTML = htmlRiepilogo(r) + htmlStatoPercorso();
    collegaRisultato();
    caricaLivePercorso();
    caricaLiveTappe();
    avviaTimerPercorso();
    disegnaTracciato();
    aggiornaScrim();
  }
  function calcolaPercorso(opzioni) {
    if (!sel.partenza || !sel.destinazione) return;
    const evitata = opzioni && opzioni.evita ? opzioni.evita : null;
    aggiornaUrl('replace');
    if (typeof TPERRouting === 'undefined') {
      routing.stato = 'errore';
      routing.errore = 'motore dei percorsi non disponibile';
      disegnaPercorso();
      return;
    }
    // Il meteo si chiede in sottofondo e, quando è noto, decide quanto pesa il
    // cammino: con pioggia o vento forte un minuto a piedi vale il doppio.
    caricaMeteo();
    if (typeof TPERRouting.impostaPesoCammino === 'function') {
      TPERRouting.impostaPesoCammino(meteo.camminoPesante ? 2 : 1);
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
      // I candidati di destinazione servono anche al suggerimento "cammina alla
      // fermata dopo": si calcolano una volta sola.
      const candidatiA = candidatiPercorso(sel.destinazione);
      routing.candidatiDestinazione = candidatiA;
      return calcolaOpzioni(
        candidatiPercorso(sel.partenza),
        candidatiA,
        dataDaGiornoEOra(routing.giorno, routing.orario),
        evitata
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
        // Un solo elenco, già ordinato dal motore: in testa il percorso
        // migliore, sotto le alternative. Nessun criterio da scegliere.
        risultato.esiti.forEach((esito) => coloraTappe(esito));
        routing.opzioni = typeof TPERRouting.graduatoria === 'function'
          ? TPERRouting.graduatoria(risultato.esiti)
          : risultato.esiti;
        routing.esito = routing.opzioni[0] || null;
        segnaUltimaCorsa(routing.esito);
        routing.aperto = routing.esito ? Math.max(0, routing.opzioni.indexOf(routing.esito)) : -1;
        routing.opzionePiedi = risultato.piedi || null;
        routing.suggerimento = null;
        routing.avvisoRitardo = '';
        // Ultima destinazione e voce di storia: la prima serve al chip
        // "Di nuovo a …?", la seconda al tasto indietro del telefono.
        if (sel.destinazione && !sel.destinazione.gps) {
        }
        segnalaStoriaPercorso();
        // Gli orari completi non stanno all'avvio: si caricano in sottofondo
        // appena c'è un percorso, per poter segnalare l'ultima corsa.
        if (typeof TPERRouting !== 'undefined' && !TPERRouting.disponibile()) preparaLinee();
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
      if (routing.stato === 'ok') avviaSuggerimento(richiesta);
    }).catch((errore) => {
      if (richiesta !== routing.richiesta) return;
      routing.stato = 'errore';
      routing.errore = (errore && errore.message) || 'rete non disponibile';
      disegnaPercorso();
    });
  }

  // "Cammina alla fermata dopo": se partire a piedi da una palina vicina
  // servita dalla stessa linea fa arrivare prima, conviene dirlo. Una sola
  // riga, nessuna scheda nuova.
  async function avviaSuggerimento(richiesta) {
    const migliore = routing.esito;
    const partenza = sel.partenza;
    const destinazione = sel.destinazione;
    if (!migliore || !migliore.tappe || !migliore.tappe.length) return;
    if (!partenza || !destinazione || partenza.lat == null) return;
    const candidatiA = routing.candidatiDestinazione;
    if (!candidatiA || !candidatiA.length) return;
    const linea = String(migliore.tappe[0].linea);
    const base = migliore.quandoRichiesta || dataDaGiornoEOra(routing.giorno, routing.orario);
    const vicine = fermateVicine(partenza.lat, partenza.lon, 8, partenza.id)
      .filter((f) => lineaDi(f).map(String).indexOf(linea) >= 0)
      .slice(0, 3);
    for (const vicina of vicine) {
      const cammino = camminoReale([partenza.lon, partenza.lat], [vicina.lon, vicina.lat]);
      if (cammino > 500) continue;
      const esito = TPERRouting.calcola(
        [{ id: vicina.id, cammino: cammino }],
        candidatiA,
        base,
        { maxCambi: 1, camminoMax: camminata * 60 }
      );
      if (richiesta !== routing.richiesta) return;
      if (!esito || esito.errore) continue;
      const arrivo = base.getTime() + (esito.arrivo - esito.richiesta) * 1000 +
        (esito.camminoFinale || 0) * 1000;
      const risparmio = Math.round((migliore.arrivoDestinazione - arrivo) / 60000);
      if (risparmio >= 2) {
        routing.suggerimento = {
          nome: nomeFermataBreve(vicina.nome, vicina.tipo),
          minuti: Math.max(1, Math.round(cammino / 60)),
          risparmio: risparmio
        };
        disegnaPercorso();
        return;
      }
      const pausa = respira();
      if (pausa) await pausa;
    }
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

  // Ritardi di tutte le tappe, non solo della prima: un bus in ritardo sulla
  // seconda gamba sposta l'arrivo o fa perdere il cambio, e la scheda deve
  // dirlo. `valori` è allineato a `routing.esito.tappe` (secondi, null = ignoto).
  const liveTappe = {
    chiave: null, ts: 0, stato: 'idle', valori: [], caricamento: false, esito: null
  };
  let liveTappeAbort = null;

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

  /**
   * L'arrivo di HelloBus che corrisponde alla corsa dell'itinerario: stessa
   * linea e orario entro 12 minuti. Oltre è un'altra corsa, e mostrarla come
   * "la nostra" produceva avvisi tipo "24 min di anticipo" su un bus diverso.
   */
  function arrivoDellaCorsa(arrivi, tappa) {
    const lineaCorsa = String(tappa.linea).toUpperCase();
    const dellaLinea = arrivi.filter((arrivo) => arrivo.linea === lineaCorsa);
    const candidati = dellaLinea.length ? dellaLinea : arrivi;
    const pianificato = minutiDaAdesso(tappa.partenza);
    let migliore = null;
    let scarto = Infinity;
    candidati.forEach((arrivo) => {
      const delta = minutiA(arrivo.ora) * 60 - pianificato;
      if (Math.abs(delta) > 12 * 60) return;
      if (Math.abs(delta) < Math.abs(scarto)) {
        migliore = arrivo;
        scarto = delta;
      }
    });
    return migliore ? { corsa: migliore, scarto: scarto } : null;
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
    const peopleMover = String(tappa.linea).toUpperCase() === 'MEX';
    const corsa = livePercorso.corsa;
    const linea = esc(tappa.linea);
    const programmato = hhmmDaSecondi(tappa.partenza);
    let html;
    let tag = '<span class="tag-orario">ORARIO</span>';
    if (treno) {
      html = '<span>' + (peopleMover ? 'People mover' : 'Treno') + ' <b>' + linea + '</b> alle <b>' + programmato + '</b>.</span>';
    } else if (livePercorso.caricamento) {
      html = '<span class="punto off"></span><span>Controllo se il bus <b>' + linea +
        '</b> è in orario…</span>';
    } else if (livePercorso.stato === 'ok' && corsa) {
      const minutiAttesa = minutiA(corsa.ora);
      const quando = minutiAttesa <= 0 ? 'in arrivo' : 'tra ' + minutiAttesa + ' min';
      const scarto = Math.round(livePercorso.ritardo / 60);
      const vivo = corsa.tipo === 'live';
      tag = '<span class="' + (vivo ? 'tag-live' : 'tag-orario') + '">' + (vivo ? 'LIVE' : 'ORARIO') + '</span>';
      html = '<span>Bus <b>' + linea + '</b> · <b>' + quando + '</b> · ore ' + esc(corsa.ora) +
        (vivo && Math.abs(scarto) >= 2
          ? ' · ' + (scarto > 0 ? scarto + ' min di ritardo' : Math.abs(scarto) + ' min di anticipo')
          : '') +
        (vivo ? '' : ' · orario programmato') + '</span>';
    } else if (livePercorso.stato === 'errore') {
      html = '<span>Bus <b>' + linea + '</b> alle <b>' + programmato +
        '</b> · tempo reale non raggiungibile.</span>';
    } else {
      html = '<span>Bus <b>' + linea + '</b> alle <b>' + programmato +
        '</b> · orario programmato.</span>';
    }
    // Le altre tappe: solo quando HelloBus ha risposto per almeno una.
    const info = ritardiPercorso();
    if (info && info.noti) {
      if (info.cambioPerso) {
        html += '<span><b>Cambio perso:</b> con questo ritardo la corsa per ' +
          esc(info.lineaPersa) + ' non ti aspetta.</span>' +
          '<button type="button" class="live-azione" data-azione="alternativa-ritardo">Cerca un\'altra soluzione da qui</button>';
      } else if (info.cambioRischioso) {
        html += '<span><b>Cambio a rischio:</b> al ritardo attuale restano meno di 2 minuti per la coincidenza.</span>';
      } else if (info.ultimo >= 120) {
        html += '<span>Arrivo previsto con <b>' + Math.round(info.ultimo / 60) + ' min</b> di ritardo.</span>';
      }
      if (info.totale > 1) {
        html += '<span class="live-nota">Tempo reale su ' + info.noti + ' di ' + info.totale + ' corse.</span>';
      }
    }
    contenitore.innerHTML = tag + '<span class="live-testo">' + html + '</span>';
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
      const trovato = arrivoDellaCorsa(parseHellobus(testo), tappa);
      const migliore = trovato ? trovato.corsa : null;
      const scarto = trovato ? trovato.scarto : 0;
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
    if (scartaCorsaInRitardo()) return;
    disegnaLivePercorso();
  }

  const RITARDO_MAX = 10 * 60;

  /**
   * Ritardi del percorso scelto, con quello che cambia davvero: un ritardo
   * sull'ultima corsa sposta l'arrivo, un ritardo su una corsa intermedia può
   * far perdere il cambio (il margine è la differenza con la partenza dopo).
   */
  // «Ultima corsa» è un fatto del giorno scelto, non una stima: si marca la
  // tappa solo quando la partenza coincide con l'ultima del gruppo.
  function segnaUltimaCorsa(esito) {
    if (!esito || !Array.isArray(esito.tappe)) return esito;
    const indice = lineeIndice();
    if (!indice) return esito;
    const attive = serviziDelGiorno();
    esito.tappe.forEach((tappa) => {
      if (tappa.tipo === 1 || tappa.tipo === 2) return;
      const linea = Linee.lineaDi(indice, tappa.linea);
      if (!linea || !Array.isArray(tappa.stops) || !tappa.stops.length) return;
      const ultima = Linee.ultimaAllaFermata(linea, tappa.stops[tappa.stops.length - 1], tappa.da, attive);
      if (ultima && Math.abs(ultima.secondi - tappa.partenza) <= 60) tappa.ultimaCorsa = true;
    });
    return esito;
  }

  // Lo storico è solo quello osservato dall'app: niente dati inventati.
  function annotaRitardo(linea, scarto, partenza) {
    if (!linea || scarto == null || Math.abs(scarto) > 1800) return;
    if (!routing.ritardiVisti) routing.ritardiVisti = {};
    const chiave = linea + ':' + partenza;
    if (routing.ritardiVisti[chiave]) return;
    if (Object.keys(routing.ritardiVisti).length > 400) routing.ritardiVisti = {};
    routing.ritardiVisti[chiave] = 1;
    const salvati = leggiJSON(K_RITARDI) || {};
    const voce = salvati[linea] || { somma: 0, n: 0 };
    voce.somma += scarto;
    voce.n += 1;
    salvati[linea] = voce;
    try { scrivi(K_RITARDI, JSON.stringify(salvati)); } catch (errore) { /* pieno */ }
  }

  function ritardoTipico(linea) {
    const salvati = leggiJSON(K_RITARDI) || {};
    const voce = salvati[linea];
    if (!voce || voce.n < 5) return null;
    const media = voce.somma / voce.n;
    if (Math.abs(media) < 60) return null;
    return Math.round(media / 60);
  }

  function ritardiPercorso() {
    const esito = routing.esito;
    const tappe = esito && Array.isArray(esito.tappe) ? esito.tappe : [];
    const valori = liveTappe.valori || [];
    // I valori sono allineati alle tappe di un esito preciso: cambiando
    // soluzione non valgono più.
    if (!tappe.length || !valori.length || liveTappe.esito !== esito) return null;
    tappe.forEach((tappa, indice) => {
      if (valori[indice] != null) annotaRitardo(tappa.linea, valori[indice], tappa.partenza);
    });
    return Utilita.analizzaRitardi(tappe, valori);
  }

  // Un cambio perso non si risolve aspettando: si riparte da dove si è e si
  // evita la linea che non si riesce a prendere, così il motore cerca davvero
  // un'altra strada invece di riproporre lo stesso itinerario.
  function ricalcolaPerRitardo() {
    const info = ritardiPercorso();
    if (!info || !info.cambioPerso) return;
    // Si riparte da dove si è: prima l'ultima posizione GPS, poi la fermata
    // del cambio perso. La partenza originale resta solo come ultimo ripiego.
    const posizione = navigazione.attiva && navigazione.ultima
      ? { lat: navigazione.ultima.lat, lon: navigazione.ultima.lon, ts: Date.now() }
      : posizioneUtente;
    const fresca = posizione && posizione.lat != null && posizione.lon != null &&
      (posizione.ts == null || Date.now() - posizione.ts <= 120000);
    const cambio = info.cambioDa ? fermataPerId(info.cambioDa) : null;
    const scelta = Utilita.scegliOrigineRitardo(fresca ? posizione : null, cambio);
    let origine = null;
    let da = '';
    if (scelta.tipo === 'posizione') {
      origine = luogoDaPosizione(scelta.luogo, 'La mia posizione');
      da = 'la tua posizione';
    } else if (scelta.tipo === 'cambio') {
      origine = scelta.luogo;
      da = 'la fermata del cambio';
    }
    if (navigazione.attiva) fermaNavigazione(true);
    if (origine) {
      sel.partenza = origine;
      impostaInput('partenza');
      aggiornaMarker();
      if (!origine.gps) salvaTratta();
    }
    routing.giorno = oggiISO();
    routing.orario = oraAdesso();
    routing.adesso = true;
    routing.modo = 'partenza';
    routing.chiave = null;
    salvaQuando();
    mostraToast('Ricalcolo da ' + (da || 'la partenza') +
      (info.lineaPersa ? ' senza la linea ' + info.lineaPersa : ''));
    calcolaPercorso({ evita: info.lineaPersa });
  }

  // Il GTFS non sa se una corsa è cancellata o venti minuti indietro: quando
  // HelloBus lo dice, quella proposta non è più la migliore e si passa alla
  // successiva del pool (una volta sola: niente cicli di scarto).
  function scartaCorsaInRitardo() {
    if (routing.avvisoRitardo) return false;
    const opzioni = routing.opzioni || [];
    const indice = opzioni.indexOf(routing.esito);
    if (indice < 0 || indice + 1 >= opzioni.length) return false;
    const info = ritardiPercorso();
    let motivo = '';
    if (info && info.cambioPerso) {
      motivo = 'Il ritardo fa perdere il cambio per ' + info.lineaPersa;
    } else if (info && info.ultimo > RITARDO_MAX) {
      motivo = 'Arrivo in ritardo di ' + Math.round(info.ultimo / 60) + ' min';
    } else if (livePercorso.stato === 'ok' && livePercorso.corsa &&
      livePercorso.ritardo > RITARDO_MAX) {
      motivo = 'Bus ' + (livePercorso.corsa.linea || '') +
        ' in ritardo di ' + Math.round(livePercorso.ritardo / 60) + ' min';
    }
    if (!motivo) return false;
    routing.avvisoRitardo = motivo + ': propongo la soluzione successiva.';
    routing.esito = opzioni[indice + 1];
    routing.aperto = indice + 1;
    // I ritardi erano della soluzione precedente: si richiedono per la nuova.
    liveTappe.valori = [];
    liveTappe.chiave = null;
    disegnaPercorso();
    return true;
  }

  // Ritardo live su ogni tappa bus: una richiesta per palina+linea (due tappe
  // sulla stessa linea alla stessa fermata sono la stessa domanda), in
  // parallelo e con lo stesso relay della prima corsa.
  async function caricaLiveTappe(forza) {
    const esito = routing.stato === 'ok' ? routing.esito : null;
    const tappe = esito && Array.isArray(esito.tappe) ? esito.tappe : [];
    if (!tappe.length) {
      if (liveTappeAbort) liveTappeAbort.abort();
      liveTappe.chiave = null;
      liveTappe.stato = 'idle';
      liveTappe.valori = [];
      return;
    }
    const chiave = tappe.map((tappa) => [tappa.da, tappa.linea, tappa.partenza].join('|')).join(';');
    if (!forza && liveTappe.chiave === chiave && Date.now() - liveTappe.ts < 60000) {
      disegnaLivePercorso();
      return;
    }
    if (liveTappeAbort) liveTappeAbort.abort();
    liveTappeAbort = new AbortController();
    const segnale = liveTappeAbort.signal;
    liveTappe.chiave = chiave;
    liveTappe.caricamento = true;

    const richieste = new Map();
    tappe.forEach((tappa) => {
      if (tappa.tipo === 1 || tappa.tipo === 2) return;
      const k = tappa.da + '|' + tappa.linea;
      if (!richieste.has(k)) {
        richieste.set(k, queryHellobus(tappa.da, tappa.linea, segnale).catch(() => ''));
      }
    });
    const testi = new Map();
    await Promise.all(Array.from(richieste.entries()).map(async (voce) => {
      testi.set(voce[0], await voce[1]);
    }));
    if (segnale.aborted || routing.esito !== esito) return;

    let noti = 0;
    const valori = tappe.map((tappa) => {
      if (tappa.tipo === 1 || tappa.tipo === 2) return null;
      const testo = testi.get(tappa.da + '|' + tappa.linea);
      if (!testo || /NON GESTITA/i.test(testo)) return null;
      const trovato = arrivoDellaCorsa(parseHellobus(testo), tappa);
      if (!trovato) return null;
      noti += 1;
      return Math.round(trovato.scarto);
    });
    liveTappe.valori = valori;
    liveTappe.esito = esito;
    liveTappe.ts = Date.now();
    liveTappe.stato = noti ? 'ok' : 'nessuna-corsa';
    liveTappe.caricamento = false;
    if (esito) esito.ritardi = valori;
    if (scartaCorsaInRitardo()) return;
    disegnaLivePercorso();
  }

  function avviaTimerPercorso() {
    if (timerPercorso) return;
    timerPercorso = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (vistaAttiva !== 'percorso') return;
      if (!primaCorsaPercorso()) return;
      caricaLivePercorso(true);
      caricaLiveTappe(true);
    }, 30000);
  }

  /* ------------------------------------------------------------------ *
   * Tempo reale (HelloBus)
   * ------------------------------------------------------------------ */
  function relaysOrdinati() {
    // Il Worker personale è sempre il primo: gestisce solo HelloBus,
    // è veloce e sotto il nostro controllo. Gli altri restano come fallback.
    const elenco = [{
      id: 'worker',
      build: (url) => RELAY_WORKER + encodeURIComponent(url)
    }];
    const custom = (leggi(K_PROXY) || '').trim();
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
    const scelta = live.fermata || sel[stopLiveRuolo] || sel.partenza || sel.destinazione || null;
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
      return '<div class="stato-live"><span class="punto"></span>Cerco i passaggi in tempo reale…</div>';
    }
    if (live.stato === 'errore' && !live.items.length) {
      return '<div class="stato-live"><span class="punto off"></span>Dati realtime non raggiungibili</div>';
    }
    if (!live.ts && !live.items.length) {
      return '<div class="stato-live"><span class="punto off"></span>In attesa di aggiornamento</div>';
    }
    const liveCount = live.items.filter((a) => a.tipo === 'live').length;
    const eta = live.ts ? Math.round((Date.now() - live.ts) / 60000) : null;
    const quando = eta == null || eta <= 0
      ? 'Aggiornato ora'
      : eta === 1 ? 'Aggiornato 1 min fa' : 'Aggiornato ' + eta + ' min fa';
    return '<div class="stato-live"><span class="punto' + (liveCount ? '' : ' off') + '"></span>' +
      '<span>' + quando + (liveCount ? '' : ' · solo orari') + '</span>' +
      (eta != null && eta >= 2 ? '<button type="button" class="link-mini" data-azione="aggiorna">Aggiorna</button>' : '') +
      '</div>';
  }

  // Entro 50 minuti conta quanto manca («tra 10 min»): oltre, l'orario esatto
  // dice più di un numero grande che nessuno traduce in partenza.
  const MINUTI_RELATIVI = 50;

  /**
   * Un solo elenco: tempo reale di HelloBus e orari programmati dello stesso
   * giorno, ordinati per quanto manca. Se la stessa corsa compare in entrambe
   * le fonti vince quella con la posizione del bus.
   */
  function arriviUniti(f) {
    const programmati = [];
    if (f && !eIndirizzo(f)) {
      partenzeDelGiorno(f).forEach((partenza) => {
        const capolinea = fermataPerId(partenza.capolineaId);
        programmati.push({
          linea: String(partenza.linea),
          ora: hhmm(partenza.orario),
          destinazione: capolinea ? nomeFermataBreve(capolinea.nome, capolinea.tipo) : (partenza.capolinea || '')
        });
      });
    }
    const adesso = new Date();
    const adessoMinuti = adesso.getHours() * 60 + adesso.getMinutes();
    if (typeof VistaPercorso.arriviUniti === 'function') {
      return VistaPercorso.arriviUniti(live.items || [], programmati, adessoMinuti);
    }
    // Modulo vecchio ancora in cache (deploy a metà): si mostra solo il tempo
    // reale, come prima, invece di una schermata vuota.
    return (live.items || [])
      .map((arrivo) => Object.assign({ destinazione: '' }, arrivo, {
        minuti: VistaPercorso.minutiA
          ? VistaPercorso.minutiA(arrivo.ora, adessoMinuti)
          : minutiA(arrivo.ora)
      }))
      .filter((arrivo) => arrivo.minuti >= -1)
      .sort((a, b) => a.minuti - b.minuti);
  }

  // Elenco unico della fermata: tutte le corse che restano nella giornata,
  // tempo reale e orari programmati insieme, ordinati per quanto manca. Righe
  // compatte: ora, badge della linea, destinazione.
  /* ------------------------------------------------------------------ *
   * Segnala un errore
   * ------------------------------------------------------------------ */
  // Due tocchi: fermata, linea, ora, giorno e versione dei dati finiscono già
  // nel corpo della issue GitHub. Senza quei campi chi indaga deve
  // ricostruire il contesto, e la segnalazione spesso non si fa.
  const SEGNALA_REPO = 'https://github.com/SuPeRCoDiNg2012/tper-bus';

  function dataEstesa(iso) {
    const parti = String(iso || '').split('-');
    if (parti.length !== 3 || !parti[0]) return '';
    return parti[2] + '/' + parti[1] + '/' + parti[0];
  }

  function urlSegnalazioneCorsa(opzioni) {
    const o = opzioni || {};
    const fermata = o.fermata || null;
    // Una copia vecchia di utilita.js in cache non deve svuotare la schermata:
    // senza il costruttore semplicemente non c'è il collegamento.
    if (typeof Utilita === 'undefined' || typeof Utilita.urlSegnalazione !== 'function') return '';
    return Utilita.urlSegnalazione({
      repo: SEGNALA_REPO,
      tipo: o.tipo,
      fermata: fermata ? {
        id: fermata.id,
        nome: nomeLuogo(fermata),
        indirizzo: dettaglioFermata(fermata),
        zona: fermata.zona
      } : null,
      linea: o.linea,
      linee: o.linee,
      ora: o.ora,
      giorno: dataEstesa(routing.giorno),
      dati: aggiornato ? dataEstesa(aggiornato) : ''
    });
  }

  function arriviHTML() {
    const fermata = fermataLive();
    let uniti = arriviUniti(fermata);
    // Chip e filtro usano la linea base, come la deduplica: 13 e 13A sono la
    // stessa corsa, quindi una chip sola e un filtro che le tiene entrambe.
    const linee = typeof VistaPercorso.lineeElenco === 'function'
      ? VistaPercorso.lineeElenco(uniti)
      : Array.from(new Set(uniti.map((voce) => String(voce.linea)))).sort();
    if (orariGiorno.linea && linee.indexOf(orariGiorno.linea) < 0) orariGiorno.linea = null;
    if (orariGiorno.linea) {
      uniti = typeof VistaPercorso.filtraLinea === 'function'
        ? VistaPercorso.filtraLinea(uniti, orariGiorno.linea)
        : uniti.filter((voce) => String(voce.linea) === orariGiorno.linea);
    }
    const filtro = linee.length > 1
      ? '<div class="chips-linea" role="group" aria-label="Filtra per linea">' +
        chipFiltroLinea('', 'Tutte') + linee.map((l) => chipFiltroLinea(l, l)).join('') + '</div>'
      : '';
    if (!uniti.length) return filtro;
    const oggi = routing.giorno === oggiISO();
    return filtro + '<ul class="lista-arrivi">' + uniti.map((arrivo, indice) => {
      // Relativo solo per le corse vicine e solo se si guarda oggi: «tra 50
      // min» riferito a un altro giorno non vuol dire niente.
      const relativo = oggi && arrivo.minuti <= MINUTI_RELATIVI;
      const tempo = relativo
        ? (arrivo.minuti <= 0
          ? 'ora'
          : Math.max(1, arrivo.minuti) + '<span class="unita">min</span>')
        : '<span class="arrivo-alle">' + esc(arrivo.ora) + '</span>';
      const voce = coloreLinea(arrivo.linea);
      const colore = voce
        ? ' style="background:' + esc(voce[0]) + ';color:' + esc(Utilita.testoSuColore(voce[0], voce[1])) + '"'
        : '';
      const aperto = live.aperto === indice;
      const attivo = !!(live.avvisa && live.avvisa.linea === arrivo.linea && live.avvisa.ora === arrivo.ora);
      // Il numero del bus non è una destinazione: resta nel dettaglio, mentre
      // in riga si mostra il capolinea o, se il GTFS non lo sa, uno stato
      // onesto invece di «Bus 5554».
      // Il capolinea per esteso non ci sta e non dice da che parte va il bus:
      // in riga resta la direzione compatta, il nome intero nel dettaglio.
      const direzione = (typeof Utilita !== 'undefined' && Utilita.direzioneCompatta)
        ? Utilita.direzioneCompatta(arrivo.destinazione || '')
        : (arrivo.destinazione || '');
      const meta = direzione ? '→ ' + direzione : '';
      const dettaglio = aperto
        ? '<div class="arrivo-dettaglio">' +
          '<div class="riga"><span>' + (arrivo.tipo === 'live' ? 'Bus ' + esc(arrivo.bus || '') : 'Orario programmato') + '</span>' +
          '<span>ore ' + esc(arrivo.ora) + '</span></div>' +
          (arrivo.destinazione ? '<div class="riga"><span>Direzione</span><span>' + esc(arrivo.destinazione) + '</span></div>' : '') +
          '<div class="riga"><span>Avviso</span>' +
          '<button type="button" class="link-mini" data-azione="avvisa" data-avvisa-linea="' + esc(arrivo.linea) +
          '" data-avvisa-ora="' + esc(arrivo.ora) + '">' + (attivo ? 'Togli l\'avviso' : 'Avvisami') + '</button></div>' +
          '</div>'
        : '';
      // La riga apre la linea; il chevron resta per i dettagli della corsa e
      // per l'avviso a due minuti, senza nascondere l'azione principale.
      return '<li class="arrivo-item"><div class="arrivo">' +
        '<button type="button" class="arrivo-principale" data-linea-arrivo="' + esc(arrivo.linea) +
        '" aria-label="Apri la linea ' + esc(arrivo.linea) +
        (arrivo.destinazione ? ', direzione ' + esc(arrivo.destinazione) : '') + '">' +
        '<span class="arrivo-tempo">' + tempo + '</span>' +
        '<span class="badge-linea"' + colore + '>' + esc(arrivo.linea) + '</span>' +
        '<span class="arrivo-meta"' + (arrivo.destinazione ? ' title="' + esc(arrivo.destinazione) + '"' : '') + '>' +
        esc(meta) + '</span>' +
        // Solo le corse reali hanno l'etichetta: quella programmata È la norma
        // e occupava lo spazio della destinazione.
        (arrivo.tipo === 'live' ? '<span class="tag-live">LIVE</span>' : '') +
        '</button>' +
        '<button type="button" class="arrivo-chevron" data-arrivo="' + indice +
        '" aria-expanded="' + (aperto ? 'true' : 'false') +
        '" aria-label="Dettagli della corsa ' + esc(arrivo.linea) + ' delle ' + esc(arrivo.ora) + '">' +
        Icone.svg('chevron-down', 16) + '</button>' +
        '</div>' + dettaglio + '</li>';
    }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------------ *
   * Orari programmati della giornata (GTFS)
   * ------------------------------------------------------------------ */
  const orariGiorno = { chiave: null, elenco: [], linea: null };

  function partenzeDelGiorno(f) {
    if (!f || eIndirizzo(f)) return [];
    if (typeof TPERRouting === 'undefined' || !TPERRouting.partenzeFermata) return [];
    const chiave = f.id + '|' + routing.giorno;
    if (orariGiorno.chiave === chiave) return orariGiorno.elenco;
    // Una risposta vuota può voler dire "orari non ancora caricati": metterla
    // in cache lascerebbe la giornata vuota per tutta la sessione.
    let elenco = [];
    try {
      elenco = TPERRouting.partenzeFermata(f.id, dataDaGiornoEOra(routing.giorno, '12:00')) || [];
    } catch (errore) { elenco = []; }
    if (!elenco.length) return elenco;
    orariGiorno.chiave = chiave;
    orariGiorno.elenco = elenco;
    return elenco;
  }

  function chipFiltroLinea(valore, testo) {
    const attivo = (orariGiorno.linea || '') === valore;
    return '<button type="button" class="chip-filtro' + (attivo ? ' attivo' : '') + '"' +
      ' data-linea="' + esc(valore) + '" aria-pressed="' + (attivo ? 'true' : 'false') + '">' +
      esc(testo) + '</button>';
  }

  // Il filtro per linea ridisegna l'elenco unico: nessuna nuova chiamata a
  // HelloBus, si filtra quello che è già in memoria.
  function filtraOrariLinea(valore) {
    orariGiorno.linea = valore || null;
    renderLive();
  }

  // Vista orari: arrivi della fermata scelta, aggiornati ogni 30 secondi.
  /* --- Palina: schermo sempre acceso -------------------------------- */
  // In fermata il telefono sta in mano con gli arrivi aperti: la Wake Lock API
  // evita che lo schermo si spenga mentre si aspetta il bus.
  const K_SCHERMO = 'tperzc_schermo_v1';
  let schermoSempre = false;   // wake lock attivo adesso, non la preferenza
  let sentinellaSchermo = null;

  async function chiediSchermo() {
    if (!('wakeLock' in navigator)) return false;
    try {
      sentinellaSchermo = await navigator.wakeLock.request('screen');
      sentinellaSchermo.addEventListener('release', () => { sentinellaSchermo = null; });
      return true;
    } catch (errore) {
      sentinellaSchermo = null;
      return false;
    }
  }

  function rilasciaSchermo() {
    schermoSempre = false;
    if (!sentinellaSchermo) return;
    const sentinella = sentinellaSchermo;
    sentinellaSchermo = null;
    try { sentinella.release(); } catch (errore) { /* già rilasciata dal browser */ }
  }

  // Preferenza, non un pulsante da premere ogni volta in fermata: chi la
  // accende la ritrova su ogni vista orari.
  function schermoPreferito() {
    return leggi(K_SCHERMO) === '1';
  }

  function aggiornaSchermoToggle() {
    const riga = $('menu-schermo');
    if (!riga) return;
    riga.checked = schermoPreferito();
    const etichetta = riga.closest('.voce-menu');
    if (etichetta) etichetta.hidden = !(typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  }

  async function impostaSchermo(attivo) {
    if (attivo && !('wakeLock' in navigator)) {
      mostraToast('Questo browser non può tenere lo schermo acceso');
      aggiornaSchermoToggle();
      return;
    }
    scrivi(K_SCHERMO, attivo ? '1' : '');
    aggiornaSchermoToggle();
    if (!attivo) {
      rilasciaSchermo();
      mostraToast('Lo schermo può spegnersi di nuovo');
      return;
    }
    if (vistaAttiva === 'orari') {
      schermoSempre = true;
      const ok = await chiediSchermo();
      if (!ok) schermoSempre = false;
    }
    mostraToast('Schermo acceso mentre guardi gli orari');
  }

  // Il browser toglie il wake lock quando la pagina va in background: al
  // ritorno si richiede da soli, senza un altro tocco.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && schermoSempre && !sentinellaSchermo) chiediSchermo();
  });

  function renderLive() {
    const box = $('vista-orari');
    if (!box) return;
    const fermata = fermataLive();
    // Il filtro per linea vale per la fermata e il giorno che si stanno
    // guardando: cambiando l'uno o l'altro si riparte da «Tutte». La chiave
    // della cache è fermata|giorno, quindi basta confrontarla.
    const chiaveVista = fermata ? fermata.id + '|' + routing.giorno : null;
    if (orariGiorno.chiave && chiaveVista && orariGiorno.chiave !== chiaveVista) {
      orariGiorno.linea = null;
    }
    if (fermata && live.stopId !== fermata.id) {
      live.stopId = fermata.id;
      live.items = [];
      live.ts = 0;
      live.stato = 'idle';
      live.avviso = '';
      live.aperto = -1;
      live.avvisa = null;
    }
    let html = '<div class="orari-testa"><div>' +
      '<h2 class="orari-nome">' + esc(fermata ? nomeLuogo(fermata) : 'Scegli una fermata') + '</h2>' +
      (fermata ? '<p class="orari-pos">' + esc(riferimentoFermata(fermata)) + '</p>' : '') +
      '</div>' +
      '<button type="button" class="btn-aggiorna' + (live.caricamento ? ' gira' : '') +
      '" data-azione="aggiorna" aria-label="Aggiorna gli arrivi"' + (fermata ? '' : ' disabled') + '>' +
      ICONA_REFRESH + '</button></div>';
    // Dalla fermata si continua il viaggio senza tornare alla home: gli stessi
    // due gesti della mini-card, ma dentro gli orari.
    if (fermata && !eIndirizzo(fermata)) {
      html += '<div class="orari-azioni">' +
        '<button type="button" class="btn btn-tenue" data-azione="orari-partenza">Parti da qui</button>' +
        '<button type="button" class="btn btn-tenue" data-azione="orari-destinazione">Vai qui</button>' +
        '</div>';
    }
    if (!fermata) {
      html += '<div class="box">Tocca una fermata sulla mappa.</div>';
    } else if (live.stato === 'senza-linee') {
      html += '<div class="box">Qui passano solo treni: valgono gli orari programmati.</div>';
      html += arriviHTML();
    } else if (live.stato === 'non-gestita') {
      // Non è un errore: nell'elenco unico restano le corse programmate.
      html += '<div class="box">Tempo reale non disponibile.</div>';
      html += arriviHTML();
    } else {
      html += statoLiveHTML();
      // Avviso attivo: una riga sola, senza notifiche di sistema.
      if (live.avvisa) {
        const vicino = live.items.filter((a) => a.linea === live.avvisa.linea && a.ora === live.avvisa.ora)[0];
        const quanti = vicino ? minutiA(vicino.ora) : null;
        html += '<div class="avviso-attivo">' + (quanti != null && quanti <= 2
          ? 'Bus ' + esc(live.avvisa.linea) + ' a ' + Math.max(0, quanti) + ' min'
          : 'Avviso attivo: bus ' + esc(live.avvisa.linea) + ' delle ' + esc(live.avvisa.ora)) + '</div>';
      }
      if (live.stato === 'errore' && !live.items.length) {
        html += '<div class="box">Dati non aggiornati. ' +
          '<button type="button" class="link" data-azione="aggiorna">Riprova</button></div>';
      } else {
        // Un solo elenco: prima le corse reali, poi quelle programmate.
        html += arriviHTML() || '<div class="box">Nessun passaggio.</div>';
      }
    }
    box.innerHTML = html;
    aggiornaScrim();
  }

  function avviaTimerLive() {
    fermaTimerLive();
    timerLive = setInterval(() => {
      if (vistaAttiva === 'orari' && document.visibilityState === 'visible' && !live.caricamento) caricaLive(true);
    }, INTERVALLO_LIVE);
  }
  function fermaTimerLive() {
    if (timerLive) { clearInterval(timerLive); timerLive = null; }
  }

  /* ------------------------------------------------------------------ *
   * Viste del pannello
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * Linee: «dove passa il 20?»
   * ------------------------------------------------------------------ */
  function lineeIndice() {
    if (typeof Linee === 'undefined' || typeof TPERRouting === 'undefined' || !TPERRouting.orari) return null;
    const orari = TPERRouting.orari();
    return orari ? Linee.indice(orari) : null;
  }

  function serviziDelGiorno() {
    if (typeof TPERRouting === 'undefined' || !TPERRouting.serviziDelGiorno) return null;
    return TPERRouting.serviziDelGiorno(routing.giorno.replace(/-/g, ''));
  }

  function preparaLinee() {
    if (typeof TPERRouting === 'undefined' || !TPERRouting.carica) return;
    if (TPERRouting.disponibile() || lineeInCaricamento) return;
    lineeInCaricamento = true;
    TPERRouting.carica(URL_ORARI_GZ, URL_ORARI).then(() => {
      if (suggerimenti.query) {
        suggerimenti.linee = lineeSuggerite(suggerimenti.query);
        disegnaSuggerimenti();
      }
      // Le fermate fissate mostrano i prossimi passaggi solo con gli orari.
      if (fermateFisse().length) renderPercorso();
      // Il badge «ultima corsa» ha bisogno dell'indice delle linee: appena gli
      // orari sono pronti si annotano le opzioni già calcolate e si ridisegna.
      if (routing.esito && routing.opzioni.length) {
        routing.opzioni.forEach((esito) => segnaUltimaCorsa(esito));
        segnaUltimaCorsa(routing.esito);
        if (vistaAttiva === 'percorso') disegnaPercorso();
      }
    }).catch(() => { /* la ricerca delle fermate funziona lo stesso */ })
      .finally(() => { lineeInCaricamento = false; });
  }

  function lineeSuggerite(testo) {
    const indice = lineeIndice();
    if (!indice || !String(testo || '').trim()) return [];
    return Linee.cerca(indice, testo).map((voce) => ({
      nome: voce.nome,
      tipo: voce.tipo,
      capolinea: voce.versi.map((id) => {
        const f = fermataPerId(id);
        return f ? nomeFermataBreve(f.nome, f.tipo) : String(id);
      })
    }));
  }

  function lineaCorrente() {
    const indice = lineeIndice();
    return indice && lineaVista.nome ? Linee.lineaDi(indice, lineaVista.nome) : null;
  }

  function apriLinea(nome, opzioni) {
    const pulito = String(nome || '').trim().toUpperCase();
    if (!pulito) return;
    const apri = () => {
      const indice = lineeIndice();
      const linea = indice ? Linee.lineaDi(indice, pulito) : null;
      if (!linea) { mostraToast('Linea non disponibile'); return; }
      const versi = Linee.versi(linea);
      lineaVista.nome = linea.nome;
      lineaVista.capolinea = versi.length ? versi[0].capolinea : null;
      vistaRitorno = null;
      chiudiOverlay();
      mostraVista('linea');
      impostaSheet('meta');
      disegnaLineaMappa();
      aggiornaUrl(!opzioni || opzioni.storia !== false ? 'push' : 'replace');
    };
    if (typeof TPERRouting === 'undefined' || !TPERRouting.carica) {
      mostraToast('Linee non disponibili');
      return;
    }
    if (TPERRouting.disponibile()) apri();
    else TPERRouting.carica(URL_ORARI_GZ, URL_ORARI).then(apri)
      .catch(() => mostraToast('Linee non disponibili offline'));
  }

  function renderLinea() {
    const box = $('vista-linea');
    if (!box) return;
    const linea = lineaCorrente();
    if (!linea) {
      box.innerHTML = '<div class="box">Linea non disponibile.</div>';
      return;
    }
    const versi = Linee.versi(linea);
    if (!versi.some((voce) => String(voce.capolinea) === String(lineaVista.capolinea))) {
      lineaVista.capolinea = versi.length ? versi[0].capolinea : null;
    }
    const fermate = Linee.fermateVerso(linea, lineaVista.capolinea);
    const attive = serviziDelGiorno();
    const ultima = Linee.ultima(linea, lineaVista.capolinea, attive);
    const treno = linea.tipo === 1 || linea.tipo === 2;
    const peopleMover = String(linea.nome).toUpperCase() === 'MEX';
    let html = '<div class="linea-testa"><div>' +
      '<h2 class="linea-nome">Linea ' + esc(linea.nome) + '</h2>' +
      '<p class="linea-pos">' + (peopleMover ? 'People mover' : treno ? 'Treno' : 'Bus') + ' · ' +
      (ultima ? 'ultima corsa ' + esc(hhmm(ultima.secondi)) : 'orari non disponibili per oggi') +
      '</p>' + (ritardoTipico(linea.nome) != null
        ? '<p class="linea-pos">Di solito ' + (ritardoTipico(linea.nome) > 0 ? '+' : '−') +
          Math.abs(ritardoTipico(linea.nome)) + ' min, dai tuoi viaggi</p>'
        : '') +
      '</div></div>';
    // Una sola tendina invece di una fila di chip da scorrere: le linee con
    // molte varianti (la 20 ne ha nove) restano leggibili e si scelgono con
    // un tocco, anche da tastiera.
    if (versi.length > 1) {
      html += '<label class="linea-direzione"><span class="linea-direzione-eti">Direzione</span>' +
        '<select data-linea-verso aria-label="Direzione della linea">' +
        versi.map((voce) => '<option value="' + esc(voce.capolinea) + '"' +
          (String(voce.capolinea) === String(lineaVista.capolinea) ? ' selected' : '') + '>→ ' +
          esc(nomeFermataBreve(nomeFermata(voce.capolinea), (fermataPerId(voce.capolinea) || {}).tipo)) + '</option>').join('') +
        '</select></label>';
    } else if (versi.length === 1) {
      html += '<p class="linea-direzione-sola">→ ' + esc(nomeFermataBreve(nomeFermata(versi[0].capolinea), (fermataPerId(versi[0].capolinea) || {}).tipo)) + '</p>';
    }
    if (fermate.length) {
      html += '<ol class="linea-fermate">' + fermate.map((id, indice) => {
        const f = fermataPerId(id);
        const capolinea = indice === fermate.length - 1;
        return '<li' + (capolinea ? ' class="capolinea"' : '') + '><button type="button" class="linea-fermata" data-fermata-linea="' +
          esc(id) + '"><span class="linea-testo"><span class="linea-stop">' +
          esc(f ? nomeFermataBreve(f.nome, f.tipo) : id) + '</span>' +
          (f && f.zona ? '<span class="linea-meta">zona ' + esc(f.zona) + '</span>' : '') +
          '</span></button></li>';
      }).join('') + '</ol>';
    } else {
      html += '<div class="box">Questa linea non ha fermate in comune con il dataset.</div>';
    }
    html += '<p class="testo-intro">Sequenza della corsa più frequente. Tocca una fermata per gli orari.</p>';
    box.innerHTML = html;
  }

  // La mappa può non avere ancora lo stile (primo avvio, cambio stile o rete
  // lenta): il tracciato non si perde, si riprova finché la mappa è pronta.
  function disegnaLineaMappa(tentativo) {
    if (vistaAttiva !== 'linea') return;
    const linea = lineaCorrente();
    if (!linea || typeof TPERRouting === 'undefined' || !TPERRouting.formaCorsa) return;
    if (!mappa || !mappa.isStyleLoaded()) {
      // Nessun limite di tentativi: finché la vista linea è aperta si aspetta
      // lo stile, anche su rete lenta. Uscendo dalla vista il controllo in
      // testa ferma i tentativi da solo.
      setTimeout(() => disegnaLineaMappa((tentativo || 0) + 1), 300);
      return;
    }
    const indiceCorsa = Linee.corsaVerso(linea, lineaVista.capolinea);
    TPERRouting.caricaTracciati(URL_TRACC_GZ, URL_TRACC).then(() => {
      if (vistaAttiva !== 'linea' || !mappa || !mappa.isStyleLoaded()) {
        setTimeout(() => disegnaLineaMappa((tentativo || 0) + 1), 300);
        return;
      }
      const punti = indiceCorsa != null ? TPERRouting.formaCorsa(indiceCorsa) : null;
      // Il colore è quello ufficiale della linea (GTFS route_color), scurito
      // solo se troppo chiaro per il fondo, come per i percorsi.
      const colore = coloreTracciato(linea.nome) || '#C1121F';
      try {
        if (!mappa.getSource('linea-vista')) {
          mappa.addSource('linea-vista', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          mappa.addLayer({
            id: 'linea-vista-bordo', type: 'line', source: 'linea-vista',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#FFFFFF', 'line-width': 9, 'line-opacity': 0.9 }
          });
          mappa.addLayer({
            id: 'linea-vista', type: 'line', source: 'linea-vista',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': colore, 'line-width': 4 }
          });
        } else if (mappa.getLayer('linea-vista')) {
          mappa.setPaintProperty('linea-vista', 'line-color', colore);
        }
      } catch (errore) { return; }
      mappa.getSource('linea-vista').setData({
        type: 'FeatureCollection',
        features: punti && punti.length > 1 ? [{
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: punti }
        }] : []
      });
      if (!punti || punti.length < 2) return;
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      punti.forEach((punto) => {
        if (punto[0] < minLon) minLon = punto[0];
        if (punto[1] < minLat) minLat = punto[1];
        if (punto[0] > maxLon) maxLon = punto[0];
        if (punto[1] > maxLat) maxLat = punto[1];
      });
      mappa.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
        padding: { top: 80, left: 28, right: 28, bottom: Math.round(window.innerHeight * 0.45) },
        duration: durataMovimento(600), maxZoom: 15
      });
    }).catch(() => { /* il resto della vista funziona senza tracciato */ });
  }

  function pulisciLineaMappa() {
    if (mappa && mappa.getSource('linea-vista')) {
      mappa.getSource('linea-vista').setData({ type: 'FeatureCollection', features: [] });
    }
  }

  // Comparsa a cascata dei contenuti: il contenitore riceve `.ingresso`, il CSS
  // sfalsa le righe di 40 ms. La chiave evita che una vista già composta
  // (o un aggiornamento del live) rifaccia l'animazione da capo.
  function animaIngresso(el, chiave) {
    if (!el || !chiave || el.dataset.ingresso === chiave) return;
    el.dataset.ingresso = chiave;
    el.classList.remove('ingresso');
    void el.offsetWidth;
    el.classList.add('ingresso');
    setTimeout(() => el.classList.remove('ingresso'), 900);
  }

  function mostraVista(nome) {
    vistaAttiva = nome;
    $('vista-percorso').hidden = nome !== 'percorso';
    $('vista-orari').hidden = nome !== 'orari';
    $('vista-linea').hidden = nome !== 'linea';
    // La chiave è il nome della vista: tornare su una schermata la ricompone,
    // un aggiornamento della stessa no (altrimenti il live la farebbe sfarfallare).
    const attiva = $('vista-' + nome);
    if (attiva) animaIngresso(attiva, nome);
    const corpo = $('sheet-corpo');
    if (corpo) corpo.scrollTop = 0;
    if (nome === 'linea') renderLinea();
    else pulisciLineaMappa();
    // Uscendo dalla linea la direzione non serve più: senza questo, gli orari
    // aperti dalla home erediterrebbero il parametro `linea` e un ritorno
    // sbagliato alla vista linea.
    if (nome === 'percorso') {
      lineaVista.nome = null;
      lineaVista.capolinea = null;
      vistaRitorno = null;
    }
    if (nome === 'orari') {
      renderLive();
      if (!live.items.length && !live.caricamento) caricaLive(false);
      avviaTimerLive();
      // Preferenza «schermo acceso»: si applica entrando negli orari, senza
      // un secondo tocco in fermata.
      if (schermoPreferito() && !sentinellaSchermo) {
        schermoSempre = true;
        chiediSchermo().then((ok) => { if (!ok) schermoSempre = false; });
      }
    } else {
      fermaTimerLive();
      // Uscendo dagli arrivi la palina non serve più: lo schermo torna libero.
      if (schermoSempre) rilasciaSchermo();
    }
    aggiornaScrim();
    aggiornaBarra();
  }

  // Freccia in alto a sinistra: si risale di un gradino, senza perdere il
  // percorso finché non si torna davvero alla schermata iniziale.
  function tornaIndietro() {
    // Dentro linea e orari il tasto dell'app fa lo stesso del browser: torna
    // alla voce precedente vera, non solo a una vista ricostruita.
    const profondita = history.state && history.state.tper ? history.state.profondita || 0 : 0;
    if (vistaAttiva !== 'percorso' && profondita > 0) { history.back(); return; }
    if (vistaAttiva === 'linea') { mostraVista('percorso'); impostaSheet('meta'); return; }
    if (vistaAttiva === 'orari' && vistaRitorno === 'linea') {
      vistaRitorno = null;
      mostraVista('linea');
      impostaSheet('meta');
      return;
    }
    if (vistaAttiva === 'orari') { mostraVista('percorso'); impostaSheet('meta'); return; }
    // Il pannello non è una schermata: ridurlo è un gesto, non un passo
    // indietro. Dalla vista dettaglio si torna al riepilogo, dal riepilogo si
    // torna alla home con un tocco solo; il peek resta una posizione del
    // pannello, non una tappa obbligata.
    if (statoSheet === 'piena') { impostaSheet('meta'); return; }
    if (sel.destinazione) {
      if (profondita > 0) { history.back(); return; }
      azzeraNavigazione();
      return;
    }
    // Partenza scelta a mano, senza destinazione: si annulla la scelta e si
    // torna alla posizione automatica, invece di restare su una tratta a metà.
    if (sel.partenza && !sel.partenza.gps) {
      if (profondita > 0) { history.back(); return; }
      sel.partenza = null;
      impostaInput('partenza');
      aggiornaMarker();
      renderPercorso();
      impostaSheet('peek');
      aggiornaUrl('replace');
      partenzaDallaPosizione();
    }
  }

  // Quanto pannello si vede davvero: aggiorna --h-sheet e restituisce il valore,
  // così chi lo usa non deve rileggerlo dal DOM.
  // Il bordo del pannello si calcola dalla sua altezza e dalla traslazione che
  // gli stiamo dando, non leggendo il rect: durante un'animazione il rect è
  // ancora quello vecchio e comandi e attribuzione restavano indietro.
  function altezzaVisibile() {
    const pannello = $('sheet');
    const altezza = pannello.offsetHeight || 600;
    const top = window.innerHeight - altezza + traslazionePannello;
    const visibile = Math.max(120, window.innerHeight - top);
    document.documentElement.style.setProperty('--h-sheet', visibile + 'px');
    // Pannello quasi a tutto schermo: mappa e attribuzione si tolgono di mezzo.
    document.body.classList.toggle('pannello-alto', visibile > window.innerHeight * 0.62);
    return visibile;
  }

  function traslazionePer(stato) {
    const sheet = $('sheet');
    const altezza = sheet.offsetHeight || 600;
    if (stato === 'piena') return 0;
    // PEEK: si misura quanto occupano davvero i campi, la riga di data/ora e
    // il pulsante di ricerca, così nessuno dei tre resta tagliato dal bordo.
    const vista = $('vista-percorso');
    // Solo i primi tre blocchi contano: la lista delle fermate vicine e il
    // risultato del percorso stanno sotto e non devono allungare il PEEK.
    // Il contenuto si misura dal bordo del pannello, non dall'inizio della
    // vista: tra i due ci sono maniglia e padding, e il PEEK tagliava la
    // scheda proprio di quella misura.
    let contenuto = PEEK_VISIBILE - 28;
    if (vista && !vista.hidden) {
      const ultimo = vista.querySelector('[data-azione="cerca"]') || $('btn-quando');
      if (ultimo) contenuto = Math.max(0, ultimo.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top);
    }
    const peekVisibile = Math.max(120, Math.min(altezza - 96, contenuto + 28));
    const peek = Math.max(0, altezza - peekVisibile);
    if (stato === 'peek') return Math.round(peek);
    // HALF: il 45% dello schermo, sempre sopra il punto ridotto.
    const meta = Math.max(0, Math.round(altezza - Math.min(window.innerHeight * 0.45, altezza - 96)));
    return Math.round(Math.min(meta, peek));
  }

  // Posizione del pannello in un unico posto: il dito riparte sempre da dove
  // il pannello è davvero, non dallo stato "già impostato" mentre l'animazione
  // precedente è ancora in corso (era il salto a inizio gesto).
  let traslazionePannello = 0;
  let framePannello = null;

  function aggiornaFisicaPannello() {
    altezzaVisibile();
    aggiornaScrim();
    aggiornaBarra();
  }

  function applicaTrasformazione(pixel, animato, silenzioso) {
    const sheet = $('sheet');
    traslazionePannello = Math.max(0, Math.round(pixel));
    // Comandi e attribuzione seguono il pannello: durante un'animazione sì,
    // durante il dito no, altrimenti arrivano dopo la mano.
    document.body.classList.toggle('pannello-animato', !!animato);
    sheet.style.transition = animato ? 'transform .34s cubic-bezier(.22,.9,.28,1)' : 'none';
    sheet.style.transform = 'translateY(' + traslazionePannello + 'px)';
    // Il pannello tradotto verso il basso lascia il fondo del corpo sotto il
    // bordo dello schermo: scorrendo fino in fondo gli ultimi elementi
    // (pulsanti e link) restavano invisibili. Il padding pari allo scostamento
    // li riporta a portata di scorrimento.
    const corpo = $('sheet-corpo');
    if (corpo && !silenzioso) {
      corpo.style.paddingBottom = 'calc(24px + env(safe-area-inset-bottom, 0px) + ' + traslazionePannello + 'px)';
    }
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

  // FULL = 85% dello schermo: sopra il pannello resta sempre un pezzo di mappa.
  function adattaAltezzaSheet() {
    const sheet = $('sheet');
    if (!sheet) return;
    const altezza = Math.max(280, Math.min(760, Math.round(window.innerHeight * 0.85)));
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
    const pannello = $('sheet');
    if (pannello) pannello.setAttribute('data-stato', stato);
    adattaAltezzaSheet();
    applicaTrasformazione(traslazionePer(stato), true);
    aggiornaBarra();
    aggiornaBarra();
    // Lo spazio visibile cambia con il pannello: il percorso si reinquadra, ma
    // solo quando il pannello si muove davvero (prima anche un semplice resize
    // o un richiamo identico spostavano la mappa).
    if (cambiato && routing.stato === 'ok') setTimeout(() => inquadraPercorso(400), 340);
  }

  function cicloSheet() {
    if (sopprimiClick) return;
    // Il tocco sul pomello fa il giro completo: chiuso → metà → tutto → chiuso.
    if (statoSheet === 'peek') impostaSheet('meta');
    else if (statoSheet === 'meta') impostaSheet('piena');
    else impostaSheet('peek');
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
  /* ------------------------------------------------------------------ *
   * Menu laterale
   * ------------------------------------------------------------------ */
  function renderInfo() {
    const box = $('menu-info-corpo');
    if (!box || box.dataset.pronto === '1') return;
    box.dataset.pronto = '1';
    box.innerHTML =
      '<div><h3>Tempo reale</h3><p>Gli arrivi arrivano da HelloBus, il servizio TPER. LIVE = posizione reale del bus. ORARIO = orario programmato. Per i treni esiste solo l\'orario programmato.</p></div>' +
      '<div><h3>Dati</h3><p>Fermate, zone e linee: open data TPER / Regione Emilia-Romagna (CC BY 3.0 IT). Orari bus: GTFS TPER. Orari treni: GTFS Trenitalia (CC BY 4.0), conversione deryclem/trenitalia-gtfs. Percorsi a piedi: OSRM / OpenStreetMap.</p>' +
      '<p>Treni coperti: Bologna C.le, Imola, Bologna–Pianoro, la S1 Bologna–Porretta e la S2A Bologna–Vignola.</p>' +
      '<p>Fermate aggiornate al ' + esc(aggiornato || 'non disponibile') + '. Prezzi indicativi: verifica su tper.it.</p>' +
      '<a href="https://www.tper.it" target="_blank" rel="noopener">Apri tper.it</a></div>' +
      '<div><h3>Privacy</h3><p>Nessun dato personale lascia il telefono: preferenze e percorsi recenti restano in localStorage, la posizione serve solo a trovare le fermate vicine e non viene salvata. Nessun tracciamento, nessuno cookie, nessuna statistica.</p>' +
      '<p>' +
      '<a href="privacy.html">Informativa privacy</a> · ' +
      '<a href="termini.html">Termini</a> · ' +
      '<a href="cookie.html">Cookie</a> · ' +
      '<a href="note-legali.html">Note legali</a></p>' +
      '<p><button type="button" class="link-mini" data-azione="cancella-dati">Cancella tutti i dati</button></p></div>' +
      '<p><b>App non ufficiale</b>, non affiliata a TPER. Orari e prezzi possono essere imprecisi: verifica sempre su <a href="https://www.tper.it" target="_blank" rel="noopener">tper.it</a>.</p>';
  }

  // "Cancella tutti i dati": preferenze, cache e service worker. Sul server non
  // c'è niente da cancellare, perché l'app non manda dati personali.
  function cancellaDati() {
    try { localStorage.clear(); } catch (errore) { /* storage non disponibile */ }
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then((nomi) => Promise.all(nomi.map((nome) => caches.delete(nome))))
        .catch(() => {});
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations()
        .then((registrazioni) => Promise.all(registrazioni.map((r) => r.unregister())))
        .catch(() => {});
    }
    mostraToast('Dati cancellati. L\'app si riavvia vuota.', 1200);
    setTimeout(() => { try { location.reload(); } catch (errore) { /* niente */ } }, 900);
  }

  function renderLogErrori() {
    const box = $('log-errori');
    if (!box) return;
    const elenco = leggiJSON(K_ERRORI) || [];
    if (!elenco.length) {
      box.innerHTML = '<p>Nessun errore registrato.</p>';
      return;
    }
    box.innerHTML = elenco.slice(0, 10).map((voce) => {
      const quando = new Date(voce.ts || Date.now()).toLocaleString('it-IT');
      return '<div class="voce-log"><b>' + esc(voce.tipo || 'errore') + '</b> · ' + esc(quando) +
        '<br>' + esc(voce.messaggio || '') + '</div>';
    }).join('') + '<div class="log-azioni">' +
      '<button type="button" class="link-mini" data-azione="copia-log">Copia log</button>' +
      '<button type="button" class="link-mini" data-azione="cancella-log">Cancella il log</button></div>';
  }

  // Segnalare un problema serve solo se chi legge sa versione, dataset e stack:
  // si copia tutto in un testo pronto da incollare in una issue.
  function copiaLogErrori() {
    const elenco = leggiJSON(K_ERRORI) || [];
    const righe = [
      'Muovi Bologna',
      'dataset: ' + (aggiornato || 'sconosciuto'),
      'caricamento dati: ' + (diagnostica.caricamentoMs != null ? diagnostica.caricamentoMs + ' ms' : 'non misurato'),
      'dispositivo: ' + navigator.userAgent,
      ''
    ].concat(elenco.slice(0, 20).map((voce) => {
      const quando = new Date(voce.ts || Date.now()).toISOString();
      return '[' + quando + '] ' + (voce.tipo || 'errore') + ': ' + (voce.messaggio || '') +
        (voce.stack ? '\n' + voce.stack : '');
    }));
    const testo = righe.join('\n');
    const fatto = () => mostraToast('Log copiato negli appunti');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(testo).then(fatto).catch(() => mostraToast('Copia non riuscita'));
      return;
    }
    const area = document.createElement('textarea');
    area.value = testo;
    area.setAttribute('readonly', 'readonly');
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); fatto(); }
    catch (errore) { mostraToast('Copia non riuscita'); }
    area.remove();
  }

  function leggiIndirizziCache(chiave) {
    const salvati = leggiJSON(K_INDIRIZZI);
    const voce = salvati && salvati[chiave];
    if (!voce || !Array.isArray(voce.luoghi)) return null;
    if (!voce.ts || Date.now() - voce.ts > 7 * 24 * 3600 * 1000) return null;
    return voce.luoghi;
  }

  function salvaIndirizziCache(chiave, luoghi) {
    const salvati = leggiJSON(K_INDIRIZZI) || {};
    const chiavi = Object.keys(salvati);
    if (chiavi.length >= 40) {
      chiavi.sort((a, b) => (salvati[a].ts || 0) - (salvati[b].ts || 0));
      delete salvati[chiavi[0]];
    }
    salvati[chiave] = { ts: Date.now(), luoghi: luoghi };
    try { scrivi(K_INDIRIZZI, JSON.stringify(salvati)); } catch (errore) { /* pieno */ }
  }

  function sincronizzaMenu() {
    renderPreferiti();
    renderViaggi();
    renderEvitate();
    const check = $('menu-abbonamento');
    if (check) check.checked = abbonamento;
    const voceErrori = $('menu-errori');
    if (voceErrori) {
      const quanti = (leggiJSON(K_ERRORI) || []).length;
      voceErrori.hidden = quanti === 0;
      const conteggio = $('menu-errori-conteggio');
      if (conteggio) conteggio.textContent = quanti ? String(quanti) : '';
    }
    const recente = $('menu-recente');
    const vuoto = $('menu-recente-vuoto');
    if (recente && vuoto) {
      if (sel.partenza && sel.destinazione) {
        recente.innerHTML = '<span>' + esc(nomeLuogo(sel.partenza)) + ' → ' + esc(nomeLuogo(sel.destinazione)) + '</span>' +
          '<small>' + esc(quandoEtichetta()) + '</small>';
        recente.hidden = false;
        vuoto.hidden = true;
      } else {
        recente.hidden = true;
        vuoto.hidden = false;
      }
    }
    const statoPosizione = $('menu-posizione-stato');
    if (statoPosizione) statoPosizione.textContent = posizioneUtente ? 'Attiva' : 'Trova';
    const tema = $('menu-tema');
    if (tema) tema.checked = document.documentElement.getAttribute('data-tema') === 'scuro';
    renderNotificheMenu();
  }

  function apriMenu() {
    const drawer = $('drawer');
    if (!drawer) return;
    // Un preferito aggiunto e poi abbandonato senza posto non deve restare
    // nel menu come riga vuota.
    if (!preferitoInCorso) {
      const meta = preferitiMeta();
      const salvati = preferitiSalvati();
      const orfani = meta.extra.filter((voce) => !salvati[voce.slot]);
      if (orfani.length) {
        meta.extra = meta.extra.filter((voce) => !!salvati[voce.slot]);
        const tenuti = meta.extra.map((voce) => voce.slot);
        meta.ordine = meta.ordine.filter((slot) =>
          slot === 'casa' || slot === 'lavoro' || tenuti.indexOf(slot) >= 0);
        orfani.forEach((voce) => { delete meta.nomi[voce.slot]; });
        scriviPreferitiMeta(meta);
      }
    }
    sincronizzaMenu();
    drawer.classList.add('aperto');
    animaIngresso(drawer, 'menu');
    drawer.setAttribute('aria-hidden', 'false');
    $('drawer-velo').hidden = false;
    $('btn-menu').setAttribute('aria-expanded', 'true');
  }

  function chiudiMenu() {
    const drawer = $('drawer');
    if (!drawer) return;
    drawer.classList.remove('aperto');
    drawer.setAttribute('aria-hidden', 'true');
    $('drawer-velo').hidden = true;
    $('btn-menu').setAttribute('aria-expanded', 'false');
    if (drawer.contains(document.activeElement)) document.activeElement.blur();
  }

  // Il menu resta per quello che serve a un viaggio: posizione, percorso,
  // viaggi salvati, preferiti. Tutto il resto vive qui, dietro un tasto solo.
  function apriImpostazioni() {
    const pannello = $('impostazioni');
    if (!pannello) return;
    chiudiMenu();
    renderInfo();
    renderFeriale();
    renderMappa();
    renderNotificheMenu();
    renderSegnala();
    aggiornaSchermoToggle();
    const notaBackup = $('menu-esporta-nota');
    if (notaBackup) {
      const pacchetto = Utilita.esportaDati(window.localStorage);
      notaBackup.textContent = pacchetto.chiavi ? pacchetto.chiavi + ' voci' : 'vuoto';
    }
    pannello.hidden = false;
    const corpo = pannello.querySelector('.impostazioni-corpo');
    if (corpo) corpo.scrollTop = 0;
    const chiudi = $('impostazioni-chiudi');
    if (chiudi) chiudi.focus();
  }

  function chiudiImpostazioni() {
    const pannello = $('impostazioni');
    if (!pannello || pannello.hidden) return;
    pannello.hidden = true;
  }

  // Un solo punto per la segnalazione: la fermata aperta, se c'è, finisce già
  // nel corpo della issue; altrimenti si apre il modulo vuoto.
  function renderSegnala() {
    const link = $('menu-segnala');
    if (!link) return;
    const fermata = fermataLive();
    const segnala = fermata
      ? urlSegnalazioneCorsa({ fermata: fermata, linee: lineaDi(fermata).slice(0, 4).join(' · ') })
      : '';
    link.href = segnala || 'https://github.com/SuPeRCoDiNg2012/tper-bus/issues/new';
  }

  /* ------------------------------------------------------------------ *
   * Geolocalizzazione
   * ------------------------------------------------------------------ */
  let posizioneAutomaticaInCorso = false;

  // La posizione diventa la partenza senza che l'utente debba premere nulla.
  function posizioneInPartenza(posizione) {
    const lat = posizione.coords.latitude;
    const lon = posizione.coords.longitude;
    if (!isFinite(lat) || !isFinite(lon)) return;
    const vicina = fermateVicine(lat, lon, 1)[0];
    posizioneUtente = { lat: lat, lon: lon, ts: Date.now() };
    sel.partenza = {
      id: 'geo:' + lat.toFixed(5) + ',' + lon.toFixed(5),
      nome: 'La mia posizione',
      indirizzo: '',
      lat: lat,
      lon: lon,
      zona: vicina ? vicina.zona : '500',
      tipo: 'indirizzo',
      genere: 'indirizzo',
      categoria: 'Posizione attuale',
      gps: true
    };
    impostaInput('partenza');
    aggiornaMarker();
    renderPercorso();
    // Il GPS non sta nell'URL: se prima c'era una partenza scelta a mano, la
    // sostituzione deve sparire anche dall'indirizzo, non restare come residuo.
    aggiornaUrl('replace');
    if (sel.destinazione) {
      calcolaPercorso();
      // All'avvio con uno shortcut (?vai=casa) il pannello era ancora in peek:
      // appena arriva la posizione il percorso deve essere visibile.
      if (statoSheet === 'peek') impostaSheet('meta');
    } else {
      impostaSheet('peek');
      inquadra(false);
    }
  }

  function partenzaDallaPosizione() {
    if (posizioneAutomaticaInCorso || sel.partenza || !navigator.geolocation) return;
    // Con il permesso già negato il browser può non richiamare nessuno dei due
    // callback: si evita di chiedere e di lasciare la partenza bloccata.
    const richiedi = () => {
      if (posizioneAutomaticaInCorso || sel.partenza) return;
      posizioneAutomaticaInCorso = true;
      const guardia = setTimeout(() => { posizioneAutomaticaInCorso = false; }, 9000);
      navigator.geolocation.getCurrentPosition((posizione) => {
        clearTimeout(guardia);
        posizioneAutomaticaInCorso = false;
        // Se nel frattempo l'utente ha scelto una partenza, la sua scelta vince.
        if (sel.partenza) return;
        posizioneInPartenza(posizione);
      }, () => {
        // Permesso negato o GPS spento: la home resta con le fermate, senza errori.
        clearTimeout(guardia);
        posizioneAutomaticaInCorso = false;
      }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 });
    };
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((stato) => {
        if (stato.state !== 'denied') richiedi();
      }).catch(richiedi);
    } else {
      richiedi();
    }
  }

  // La voce del menu «La mia posizione» deve fare quello che dice: usare la
  // posizione come partenza, non solo spostare la mappa.
  function posizioneComePartenza() {
    if (!navigator.geolocation) {
      mostraToast('Geolocalizzazione non supportata da questo browser');
      return;
    }
    // Anche se il menu è stato aperto da linea o orari, la posizione serve al
    // percorso: si torna alla schermata di ricerca prima di impostarla.
    mostraVista('percorso');
    mostraToast('Cerco la tua posizione…');
    navigator.geolocation.getCurrentPosition((posizione) => {
      posizioneInPartenza(posizione);
      mostraToast('Partenza: la tua posizione');
    }, () => {
      mostraToast('Posizione non disponibile: controlla i permessi del browser');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function vaiVicino() {
    if (!navigator.geolocation) {
      mostraToast('Geolocalizzazione non supportata da questo browser');
      return;
    }
    avviaGps();
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
      mostraPosizioneUtente(posizione);
      const vicine = senzaDoppioni(fermateVicine(posizione.coords.latitude, posizione.coords.longitude, 8)).slice(0, 6);
      if (mappa) {
        mappa.flyTo({
          center: [posizione.coords.longitude, posizione.coords.latitude],
          zoom: 15,
          offset: [0, -120],
          duration: durataMovimento(900)
        });
      }
      mostraVista('percorso');
      impostaSheet('meta');
      renderPercorso();
      if (vicine.length) mostraToast('Trovate ' + vicine.length + ' fermate vicine');
    }, () => {
      mostraToast('Posizione non disponibile: controlla i permessi del browser');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ------------------------------------------------------------------ *
   * PWA
   * ------------------------------------------------------------------ */
  let ricaricaDaAggiornamento = false;

  // L'aggiornamento è una voce del menu: niente banner sopra la mappa.
  function mostraAvvisoAggiornamento(registrazione) {
    const voce = $('menu-aggiorna');
    if (!voce || !voce.hidden) return;
    voce.hidden = false;
    voce.onclick = () => {
      voce.hidden = true;
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

    // Tocco su una notifica mentre l'app è già aperta: il service worker non
    // può aprirla due volte, quindi manda la fermata qui.
    navigator.serviceWorker.addEventListener('message', (evento) => {
      const dati = evento.data || {};
      if (dati.tipo !== 'fermata') return;
      const fermata = fermataPerId(dati.id);
      if (fermata) apriOrari(fermata);
    });
  }

  function gestisciInstallazione() {
    const voce = $('menu-installa');
    window.addEventListener('beforeinstallprompt', (evento) => {
      evento.preventDefault();
      eventoInstallazione = evento;
      if (voce) voce.hidden = false;
    });
    const installa = async () => {
      if (voce) voce.hidden = true;
      if (!eventoInstallazione) {
        mostraToast('Usa il menu del browser → "Aggiungi a schermata home"');
        return;
      }
      eventoInstallazione.prompt();
      await eventoInstallazione.userChoice;
      eventoInstallazione = null;
    };
    if (voce) voce.addEventListener('click', installa);
    window.installaApp = installa;
  }

  /* ------------------------------------------------------------------ *
   * Eventi
   * ------------------------------------------------------------------ */
  function collegaEventi() {
    // ---- Barra superiore ----
    $('drawer-chiudi').addEventListener('click', chiudiMenu);
    $('drawer-velo').addEventListener('click', chiudiMenu);
    // ---- Prima apertura e tasto indietro ----
    $('ob-avanti').addEventListener('click', () => {
      const ultima = document.querySelectorAll('.ob-slide').length - 1;
      if (onboarding.slide >= ultima) { chiudiOnboarding(); return; }
      onboarding.slide += 1;
      aggiornaOnboarding();
    });
    window.addEventListener('popstate', indietroBrowser);
    $('menu-errori').addEventListener('click', () => {
      const box = $('log-errori');
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) renderLogErrori();
    });
    $('btn-geo').addEventListener('click', vaiVicino);
    $('btn-inquadra').addEventListener('click', () => {
      if (routing.stato === 'ok' && ultimeFeatures.length) inquadraPercorso(400);
      else inquadra();
    });
    $('btn-menu-destra').addEventListener('click', apriMenu);
    // Notifiche ad app chiusa: la riga compare solo con il Worker configurato.
    const pushMenu = $('menu-push');
    if (pushMenu) {
      pushMenu.addEventListener('change', async (evento) => {
        if (!window.Push) return;
        if (evento.target.checked) {
          const esito = await Push.attiva();
          if (esito.esito !== 'ok') {
            evento.target.checked = false;
            const messaggi = {
              'non-configurato': 'Funzione non configurata',
              'non-supportato': 'Questo browser non supporta il push',
              denied: 'Notifiche bloccate dalle impostazioni del sito',
              errore: 'Iscrizione non riuscita, riprova'
            };
            mostraToast(messaggi[esito.esito] || 'Notifiche non attivate');
          } else {
            sincronizzaPush();
            mostraToast('Notifiche attive anche ad app chiusa');
          }
        } else {
          await Push.spegni();
          mostraToast('Notifiche ad app chiusa disattivate');
        }
        renderNotificheMenu();
      });
    }
    // Un tasto, due mestieri: torna indietro oppure apre il menu.
    $('btn-menu').addEventListener('click', () => {
      const barra = $('barra');
      if (barra && barra.classList.contains('torna')) { tornaIndietro(); return; }
      apriMenu();
    });

    // ---- Mini-card fermata ----
    $('mini-chiudi').addEventListener('click', chiudiMini);
    $('mini-fermata').addEventListener('click', (evento) => {
      const bottone = evento.target.closest('[data-mini]');
      if (!bottone || !miniFermata) return;
      const azione = bottone.getAttribute('data-mini');
      if (azione === 'orari') { apriOrari(miniFermata); return; }
      const f = miniFermata;
      chiudiMini();
      selezionaFermata(azione, f);
    });

    // ---- Menu laterale ----
    $('menu-abbonamento').addEventListener('change', (evento) => {
      impostaAbbonamento(evento.target.checked);
      renderPercorso();
    });
    $('menu-posizione').addEventListener('click', () => { chiudiMenu(); posizioneComePartenza(); });
    $('menu-impostazioni').addEventListener('click', apriImpostazioni);
    $('impostazioni-indietro').addEventListener('click', () => { chiudiImpostazioni(); apriMenu(); });
    $('impostazioni-chiudi').addEventListener('click', chiudiImpostazioni);
    const schermoRiga = $('menu-schermo');
    if (schermoRiga) {
      schermoRiga.addEventListener('change', (evento) => { impostaSchermo(evento.target.checked); });
    }
    $('menu-notifiche').addEventListener('click', () => { attivaNotificheMenu(); });
    // Promemoria feriale: ora e preferito si salvano appena cambiano.
    const ferialeToggle = $('menu-feriale');
    if (ferialeToggle) {
      ferialeToggle.addEventListener('change', (evento) => { impostaFeriale(evento.target.checked); });
    }
    const ferialeOra = $('menu-feriale-ora');
    if (ferialeOra) {
      ferialeOra.addEventListener('change', () => {
        scriviFeriale({ ora: /^\d{2}:\d{2}$/.test(ferialeOra.value) ? ferialeOra.value : '07:35' });
        renderFeriale();
        sincronizzaPush();
      });
    }
    const ferialeLuogo = $('menu-feriale-luogo');
    if (ferialeLuogo) {
      ferialeLuogo.addEventListener('change', () => {
        scriviFeriale({ slot: ferialeLuogo.value });
        renderFeriale();
        sincronizzaPush();
      });
    }
    $('menu-mappa-salva').addEventListener('click', salvaMappaCasa);
    $('menu-mappa-svuota').addEventListener('click', svuotaMappa);
    $('menu-esporta').addEventListener('click', scaricaBackup);
    $('menu-importa').addEventListener('change', (evento) => {
      const file = evento.target.files && evento.target.files[0];
      // Svuotato subito: senza, riscegliere lo stesso file non scatenerebbe
      // nessun evento e il ripristino sembrerebbe non funzionare.
      evento.target.value = '';
      ripristinaBackup(file);
    });
    $('menu-testo').addEventListener('change', (evento) => {
      applicaTesto(evento.target.checked, true);
    });
    $('menu-tema').addEventListener('change', (evento) => {
      applicaTema(evento.target.checked, true);
    });
    // Senza una scelta salvata il tema segue il sistema, anche se cambia
    // mentre l'app è aperta.
    const scuroDiSistema = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (scuroDiSistema && scuroDiSistema.addEventListener) {
      scuroDiSistema.addEventListener('change', () => {
        if (!leggi(K_TEMA)) applicaTema(temaPreferito(), false);
      });
    }
    $('menu-linee').addEventListener('change', (evento) => {
      mostraLineeTutte(evento.target.checked);
    });
    $('menu-zone').addEventListener('change', (evento) => {
      mostraZone(evento.target.checked);
      if (evento.target.checked) mostraToast('Tocca un’area o un numero per la zona');
    });
    $('menu-recente').addEventListener('click', () => {
      chiudiMenu();
      routing.chiave = null;
      mostraVista('percorso');
      impostaSheet('meta');
      calcolaPercorso();
    });
    $('menu-viaggi').addEventListener('click', (evento) => {
      const apri = evento.target.closest('[data-viaggio]');
      if (apri) { apriViaggioSalvato(apri.getAttribute('data-viaggio')); return; }
      const togli = evento.target.closest('[data-rimuovi-viaggio]');
      if (togli) rimuoviViaggio(togli.getAttribute('data-rimuovi-viaggio'));
    });
    $('menu-info').addEventListener('toggle', () => { if ($('menu-info').open) renderInfo(); });
    // Il confronto biglietti/abbonamento si aggiorna mentre si scrive, senza
    // ridisegnare la scheda: un re-render farebbe perdere il fuoco al campo.
    $('sheet-corpo').addEventListener('input', (evento) => {
      const id = evento.target && evento.target.id;
      if (id === 'conviene-corse' || id === 'conviene-prezzo') aggiornaConvenienza();
    });
    // Il calcolo compare appena si apre il riquadro, non solo dopo il primo
    // tasto premuto. `toggle` non va in bolla: serve la fase di cattura.
    $('sheet-corpo').addEventListener('toggle', (evento) => {
      const nodo = evento.target;
      if (nodo && nodo.classList && nodo.classList.contains('conviene')) aggiornaConvenienza();
    }, true);
    $('input-evita').addEventListener('keydown', (evento) => {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      const aggiungi = document.querySelector('[data-azione="evita-aggiungi"]');
      if (aggiungi) aggiungi.click();
    });
    // Pannello tecnico: le stesse azioni delle preferenze, più il relay.
    $('admin-chiudi').addEventListener('click', chiudiAdmin);
    $('admin').addEventListener('click', (evento) => {
      if (evento.target === $('admin')) { chiudiAdmin(); return; }
      const togli = evento.target.closest('[data-evita-rimuovi]');
      if (togli) { rimuoviLineaEvitata(togli.getAttribute('data-evita-rimuovi')); return; }
      const pulsante = evento.target.closest('[data-azione]');
      if (!pulsante) return;
      const azione = pulsante.getAttribute('data-azione');
      if (azione === 'evita-aggiungi') aggiungiLineaEvitata();
      if (azione === 'salva-proxy') salvaProxy();
      if (azione === 'azzera-proxy') {
        localStorage.removeItem(K_PROXY);
        const campo = $('input-proxy');
        if (campo) campo.value = '';
        live.items = []; live.ts = 0; live.stato = 'idle';
        mostraToast('Relay predefinito ripristinato');
        caricaLive(true);
      }
    });
    $('drawer').addEventListener('click', (evento) => {
      const togli = evento.target.closest('[data-evita-rimuovi]');
      if (togli) {
        rimuoviLineaEvitata(togli.getAttribute('data-evita-rimuovi'));
        return;
      }
      const pulsante = evento.target.closest('[data-azione]');
      if (!pulsante) return;
      const azione = pulsante.getAttribute('data-azione');
      if (azionePreferito(azione, pulsante)) return;
      if (azione === 'evita-aggiungi') { aggiungiLineaEvitata(); return; }
      if (azione === 'salva-proxy') salvaProxy();
      if (azione === 'cancella-log') {
        localStorage.removeItem(K_ERRORI);
        renderLogErrori();
        sincronizzaMenu();
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
      if (azione === 'copia-log') {
        copiaLogErrori();
        return;
      }
      if (azione === 'cancella-dati') {
        cancellaDati();
        return;
      }
    });
    document.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Escape') return;
      if (!$('admin').hidden) { chiudiAdmin(); return; }
      if (!$('impostazioni').hidden) { chiudiImpostazioni(); apriMenu(); return; }
      if ($('drawer').classList.contains('aperto')) { chiudiMenu(); return; }
      if (!$('cerca').hidden) { chiudiOverlay(); return; }
      if (miniFermata) { chiudiMini(); return; }
    });

    // ---- Ricerca a tutto schermo ----
    const inputCerca = $('cerca-input');
    const cercaTesto = debounce(() => {
      if (!campoAttivo) return;
      apriSuggerimenti(campoAttivo, inputCerca.value);
    }, 260);
    inputCerca.addEventListener('input', () => {
      aggiornaPulisci();
      // Porta di servizio: «admin» apre le impostazioni tecniche, sia dal
      // campo della partenza sia da quello della destinazione.
      if (inputCerca.value.trim().toLowerCase() === 'admin') {
        inputCerca.value = '';
        aggiornaPulisci();
        chiudiOverlay();
        apriAdmin();
        return;
      }
      cercaTesto();
    });
    inputCerca.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        const primo = $('overlay-lista').querySelector('[data-voce], [data-linea], [data-indirizzo], [data-posizione]');
        if (primo) primo.click();
      } else if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
        // Le frecce portano il focus dalla tastiera ai suggerimenti: senza,
        // chi non usa il mouse deve tabulare per ogni voce.
        evento.preventDefault();
        muoviFocusSuggerimenti(evento.key === 'ArrowDown' ? 1 : -1);
      } else if (evento.key === 'Escape') {
        chiudiOverlay();
      }
    });
    $('overlay-lista').addEventListener('keydown', (evento) => {
      if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
        evento.preventDefault();
        muoviFocusSuggerimenti(evento.key === 'ArrowDown' ? 1 : -1);
      }
    });
    $('cerca-indietro').addEventListener('click', chiudiOverlay);
    // ---- Ricerca a voce ----
    // Web Speech API del browser: dove non c'è, il pulsante resta nascosto e
    // non si chiede nessun permesso. L'audio lo elabora il servizio del
    // browser, non l'app (dichiarato nella privacy policy).
    const voceBtn = $('cerca-voce');
    const Riconoscimento = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (voceBtn && Riconoscimento) {
      voceBtn.hidden = false;
      voceBtn.addEventListener('click', () => {
        if (voceAscolto) {
          try { voceAscolto.abort(); } catch (errore) { /* già fermo */ }
          voceAscolto = null;
          voceBtn.classList.remove('in-ascolto');
          return;
        }
        let riconoscimento = null;
        try {
          riconoscimento = new Riconoscimento();
        } catch (errore) {
          mostraToast('Ricerca a voce non disponibile');
          return;
        }
        riconoscimento.lang = document.documentElement.lang === 'en' ? 'en-US' : 'it-IT';
        riconoscimento.interimResults = false;
        riconoscimento.maxAlternatives = 1;
        riconoscimento.onresult = (evento) => {
          const voce = evento.results && evento.results[0] && evento.results[0][0];
          const testo = voce ? String(voce.transcript || '').trim() : '';
          if (!testo) return;
          inputCerca.value = testo;
          aggiornaPulisci();
          apriSuggerimenti(campoAttivo || 'destinazione', testo);
        };
        riconoscimento.onerror = (evento) => {
          if (evento.error === 'not-allowed' || evento.error === 'service-not-allowed') {
            mostraToast('Microfono non consentito');
          } else if (evento.error === 'no-speech') {
            mostraToast('Non ho sentito niente: riprova');
          }
        };
        riconoscimento.onend = () => {
          voceAscolto = null;
          voceBtn.classList.remove('in-ascolto');
        };
        voceAscolto = riconoscimento;
        voceBtn.classList.add('in-ascolto');
        try {
          riconoscimento.start();
        } catch (errore) {
          voceAscolto = null;
          voceBtn.classList.remove('in-ascolto');
        }
      });
    }
    // Focus trap: con la ricerca aperta il Tab gira dentro l'overlay, non
    // finisce sulla mappa o sul pannello che stanno sotto.
    $('cerca').addEventListener('keydown', (evento) => {
      if (evento.key !== 'Tab') return;
      const elementi = Array.prototype.filter.call(
        $('cerca').querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'),
        (el) => !el.hidden && el.offsetParent !== null
      );
      if (!elementi.length) return;
      const primo = elementi[0];
      const ultimo = elementi[elementi.length - 1];
      if (evento.shiftKey && document.activeElement === primo) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primo.focus();
      }
    });
    $('cerca-pulisci').addEventListener('click', () => {
      inputCerca.value = '';
      aggiornaPulisci();
      apriSuggerimenti(campoAttivo, '');
      inputCerca.focus();
    });
    $('overlay-lista').addEventListener('click', (evento) => {
      // Recenti modificabili: la X toglie la voce, "Modifica" mostra le X.
      const rimuovi = evento.target.closest('[data-rimuovi]');
      if (rimuovi) {
        const id = rimuovi.getAttribute('data-rimuovi');
        const ids = (leggiJSON(K_RECENTI) || []).filter((voce) => voce !== id);
        scrivi(K_RECENTI, JSON.stringify(ids));
        apriSuggerimenti(campoAttivo, suggerimenti.query);
        return;
      }
      const linea = evento.target.closest('[data-linea]');
      if (linea) {
        apriLinea(linea.getAttribute('data-linea'));
        return;
      }
      const modifica = evento.target.closest('[data-azione="modifica-recenti"]');
      if (modifica) {
        suggerimenti.modifica = !suggerimenti.modifica;
        disegnaSuggerimenti();
        return;
      }
      const chip = evento.target.closest('[data-chip]');
      if (chip) {
        const testo = chip.getAttribute('data-chip') || '';
        inputCerca.value = testo;
        aggiornaPulisci();
        apriSuggerimenti(campoAttivo, testo);
        inputCerca.focus();
        return;
      }
      const miaPosizione = evento.target.closest('[data-posizione]');
      if (miaPosizione) {
        if (!posizioneUtente) return;
        const vicina = fermateVicine(posizioneUtente.lat, posizioneUtente.lon, 1)[0];
        scegliLuogo('partenza', {
          id: 'geo:' + posizioneUtente.lat.toFixed(5) + ',' + posizioneUtente.lon.toFixed(5),
          nome: 'La mia posizione',
          indirizzo: '',
          lat: posizioneUtente.lat,
          lon: posizioneUtente.lon,
          zona: vicina ? vicina.zona : '500',
          tipo: 'indirizzo',
          genere: 'indirizzo',
          categoria: 'Posizione attuale',
          gps: true
        });
        return;
      }
      const indirizzo = evento.target.closest('[data-indirizzo]');
      if (indirizzo) {
        const lat = parseFloat(indirizzo.getAttribute('data-lat'));
        const lon = parseFloat(indirizzo.getAttribute('data-lon'));
        if (!isFinite(lat) || !isFinite(lon)) return;
        const vicina = fermateVicine(lat, lon, 1)[0];
        const ruolo = indirizzo.getAttribute('data-ruolo') || campoAttivo || 'destinazione';
        scegliLuogo(ruolo, {
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
      scegliLuogo(ruolo, fermata);
    });

    // ---- Pannello ----
    $('grab').addEventListener('click', cicloSheet);
    $('grab').addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); cicloSheet(); }
    });
    abilitaTrascinamento($('grab'));
    abilitaScorrimentoSheet();
    $('sheet-corpo').addEventListener('scroll', aggiornaScrim, { passive: true });
    $('vista-linea').addEventListener('change', (evento) => {
      const verso = evento.target.closest('[data-linea-verso]');
      if (!verso) return;
      lineaVista.capolinea = verso.value;
      renderLinea();
      disegnaLineaMappa();
    });
    $('sheet-corpo').addEventListener('click', (evento) => {
      if (sopprimiClick) { evento.preventDefault(); evento.stopPropagation(); sopprimiClick = false; return; }
      const apriFissa = evento.target.closest('[data-apri-fissa]');
      if (apriFissa) {
        const f = fermataPerId(apriFissa.getAttribute('data-apri-fissa'));
        if (f) apriOrari(f);
        return;
      }
      const fermataLinea = evento.target.closest('[data-fermata-linea]');
      if (fermataLinea) {
        const f = fermataPerId(fermataLinea.getAttribute('data-fermata-linea'));
        if (f) { vistaRitorno = 'linea'; apriOrari(f); }
        return;
      }
      const campo = evento.target.closest('[data-campo]');
      if (campo) { apriCerca(campo.getAttribute('data-campo')); return; }
      const chipLinea = evento.target.closest('[data-linea]');
      if (chipLinea) { filtraOrariLinea(chipLinea.getAttribute('data-linea')); return; }
      const opzione = evento.target.closest('[data-opzione]');
      if (opzione) {
        if (opzione.getAttribute('data-opzione') === 'piedi') { mostraPiedi(); return; }
        const indice = parseInt(opzione.getAttribute('data-opzione'), 10);
        if (routing.opzioni && routing.opzioni[indice]) {
          routing.aperto = indice;
          routing.esito = routing.opzioni[indice];
          disegnaTracciato();
          renderPercorso();
        }
        return;
      }
      // Il corpo della riga porta alla linea; il chevron apre il dettaglio
      // della corsa senza perdere l'accesso all'avviso.
      const lineaArrivo = evento.target.closest('[data-linea-arrivo]');
      if (lineaArrivo) {
        apriLinea(lineaArrivo.getAttribute('data-linea-arrivo'));
        return;
      }
      const arrivo = evento.target.closest('[data-arrivo]');
      if (arrivo) {
        const indice = parseInt(arrivo.getAttribute('data-arrivo'), 10);
        live.aperto = live.aperto === indice ? -1 : indice;
        renderLive();
        return;
      }
      const pulsante = evento.target.closest('[data-azione]');
      if (pulsante) {
        const azione = pulsante.getAttribute('data-azione');
        if (azione === 'avvisa') {
          const linea = pulsante.getAttribute('data-avvisa-linea');
          const ora = pulsante.getAttribute('data-avvisa-ora');
          alternaAvvisoArrivo(linea, ora);
          return;
        }
        if (azione === 'spiega-abbonamento') {
          const testo = $('spiega-abbonamento');
          if (testo) {
            testo.hidden = !testo.hidden;
            pulsante.setAttribute('aria-expanded', testo.hidden ? 'false' : 'true');
          }
        }
        if (azione === 'cerca') {
          if (!sel.destinazione) apriCerca(sel.partenza ? 'destinazione' : 'partenza');
          else { routing.chiave = null; impostaSheet('meta'); calcolaPercorso(); }
        }
        if (azione === 'dettagli') impostaSheet('piena');
        if (azione === 'salva-viaggio') salvaViaggio();
        if (azione === 'alternativa-ritardo') ricalcolaPerRitardo();
        if (azione === 'chip-cerca') {
          const testo = pulsante.getAttribute('data-testo') || '';
          apriCerca('destinazione');
          const input = $('cerca-input');
          if (input) {
            input.value = testo;
            aggiornaPulisci();
            apriSuggerimenti('destinazione', testo);
          }
        }
        if (azionePreferito(azione, pulsante)) return;
        if (azione === 'usa-posizione') vaiVicino();
        if (azione === 'altre') {
          alternativeAperte = !alternativeAperte;
          if (alternativeAperte) impostaSheet('piena');
          renderPercorso();
        }
        if (azione === 'inverti') {
          const esito = routing.stato === 'ok' ? routing.esito : null;
          const arrivo = esito ? esito.arrivo + (esito.camminoFinale || 0) : null;
          const partenza = sel.partenza;
          sel.partenza = sel.destinazione;
          sel.destinazione = partenza;
          impostaInput('partenza');
          impostaInput('destinazione');
          aggiornaMarker();
          salvaTratta();
          live.fermata = null;
          live.items = [];
          live.ts = 0;
          live.stato = 'idle';
          routing.chiave = null;
          inquadra();
          if (arrivo != null) {
            // Il ritorno parte dopo l'arrivo previsto, non all'ora della
            // andata: un minuto di margine per scendere e riprendere fiato.
            const base = dataDaGiornoEOra(routing.giorno, '00:00');
            const arrivoMs = base.getTime() + arrivo * 1000;
            const ritorno = new Date(Math.max(Date.now(), arrivoMs) + 60 * 1000);
            routing.modo = 'partenza';
            aggiornaQuando(isoDi(ritorno), due(ritorno.getHours()) + ':' + due(ritorno.getMinutes()), false);
            mostraToast('Ritorno pianificato alle ' + due(ritorno.getHours()) + ':' + due(ritorno.getMinutes()));
          } else {
            calcolaPercorso();
          }
        }
        if (azione === 'orari-partenza') {
          const f = fermataLive();
          if (f) selezionaFermata('partenza', f);
          return;
        }
        if (azione === 'orari-destinazione') {
          const f = fermataLive();
          if (f) selezionaFermata('destinazione', f);
          return;
        }
        if (azione === 'avvia-navigazione') avviaNavigazione();
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
        if (azione === 'prossima-corsa') cercaProssimaCorsa();
        if (azione === 'prova-domani') {
          const domani = new Date();
          domani.setDate(domani.getDate() + 1);
          aggiornaQuando(isoDi(domani), '08:00');
        }
        if (azione === 'aggiorna') caricaLive(true);
        if (azione === 'torna-bus') {
          routing.stato = 'ok';
          routing.piedi = null;
          disegnaPercorso();
        }
        return;
      }
      const voce = evento.target.closest('[data-voce]');
      if (voce) {
        const fermata = fermataPerId(voce.getAttribute('data-voce'));
        if (fermata) selezionaFermata(voce.getAttribute('data-ruolo') || 'destinazione', fermata);
      }
    });

    // ---- Mappa: un tap chiude il pannello espanso e la mini-card ----
    if (mappa) {
      // La pillola della zona segue la mappa, non il dito: si aggiorna quando
      // il trascinamento è finito.
      mappa.on('moveend', aggiornaZonaIndicatore);
      // Una fermata toccata apre la sua mini-card; un tocco sul vuoto chiude.
      // Un raggruppamento toccato si apre: lo zoom sale al punto in cui le
      // fermate che contiene si separano.
      mappa.on('click', (evento) => {
        const gruppi = mappa.getLayer('fermate-cluster')
          ? mappa.queryRenderedFeatures(evento.point, { layers: ['fermate-cluster'] })
          : null;
        if (gruppi && gruppi.length) {
          const gruppo = gruppi[0];
          const sorgente = mappa.getSource('fermate-mappa');
          if (sorgente && sorgente.getClusterExpansionZoom) {
            sorgente.getClusterExpansionZoom(gruppo.properties.cluster_id).then((zoom) => {
              mappa.easeTo({
                center: gruppo.geometry.coordinates,
                zoom: Math.min(18, zoom + 0.2),
                duration: durataMovimento(450)
              });
            }).catch(() => { /* resta lo zoom attuale */ });
          }
          return;
        }
        if (sopprimiTapMappa) { sopprimiTapMappa = false; return; }
        // Il dito non è una croce: si cerca in un quadrato attorno al tocco e
        // si prende la fermata più vicina, non la prima che capita.
        const raggioTocco = 16;
        const area = [
          [evento.point.x - raggioTocco, evento.point.y - raggioTocco],
          [evento.point.x + raggioTocco, evento.point.y + raggioTocco]
        ];
        const colpi = mappa.getLayer('fermate-punti')
          ? mappa.queryRenderedFeatures(area, { layers: ['fermate-punti'] })
          : null;
        if (colpi && colpi.length) {
          let scelta = null;
          let minore = Infinity;
          colpi.forEach((colpo) => {
            const proiettato = mappa.project(colpo.geometry.coordinates);
            const distanza = Math.hypot(proiettato.x - evento.point.x, proiettato.y - evento.point.y);
            if (distanza < minore) { minore = distanza; scelta = colpo; }
          });
          const fermata = scelta ? fermataPerId(scelta.properties.id) : null;
          if (fermata) { apriMini(fermata); return; }
        }
        // Zone tariffarie: un tocco sull'area o sul numero dice che zona è.
        // Le fermate hanno la precedenza, quindi si arriva qui solo sul vuoto.
        const livelliZone = ['zone-etichette', 'zone-etichette-extra', 'zone-urbana-fill', 'zone-fill'].filter((id) => mappa.getLayer(id));
        const zone = livelliZone.length
          ? mappa.queryRenderedFeatures(evento.point, { layers: livelliZone })
          : null;
        if (zone && zone.length) { mostraZonaToccata(zone[0], evento.lngLat); return; }
        spegniZonaScelta();
        chiudiMini();
        if (statoSheet === 'piena' && !navigazione.attiva) impostaSheet('meta');
      });
      mappa.on('mouseenter', 'fermate-punti', () => { mappa.getCanvas().style.cursor = 'pointer'; });
      mappa.on('mouseleave', 'fermate-punti', () => { mappa.getCanvas().style.cursor = ''; });
    }

    // La pillola della zona apre la scheda della zona che sta indicando.
    $('zona-indicatore').addEventListener('click', () => {
      const riga = $('zona-indicatore');
      const zona = riga ? riga.dataset.zona : '';
      if (!zona || !mappa) return;
      const etichetta = Tariffe.etichettaZona(zona);
      const forme = zonePerZona.get(zona) || [];
      mostraZonaToccata(
        forme[0] || { properties: { zona: zona, titolo: etichetta.titolo, nota: etichetta.nota } },
        mappa.getCenter()
      );
    });

    $('nav-fondo').addEventListener('click', (evento) => {
      const pulsante = evento.target.closest('[data-azione]');
      if (!pulsante) return;
      const azione = pulsante.getAttribute('data-azione');
      if (azione === 'ferma-navigazione') fermaNavigazione();
      if (azione === 'centra-navigazione') centraNavigazione();
    });

    // Rotazione e tastiera virtuale cambiano l'altezza utile: il canvas della
    // mappa non segue da solo il contenitore e la scheda resta traslata sulla
    // misura precedente. Si riadatta tutto e si reinquadra il percorso.
    const adattaAllaVista = debounce(() => {
      if (trascinando) return;
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
    window.addEventListener('orientationchange', adattaAllaVista);
    if (window.screen && screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', adattaAllaVista);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (vistaAttiva === 'orari' && Date.now() - live.ts > INTERVALLO_LIVE) caricaLive(true);
      else if (vistaAttiva === 'percorso' && routing.stato !== 'idle') disegnaPercorso();
    });

    // ---- Offline / di nuovo online: una pillola, due secondi ----
    const pillola = $('pill-offline');
    if (pillola) {
      pillola.textContent = 'Offline';
      pillola.hidden = navigator.onLine !== false;
      window.addEventListener('offline', () => {
        pillola.textContent = 'Offline';
        pillola.hidden = false;
      });
      window.addEventListener('online', () => {
        pillola.textContent = 'Di nuovo online';
        pillola.hidden = false;
        clearTimeout(collegaEventi._pillola);
        collegaEventi._pillola = setTimeout(() => {
          pillola.hidden = true;
          pillola.textContent = 'Offline';
        }, 2000);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Avvio
   * ------------------------------------------------------------------ */
  async function avvia() {
    // Tema prima della mappa: così all'apertura non si vede un lampo bianco.
    applicaTema(temaPreferito(), false);
    applicaTesto(testoGrande(), false);
    // Spazio, errori e conteggio degli usi vanno sistemati prima di tutto:
    // la pulizia deve avvenire quando le cache sono ancora scrivibili.
    pulisciCriteriObsoleti();
    pulisciCacheSeNecessario();
    collegaErrori();
    initMappa();
    collegaEventi();
    avviaOrologio();
    gestisciInstallazione();
    registraServiceWorker();
    disposizioneIniziale();
    // Se lo stile della mappa non arriva, il segnaposto non resta per sempre.
    setTimeout(chiudiAttesaMappa, 2500);
    setTimeout(chiudiAvvio, 6000);
    await caricaDati();
    // La home non riapre il viaggio precedente: solo fermate e, se il browser
    // lo consente, la posizione attuale come partenza.
    impostaInput('partenza');
    impostaInput('destinazione');
    const parametri = leggiUrl();
    impostaInput('partenza');
    impostaInput('destinazione');
    if (parametri.get('condiviso') || parametri.get('url') || parametri.get('text') || parametri.get('title')) {
      setTimeout(() => gestisciCondivisione(parametri), 250);
    }
    const vai = parametri.get('vai');
    if (vai === 'casa' || vai === 'lavoro') {
      const scelto = preferitiValidi().find((voce) => voce.slot === vai);
      if (scelto) sel.destinazione = scelto.luogo;
    }
    aggiornaFermateMappa();
    aggiornaMarker();
    mostraVista('percorso');
    renderPercorso();
    if (fermateFisse().length) preparaLinee();
    if (sel.partenza && sel.destinazione) calcolaPercorso();
    impostaSheet(sel.partenza && sel.destinazione ? 'meta' : 'peek');
    if (!sel.partenza) setTimeout(partenzaDallaPosizione, 400);
    const lineaUrl = parametri.get('linea');
    if (lineaUrl) setTimeout(() => apriLinea(lineaUrl, { storia: false }), 350);
    // La mappa è stata creata prima che il layout fosse definitivo: senza un
    // resize il canvas resta vuoto finché la finestra non cambia dimensione.
    if (mappa) mappa.resize();
    if (sel.partenza || sel.destinazione) inquadra(false);
    else if (mappa) mappa.jumpTo({ center: [11.3426, 44.4949], zoom: 13 });
    chiudiAvvio();
    mostraOnboarding();
    avviaAvvisi();
    // I font arrivano dopo il primo disegno: cambiano l'altezza delle righe e
    // il PEEK va rimisurato, altrimenti taglia il bordo della scheda.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (trascinando) return;
        adattaAltezzaSheet();
        applicaTrasformazione(traslazionePer(statoSheet), false);
      });
    }
    // Notifica toccata: apre gli orari della fermata che l'ha generata.
    const fermataAvviso = new URLSearchParams(location.search).get('fermata');
    if (fermataAvviso) {
      const fermata = fermataPerId(fermataAvviso);
      history.replaceState(null, '', location.pathname);
      if (fermata) apriOrari(fermata);
    }
  }

  // Con la tastiera chiusa i campi sono già leggibili senza aprire il pannello:
  // il punto di partenza è il PEEK, non il pannello a metà schermo.
  function disposizioneIniziale() {
    adattaAltezzaSheet();
    applicaTrasformazione(traslazionePer(statoSheet), false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
