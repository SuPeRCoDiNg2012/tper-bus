/* Muovi Bologna — regole del tracciato sulla mappa
 * Logica pura, senza DOM: dice quali tratte della mappa vanno agganciate alle
 * strade con OSRM. I tratti ferroviari non ci passano mai: il binario non è
 * una strada e il map matching restituirebbe una geometria sbagliata.
 */
(function (globale) {
  'use strict';

  // route_type GTFS: 1 = metropolitana, 2 = treno (le stesse soglie usate
  // altrove nell'app per distinguere una corsa ferroviaria da un bus).
  function eFerroviaria(tappa) {
    return !!tappa && (tappa.tipo === 1 || tappa.tipo === 2);
  }

  // Si aggancia solo una tratta con geometria ufficiale e abbastanza fitta:
  // due soli punti non hanno niente da far combaciare con le strade.
  function agganciabile(tappa, geometria) {
    if (!tappa || !geometria) return false;
    if (!geometria.ufficiale) return false;
    if (!(tappa.forma >= 0)) return false;
    if (eFerroviaria(tappa)) return false;
    return Array.isArray(geometria.punti) && geometria.punti.length >= 3;
  }

  /**
   * Una voce per ogni tappa: i punti da passare a OSRM, oppure null.
   * `geometrie` è l'elenco prodotto da geometrieUfficiali() in app.js.
   */
  function richiesteSnap(tappe, geometrie) {
    if (!Array.isArray(tappe)) return [];
    return tappe.map((tappa, indice) => {
      const geometria = geometrie ? geometrie[indice] : null;
      return agganciabile(tappa, geometria) ? geometria.punti : null;
    });
  }

  const API = {
    eFerroviaria: eFerroviaria,
    agganciabile: agganciabile,
    richiesteSnap: richiesteSnap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Tracciato = API;
})(typeof window !== 'undefined' ? window : globalThis);
