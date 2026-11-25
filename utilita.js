/* Muovi Bologna — rifiniture trasversali
 * Logica pura, senza DOM: la usa l'app e la verifica tests/utilita.test.js.
 */
(function (globale) {
  'use strict';

  /* Timeout per tipo di chiamata: un file di orari da 280 KB non può avere lo
   * stesso tempo di un elenco di fermate, e Nominatim va lasciato libero. */
  const TIMEOUT = {
    fermate: 10000,
    orari: 15000,
    nominatim: 5000,
    osrm: 8000,
    hellobus: 9000
  };

  /* Cache locali rigenerabili: si possono buttare senza perdere nulla di
   * scritto dall'utente (recenti, tratta, abbonamento restano). */
  const CACHE_RIGENERABILI = ['tperzc_snap_v4', 'tperzc_piedi_v4', 'tperzc_storico_ritardi_v2'];
  const SOGLIA_CACHE = 3.5 * 1024 * 1024;

  function canale(valore) {
    const v = valore / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminanza(hex) {
    const pulito = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(pulito)) return null;
    const r = parseInt(pulito.slice(0, 2), 16);
    const g = parseInt(pulito.slice(2, 4), 16);
    const b = parseInt(pulito.slice(4, 6), 16);
    return 0.2126 * canale(r) + 0.7152 * canale(g) + 0.0722 * canale(b);
  }

  /** Rapporto di contrasto WCAG fra due colori esadecimali (1–21). */
  function contrasto(a, b) {
    const la = luminanza(a);
    const lb = luminanza(b);
    if (la == null || lb == null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * Testo leggibile sopra un badge colorato: si sceglie fra bianco e nero il
   * colore con il contrasto migliore, così un giallo o un verde chiaro non
   * restano con testo bianco illeggibile.
   */
  function testoSuColore(sfondo, preferito) {
    if (contrasto(sfondo, '#FFFFFF') == null) return preferito || '#FFFFFF';
    const bianco = contrasto(sfondo, '#FFFFFF');
    const nero = contrasto(sfondo, '#1A1A1A');
    if (bianco >= 4.5 || nero >= 4.5) return bianco >= nero ? '#FFFFFF' : '#1A1A1A';
    return bianco >= nero ? '#FFFFFF' : '#1A1A1A';
  }

  /**
   * Chiavi da svuotare quando il localStorage è troppo pieno. `misure` è una
   * mappa chiave → byte stimati. Si svuota solo il necessario, partendo dalle
   * cache rigenerabili, così i dati dell'utente restano.
   */
  function cacheDaSvuotare(misure, soglia) {
    const limite = typeof soglia === 'number' ? soglia : SOGLIA_CACHE;
    const mappa = misure || {};
    let totale = 0;
    Object.keys(mappa).forEach((chiave) => { totale += Number(mappa[chiave]) || 0; });
    const svuotate = [];
    CACHE_RIGENERABILI.forEach((chiave) => {
      if (totale <= limite) return;
      if (mappa[chiave]) {
        totale -= Number(mappa[chiave]) || 0;
        svuotate.push(chiave);
      }
    });
    return svuotate;
  }

  /** L'invito all'installazione arriva al terzo uso e non si ripete. */
  function deveMostrareInvito(uso, visto, installata) {
    if (installata) return false;
    if (visto) return false;
    return Number(uso || 0) >= 3;
  }

  function timeoutPer(tipo) {
    return TIMEOUT[tipo] || TIMEOUT.fermate;
  }

  const API = {
    TIMEOUT: TIMEOUT,
    CACHE_RIGENERABILI: CACHE_RIGENERABILI,
    SOGLIA_CACHE: SOGLIA_CACHE,
    luminanza: luminanza,
    contrasto: contrasto,
    testoSuColore: testoSuColore,
    cacheDaSvuotare: cacheDaSvuotare,
    deveMostrareInvito: deveMostrareInvito,
    timeoutPer: timeoutPer
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Utilita = API;
})(typeof window !== 'undefined' ? window : globalThis);
