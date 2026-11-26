/* Muovi Bologna — stima zone e prezzo
 * Logica pura, senza DOM: la usa l'app e la verifica tests/tariffe.test.js.
 */
(function (globale) {
  'use strict';

  const ZONE_URBANE = new Set(['500', '501', '502', '503', '504', '505', '506', '507', '508', '509']);
  const TARIFFE_BUS = { 1: 2.30, 2: 2.90, 3: 3.70, 4: 4.50, 5: 5.40 };

  /* Tariffa regionale Trenitalia Tper, 2ª classe: il prezzo dipende dai km, a
   * scaglioni (tariffa ordinaria regionale valida dal 17/10/2026). Bologna–Imola
   * sono 34 km e costano 4,90 €, non i 3,10 € "a due zone" usati prima.
   * Le linee FER (Bologna–Portomaggiore, Bologna–Vignola) fanno eccezione: lì
   * valgono i titoli a zone, come i bus. */
  const SCAGLIONI_TRENO = [
    [10, 2.90], [20, 3.40], [30, 4.00], [40, 4.90], [50, 5.40], [60, 5.70],
    [70, 6.40], [80, 7.20], [90, 7.70], [100, 8.20], [125, 10.00],
    [150, 11.50], [175, 13.00], [200, 14.70]
  ];

  function isZonaUrbana(zona) {
    return ZONE_URBANE.has(String(zona));
  }

  /** Nome leggibile di una zona tariffaria: 500 urbana, 501–509 neutre, resto extraurbane. */
  function etichettaZona(zona) {
    const z = String(zona == null ? '' : zona);
    if (!z) return { titolo: 'Zona non nota', nota: '' };
    if (z === '500') return { titolo: 'Zona 500', nota: 'Area urbana di Bologna · 1 zona' };
    if (ZONE_URBANE.has(z)) return { titolo: 'Zona ' + z, nota: 'Zona neutra dell’area urbana (cuscinetto)' };
    return { titolo: 'Zona ' + z, nota: 'Extraurbana' };
  }

  /** Distanza in linea d'aria fra due punti; null se manca una coordinata. */
  function distanzaKm(a, b) {
    if (!a || !b) return null;
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
    const raggio = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const seno = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * raggio * Math.asin(Math.min(1, Math.sqrt(seno)));
  }

  /** Prezzo del biglietto regionale per una distanza in km (null oltre 200 km). */
  function prezzoTreno(km) {
    if (km == null || !isFinite(km) || km <= 0) return null;
    for (let i = 0; i < SCAGLIONI_TRENO.length; i += 1) {
      if (km <= SCAGLIONI_TRENO[i][0]) return SCAGLIONI_TRENO[i][1];
    }
    return null;
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

  /**
   * @param opzioni { treno } — true se l'itinerario scelto usa un treno.
   */
  function calcola(partenza, destinazione, conAbbonamento, opzioni) {
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

    // Treno: il prezzo segue i km, non le zone. È il caso più frequente per
    // Bologna ↔ Imola, Pianoro, Porretta, dove la tariffa a zone sbagliava di
    // parecchio (Imola: 3,10 € a zone contro 4,90 € reali).
    // Sui suburbani FER (fer) valgono i titoli a zone, come sui bus.
    const conTreno = !!(opzioni && opzioni.treno && !opzioni.fer);
    const km = conTreno ? distanzaKm(partenza, destinazione) : null;
    const prezzoTrenoKm = prezzoTreno(km);
    if (prezzoTrenoKm != null) {
      const nota = Math.round(km) + ' km · tariffa regionale 2ª classe';
      return {
        badge: 'arancio',
        titolo: 'Biglietto regionale necessario',
        prezzo: prezzoTrenoKm,
        prezzoNota: nota,
        avviso: conAbbonamento
          ? 'L\'abbonamento urbano vale tra le stazioni dell\'area urbana di Bologna: per uscire serve il biglietto regionale fino a destinazione.'
          : null
      };
    }

    const extraurbana = pUrbana ? destinazione : partenza;

    if (conAbbonamento) {
      return {
        badge: 'arancio',
        titolo: 'Integrazione extraurbana necessaria',
        prezzo: TARIFFE_BUS[1],
        prezzoNota: '1 zona extraurbana oltre all\'abbonamento',
        avviso: avvisoConfine(extraurbana)
      };
    }

    return {
      badge: 'rosso',
      titolo: 'Biglietto a 2 zone necessario',
      prezzo: TARIFFE_BUS[2],
      prezzoNota: '2 zone',
      avviso: null
    };
  }

  const API = {
    ZONE_URBANE: ZONE_URBANE,
    TARIFFE_BUS: TARIFFE_BUS,
    SCAGLIONI_TRENO: SCAGLIONI_TRENO,
    isZonaUrbana: isZonaUrbana,
    etichettaZona: etichettaZona,
    distanzaKm: distanzaKm,
    prezzoTreno: prezzoTreno,
    avvisoConfine: avvisoConfine,
    calcola: calcola
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Tariffe = API;
})(typeof window !== 'undefined' ? window : globalThis);
