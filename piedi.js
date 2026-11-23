/* Muovi Bologna — contratti del routing pedonale
 * Le coordinate dell'app sono [lon, lat], lo stesso ordine richiesto da OSRM.
 * Questo modulo è puro, così l'ordine delle coordinate è coperto dai test.
 */
(function (globale) {
  'use strict';

  const URL_PIEDI = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

  function chiave(da, a) {
    return da[0].toFixed(5) + ',' + da[1].toFixed(5) + '|' + a[0].toFixed(5) + ',' + a[1].toFixed(5);
  }

  function url(da, a) {
    return URL_PIEDI + da[0].toFixed(5) + ',' + da[1].toFixed(5) + ';' +
      a[0].toFixed(5) + ',' + a[1].toFixed(5);
  }

  function geometriaRisposta(dati) {
    const coordinate = dati && dati.code === 'Ok' && dati.routes && dati.routes[0] &&
      dati.routes[0].geometry && dati.routes[0].geometry.coordinates;
    return Array.isArray(coordinate) && coordinate.length > 1 ? coordinate : null;
  }

  // Lunghezza in metri della polilinea pedonale, con la stessa formula usata
  // per le distanze in linea d'aria. Serve a scartare geometrie corrotte o
  // assurde (per esempio un percorso pedonale di decine di chilometri).
  function lunghezza(coordinate) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return 0;
    const R = 6371000;
    const rad = Math.PI / 180;
    let totale = 0;
    for (let i = 1; i < coordinate.length; i += 1) {
      const a = coordinate[i - 1];
      const b = coordinate[i];
      if (!a || !b) continue;
      const dLat = (b[1] - a[1]) * rad;
      const dLon = (b[0] - a[0]) * rad;
      const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      totale += 2 * R * Math.asin(Math.sqrt(s));
    }
    return totale;
  }

  function valida(coordinate, massimoMetri) {
    return Array.isArray(coordinate) && coordinate.length > 1 &&
      (!massimoMetri || lunghezza(coordinate) <= massimoMetri);
  }

  const API = {
    URL_PIEDI: URL_PIEDI,
    chiave: chiave,
    url: url,
    geometriaRisposta: geometriaRisposta,
    lunghezza: lunghezza,
    valida: valida
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Piedi = API;
})(typeof window !== 'undefined' ? window : globalThis);
