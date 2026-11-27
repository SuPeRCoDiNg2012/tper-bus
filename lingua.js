/* Muovi Bologna — interfaccia in inglese.
 *
 * L'app è scritta in italiano e resta così: qui c'è un dizionario che traduce
 * il testo *visibile* mentre viene mostrato. Non si traducono i nomi propri
 * (fermate, linee, indirizzi), che restano quelli di TPER e OpenStreetMap.
 *
 * Scelta: niente `t('chiave')` in 8.000 righe di app.js. Un MutationObserver
 * prende i testi appena inseriti, così ogni schermata è coperta senza toccare
 * il codice che la disegna. Quello che non è nel dizionario resta in italiano:
 * meglio una riga non tradotta che una riga rotta.
 *
 * Cambio lingua = ricaricamento: le stringhe nascono in italiano e non c'è un
 * modo sicuro di tornare indietro modificando il DOM già tradotto.
 */
(function (globale) {
  'use strict';

  const K_LINGUA = 'tperzc_lingua_v1';

  // Chiavi = testo italiano esatto (senza spazi ai bordi).
  const DIZIONARIO = {
    // --- Avvio e onboarding ---
    'Dove vai?': 'Where to?',
    'Fermate, percorso e prezzo.': 'Stops, route and fare.',
    'Inizia': 'Start',
    'Avanti': 'Next',
    'Indietro': 'Back',
    'Annulla': 'Cancel',
    'Salva': 'Save',
    'Riprova': 'Try again',
    'Aggiorna': 'Refresh',

    // --- Campi e ricerca ---
    'Partenza': 'From',
    'Destinazione': 'To',
    'Da dove parti?': 'Where from?',
    'Cerca una fermata o un indirizzo': 'Search a stop or address',
    'Fermata, luogo o indirizzo': 'Stop, place or address',
    'Fermate, luoghi e indirizzi suggeriti': 'Suggested stops, places and addresses',
    'Cerca fermata, luogo o indirizzo': 'Search stop, place or address',
    'Scambia partenza e destinazione': 'Swap start and destination',
    'Cancella il testo': 'Clear text',
    'Chiudi la ricerca': 'Close search',
    'Recenti': 'Recent',
    'Fermate vicine': 'Nearby stops',
    'Nessun risultato.': 'No results.',
    'Nessun risultato': 'No results',

    // --- Pannello percorso ---
    'Percorso': 'Route',
    'Orari': 'Times',
    'Linea': 'Line',
    'Viaggio': 'Trip',
    'Altre soluzioni': 'Other options',
    'Soluzione': 'Option',
    'Cambio': 'Change',
    'Cambi': 'Changes',
    'Andata': 'Outbound',
    'Ritorno': 'Return',
    'Avvia': 'Start',
    'Termina': 'End',
    'Vai qui': 'Go here',
    'Parti da qui': 'Start here',
    'A piedi': 'Walk',
    'Bus': 'Bus',
    'Treno': 'Train',
    'People mover': 'People mover',
    'Nessun passaggio.': 'No departures.',
    'Tocca una fermata sulla mappa.': 'Tap a stop on the map.',
    'Tempo reale non disponibile.': 'Live data unavailable.',
    'Qui passano solo treni: valgono gli orari programmati.': 'Trains only: timetables apply.',
    'Aggiornato ora': 'Updated just now',
    'solo orari': 'timetable only',
    'Calcolatore TPER': 'TPER fare calculator',
    'Biglietto': 'Ticket',
    'Biglietti': 'Tickets',
    'Abbonamento': 'Pass',
    'Costo': 'Cost',
    'Zona': 'Zone',
    'Zone': 'Zones',
    'Prezzo': 'Price',
    'Durata': 'Duration',
    'Valido': 'Valid',
    'Salva casa e lavoro': 'Save home and work',
    'Casa': 'Home',
    'Lavoro': 'Work',
    'Mi trovo qui': 'I am here',
    'La mia posizione': 'My location',
    'Centra la mappa sulla mia posizione': 'Center the map on me',
    'Inquadra il percorso': 'Fit the route',
    'Chiudi': 'Close',
    'Fermata selezionata': 'Selected stop',
    'Segnala un errore': 'Report an issue',
    'Segnala': 'Report',
    'Errore di orario o percorso': 'Wrong time or route',
    'Chiudi': 'Close',
    'Espandi o riduci il pannello': 'Expand or collapse the panel',

    // --- Menu ---
    'Impostazioni': 'Settings',
    'Apri il menu': 'Open menu',
    'Chiudi il menu': 'Close menu',
    'Notifiche': 'Notifications',
    'Attiva': 'Turn on',
    'Attive': 'On',
    'Bloccate': 'Blocked',
    'Non supportate': 'Not supported',
    'Trova': 'Find',
    'Tema scuro': 'Dark theme',
    'Zone tariffarie': 'Fare zones',
    'Mostra tutte le linee': 'Show all lines',
    'Abbonamento urbano': 'Urban pass',
    'Notifiche ad app chiusa': 'Notifications with the app closed',
    'Percorso attuale': 'Current route',
    'Viaggi salvati': 'Saved trips',
    'Preferiti': 'Favourites',
    'Nessun percorso aperto.': 'No route open.',
    'Informazioni e fonti dati': 'About and data sources',
    'Aggiorna app': 'Update app',
    'Installa app': 'Install app',
    'English': 'English',
    'Italiano': 'Italiano',
    'App non ufficiale TPER. Orari e prezzi indicativi: verifica su tper.it.':
      'Unofficial TPER app. Times and fares are indicative: check tper.it.',
    'Arrivano solo con l\'app aperta o in background recente: ad app chiusa del tutto non ne ricevi, perché non c\'è un server push.':
      'They arrive only while the app is open or recently in the background: with the app fully closed you get none, because there is no push server.',
    'Su iPhone arrivano solo dopo «Aggiungi alla Home»: tocca Condividi in Safari e scegli quella voce, poi riapri l\'app.':
      'On iPhone they only arrive after «Add to Home Screen»: tap Share in Safari, choose that item, then reopen the app.',
    'Un promemoria solo per l\'ultima corsa di oggi dalle fermate con gli avvisi accesi: lo spedisce un Worker, non il telefono.':
      'One reminder only, for today\'s last bus from stops with alerts on: a Worker sends it, not the phone.',

    // --- Notifiche ---
    'Ultima corsa': 'Last bus',
    'Ultima corsa adesso': 'Last bus now',
    'Notifiche attive anche ad app chiusa': 'Notifications on, even with the app closed',
    'Notifiche ad app chiusa disattivate': 'Notifications with the app closed turned off',
    'Notifiche bloccate: riattivale dalle impostazioni del sito':
      'Notifications blocked: re-enable them in the site settings',
    'Questo browser non supporta le notifiche': 'This browser does not support notifications',
    'Notifiche non attivate': 'Notifications not enabled',

    // --- Errori e stati ---
    'Offline': 'Offline',
    'Errore': 'Error',
    'Nessun dato': 'No data',
    'Caricamento…': 'Loading…',
    'Cerco i passaggi…': 'Looking up departures…',
    'Fuori servizio': 'Not running',
    'Ultima corsa della giornata': 'Last bus of the day',
    'Prima corsa': 'First bus',
    'Passato': 'Departed',
    'In arrivo': 'Arriving',
    'Adesso': 'Now',
    'min': 'min',
    'ora': 'now',
    'metri': 'm',
    'chilometri': 'km'
  };

  // Sostituzioni per i testi composti: «Palina 100 · Zona 500 · 29».
  const MODELLI = [
    [/\bPalina (\S+)/g, 'Stop $1'],
    [/\bZona ([0-9A-Za-z]+)/g, 'Zone $1'],
    [/\bzona ([0-9A-Za-z]+)/g, 'zone $1'],
    [/^Indirizzo\b/g, 'Address'],
    [/\bLinea (\S+)/g, 'Line $1'],
    [/^Bus (\S+) tra (\d+) min$/, 'Bus $1 in $2 min'],
    [/^Ultima corsa tra (\d+) min$/, 'Last bus in $1 min'],
    [/^Ultima corsa alle (.+)$/, 'Last bus at $1'],
    [/^Bus (\S+) alle (.+)$/, 'Bus $1 at $2'],
    [/(\d+) min a piedi/, '$1 min on foot']
  ];

  function traduci(testo) {
    if (typeof testo !== 'string' || !testo.trim()) return testo;
    const chiave = testo.trim();
    if (Object.prototype.hasOwnProperty.call(DIZIONARIO, chiave)) {
      const inizio = testo.indexOf(chiave);
      return testo.slice(0, inizio) + DIZIONARIO[chiave] + testo.slice(inizio + chiave.length);
    }
    // I modelli si applicano uno dopo l'altro: una riga come
    // «Palina 100 · Zona 500» contiene due cose da tradurre, non una.
    let risultato = chiave;
    let toccato = false;
    MODELLI.forEach((voce) => {
      const modello = voce[0];
      modello.lastIndex = 0;
      if (!modello.test(risultato)) return;
      modello.lastIndex = 0;
      risultato = risultato.replace(modello, voce[1]);
      toccato = true;
    });
    return toccato ? risultato : testo;
  }

  const ATTRIBUTI = ['placeholder', 'aria-label', 'title', 'alt'];

  function traduciElemento(elemento) {
    if (elemento.nodeType === 3) {
      const nuovo = traduci(elemento.nodeValue);
      if (nuovo !== elemento.nodeValue) elemento.nodeValue = nuovo;
      return;
    }
    if (elemento.nodeType !== 1) return;
    ATTRIBUTI.forEach((nome) => {
      const valore = elemento.getAttribute(nome);
      if (!valore) return;
      const nuovo = traduci(valore);
      if (nuovo !== valore) elemento.setAttribute(nome, nuovo);
    });
    const figli = elemento.childNodes;
    for (let i = 0; i < figli.length; i += 1) traduciAlbero(figli[i]);
  }

  function traduciAlbero(nodo) {
    if (!nodo) return;
    // L'etichetta della lingua non si traduce: è il nome della lingua stessa.
    if (nodo.nodeType === 1 && nodo.id === 'menu-lingua-riga') return;
    traduciElemento(nodo);
  }

  let osservatore = null;

  function osserva() {
    if (osservatore || typeof MutationObserver === 'undefined' || !document.body) return;
    osservatore = new MutationObserver((voci) => {
      voci.forEach((voce) => {
        if (voce.type === 'characterData') {
          traduciElemento(voce.target);
          return;
        }
        voce.addedNodes.forEach((nodo) => traduciAlbero(nodo));
      });
    });
    osservatore.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function lingua() {
    try {
      const salvata = localStorage.getItem(K_LINGUA);
      if (salvata === 'en' || salvata === 'it') return salvata;
    } catch (errore) { /* storage negato: si resta in italiano */ }
    // Prima apertura: segue la lingua del telefono solo se è inglese.
    const nav = (typeof navigator !== 'undefined' && (navigator.language || '')) || '';
    return /^en\b/i.test(nav) ? 'en' : 'it';
  }

  function applica(scelta) {
    document.documentElement.setAttribute('lang', scelta === 'en' ? 'en' : 'it');
  }

  function imposta(scelta) {
    try {
      localStorage.setItem(K_LINGUA, scelta === 'en' ? 'en' : 'it');
    } catch (errore) { /* niente storage: vale per questa sessione */ }
    // Le stringhe nascono in italiano: il modo sicuro per tornare indietro è
    // ricaricare, non tradurre al contrario un DOM già tradotto.
    if (typeof location !== 'undefined') location.reload();
  }

  function avvia() {
    const scelta = lingua();
    applica(scelta);
    // L'interruttore esiste in entrambe le lingue: senza, dall'italiano non
    // si potrebbe mai passare all'inglese.
    const riga = document.getElementById('menu-lingua');
    if (riga) {
      riga.checked = scelta === 'en';
      riga.addEventListener('change', () => imposta(riga.checked ? 'en' : 'it'));
    }
    if (scelta !== 'en') return;
    traduciAlbero(document.body);
    osserva();
  }

  const API = {
    lingua: lingua,
    imposta: imposta,
    traduci: traduci,
    dizionario: DIZIONARIO
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else {
    globale.Lingua = API;
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
      else avvia();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
