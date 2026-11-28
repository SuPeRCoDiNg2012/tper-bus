/* Muovi Bologna — posizione stimata dei bus
 * Puro, senza DOM e senza rete: dato il tracciato di una corsa e gli orari
 * delle sue fermate, dice dove si trova il bus a un certo istante. La stima
 * non inventa un GPS che HelloBus non fornisce: segue la forma della linea e
 * la tabella fermata→vertice calcolata in preprocessing.
 */
(function (globale) {
  'use strict';

  const RAGGIO_TERRA = 6371000;

  /** Distanza in metri tra due punti [lat, lon]. */
  function distanzaMetri(a, b) {
    const lat = (a[0] + b[0]) * Math.PI / 360;
    const dlat = (b[0] - a[0]) * Math.PI / 180;
    const dlon = (b[1] - a[1]) * Math.PI / 180;
    const x = dlon * Math.cos(lat);
    return Math.sqrt(x * x + dlat * dlat) * RAGGIO_TERRA;
  }

  /**
   * Vertice del tracciato per ogni fermata della corsa.
   * La tabella arriva come coppie [fermata, vertice, …]; si segue l'ordine
   * della corsa senza tornare indietro, così le linee ad anello prendono
   * l'occorrenza giusta e non sempre la prima.
   */
  function vertici(tabella, fermate) {
    const risultato = [];
    if (!tabella || !tabella.length || !fermate) return risultato;
    let ultimo = 0;
    // Il cursore avanza nella tabella: quando la stessa fermata compare due
    // volte nella corsa (anello o ritorno) la seconda prende l'occorrenza
    // dopo, non di nuovo la prima.
    let cursore = 0;
    for (let i = 0; i < fermate.length; i += 1) {
      const fermata = fermate[i];
      let vertice = -1;
      let prossimo = cursore;
      for (let k = cursore; k < tabella.length; k += 2) {
        if (tabella[k] !== fermata) continue;
        if (tabella[k + 1] < ultimo) continue;
        vertice = tabella[k + 1];
        prossimo = k + 2;
        break;
      }
      if (vertice < 0) continue;
      ultimo = vertice;
      cursore = prossimo;
      risultato[i] = vertice;
    }
    return risultato;
  }

  /**
   * Dove si trova il bus all'istante dato (secondi della giornata della corsa).
   * Restituisce { lat, lon, fermataDa, frazione } oppure null quando la corsa
   * non è ancora partita, è già finita o la geometria non copre quel tratto:
   * meglio nessun puntino che un puntino nel posto sbagliato.
   */
  function stimaPosizione(opzioni) {
    const o = opzioni || {};
    const punti = o.punti;
    const orari = o.orari;
    const fermate = o.fermate;
    const istante = Number(o.istante);
    if (!punti || punti.length < 2) return null;
    if (!orari || !fermate || !isFinite(istante)) return null;
    if (orari.length !== fermate.length || orari.length < 2) return null;
    if (istante <= orari[0] || istante >= orari[orari.length - 1]) return null;

    let segmento = -1;
    for (let i = 0; i < orari.length - 1; i += 1) {
      if (istante >= orari[i] && istante <= orari[i + 1]) { segmento = i; break; }
    }
    if (segmento < 0) return null;

    const tabella = vertici(o.posizioni, fermate);
    const da = tabella[segmento];
    const a = tabella[segmento + 1];
    if (da == null || a == null || a <= da) return null;
    if (da < 0 || a >= punti.length) return null;

    const durata = orari[segmento + 1] - orari[segmento];
    const frazione = durata > 0
      ? Math.min(1, Math.max(0, (istante - orari[segmento]) / durata))
      : 1;

    let totale = 0;
    const tratti = [];
    for (let i = da; i < a; i += 1) {
      const metri = distanzaMetri(punti[i], punti[i + 1]);
      tratti.push(metri);
      totale += metri;
    }
    if (!(totale > 0)) {
      const punto = punti[da];
      return { lat: punto[0], lon: punto[1], fermataDa: segmento, frazione: frazione };
    }
    let resto = totale * frazione;
    for (let i = 0; i < tratti.length; i += 1) {
      if (resto <= tratti[i] || i === tratti.length - 1) {
        const parte = tratti[i] > 0 ? Math.min(1, resto / tratti[i]) : 1;
        const p = punti[da + i];
        const q = punti[da + i + 1];
        return {
          lat: p[0] + (q[0] - p[0]) * parte,
          lon: p[1] + (q[1] - p[1]) * parte,
          fermataDa: segmento,
          frazione: frazione
        };
      }
      resto -= tratti[i];
    }
    return null;
  }

  const API = {
    stimaPosizione: stimaPosizione,
    vertici: vertici,
    distanzaMetri: distanzaMetri
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Posizioni = API;
})(typeof window !== 'undefined' ? window : globalThis);
