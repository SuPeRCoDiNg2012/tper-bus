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

  /**
   * Douglas-Peucker su una linea di coordinate [lon, lat]. Toglie i punti che
   * stanno entro `tolleranza` (in gradi) dalla retta fra i due estremi: la
   * geometria GTFS ha un vertice ogni pochi metri e senza questo le linee
   * sulla mappa sembrano tremolanti. Gli estremi restano sempre.
   */
  function semplifica(punti, tolleranza) {
    if (!Array.isArray(punti) || punti.length < 3) return (punti || []).slice();
    const soglia = Math.max(0, Number(tolleranza) || 0);
    const quadrato = soglia * soglia;
    const distanza = (p, a, b) => {
      let x = a[0];
      let y = a[1];
      let dx = b[0] - x;
      let dy = b[1] - y;
      if (dx !== 0 || dy !== 0) {
        const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p[0] - x;
      dy = p[1] - y;
      return dx * dx + dy * dy;
    };
    const tenuti = [punti[0]];
    const passo = (primo, ultimo) => {
      let massimo = 0;
      let indice = 0;
      for (let i = primo + 1; i < ultimo; i += 1) {
        const d = distanza(punti[i], punti[primo], punti[ultimo]);
        if (d > massimo) { massimo = d; indice = i; }
      }
      if (massimo > quadrato) {
        if (indice - primo > 1) passo(primo, indice);
        tenuti.push(punti[indice]);
        if (ultimo - indice > 1) passo(indice, ultimo);
      }
    };
    passo(0, punti.length - 1);
    tenuti.push(punti[punti.length - 1]);
    return tenuti;
  }

  /**
   * Involucro convesso (monotone chain) di punti [lon, lat]: il poligono più
   * piccolo che contiene tutte le fermate di una zona. Restituisce l'anello
   * senza ripetere il primo punto; con meno di tre punti non è un'area.
   */
  function involucro(punti) {
    const elenco = (punti || [])
      .filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
      .map((p) => [Number(p[0]), Number(p[1])])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const unici = [];
    elenco.forEach((p) => {
      const ultimo = unici[unici.length - 1];
      if (!ultimo || p[0] !== ultimo[0] || p[1] !== ultimo[1]) unici.push(p);
    });
    if (unici.length < 3) return unici;
    // Due catene, bassa e alta: la svolta non deve mai essere oraria.
    const catena = (punti) => {
      const pila = [];
      punti.forEach((p) => {
        while (pila.length >= 2) {
          const a = pila[pila.length - 2];
          const b = pila[pila.length - 1];
          const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          if (cross <= 0) pila.pop();
          else break;
        }
        pila.push(p);
      });
      pila.pop();
      return pila;
    };
    const anello = catena(unici).concat(catena(unici.slice().reverse()));
    const visti = new Set();
    return anello.filter((p) => {
      const chiave = p[0] + ',' + p[1];
      if (visti.has(chiave)) return false;
      visti.add(chiave);
      return true;
    });
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
    timeoutPer: timeoutPer,
    semplifica: semplifica,
    involucro: involucro
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Utilita = API;
})(typeof window !== 'undefined' ? window : globalThis);
