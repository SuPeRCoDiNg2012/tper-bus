/* Muovi Bologna — stima zone e prezzo
 * Logica pura, senza DOM: la usa l'app e la verifica tests/tariffe.test.js.
 */
(function (globale) {
  'use strict';

  const ZONE_URBANE = new Set(['500', '501', '502', '503', '504', '505', '506', '507', '508', '509']);
  const TARIFFE_BUS = { 1: 2.30, 2: 2.90, 3: 3.70, 4: 4.50 };
  const TARIFFE_TRENO = { 1: 2.30, 2: 3.10, 3: 3.90 };

  function isZonaUrbana(zona) {
    return ZONE_URBANE.has(String(zona));
  }

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

  const API = {
    ZONE_URBANE: ZONE_URBANE,
    TARIFFE_BUS: TARIFFE_BUS,
    TARIFFE_TRENO: TARIFFE_TRENO,
    isZonaUrbana: isZonaUrbana,
    avvisoConfine: avvisoConfine,
    calcola: calcola
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Tariffe = API;
})(typeof window !== 'undefined' ? window : globalThis);
