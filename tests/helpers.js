'use strict';

const path = require('path');

/**
 * Carica routing.js da zero e gli passa i dati tramite un fetch finto.
 * Ogni test parte da uno stato pulito: i moduli tengono dati e cache in memoria.
 */
async function caricaRouting(orari, tracciati) {
  const percorso = path.join(__dirname, '..', 'routing.js');
  delete require.cache[require.resolve(percorso)];
  const routing = require(percorso);
  global.fetch = async (url) => {
    const indirizzo = String(url);
    const dati = tracciati && indirizzo.includes('tracciati') ? tracciati : orari;
    return { ok: true, json: async () => dati };
  };
  await routing.carica('', 'orari-test');
  if (tracciati) await routing.caricaTracciati('', 'tracciati-test');
  return routing;
}

/** Polyline con precisione 1e5, stesso formato di scripts/preprocess-orari.js. */
function polilinea(punti) {
  let uscita = '';
  let latPrec = 0;
  let lonPrec = 0;
  const coppia = (valore) => {
    let v = valore < 0 ? ~(valore << 1) : valore << 1;
    let testo = '';
    while (v >= 0x20) {
      testo += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return testo + String.fromCharCode(v + 63);
  };
  punti.forEach((punto) => {
    const lat = Math.round(punto[0] * 1e5);
    const lon = Math.round(punto[1] * 1e5);
    uscita += coppia(lat - latPrec) + coppia(lon - lonPrec);
    latPrec = lat;
    lonPrec = lon;
  });
  return uscita;
}

module.exports = { caricaRouting, polilinea };
