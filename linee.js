/* Muovi Bologna — indice delle linee
 * Puro, senza DOM: legge le corse compatte di data/orari.json e le raggruppa
 * per linea e per sequenza di fermate. La app lo usa per la ricerca «dove passa
 * il 20», per l'elenco delle fermate e per l'ultima corsa della giornata.
 * Le corse sono [linea, servizio, fermata0, ora0, Δfermata, Δora, …] con le
 * fermate come indici nell'array `fermate` degli orari.
 */
(function (globale) {
  'use strict';

  function normalizza(testo) {
    return String(testo == null ? '' : testo)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\blinea\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // L'indice si costruisce una volta sola: gli orari non cambiano mentre l'app
  // è aperta. Se arrivano dati nuovi (ricaricamento) si ricostruisce.
  let cache = null;
  let fonte = null;

  /**
   * @param orari oggetto di data/orari.json
   * @returns Map nome linea → { nome, tipo, gruppi: Map firma → gruppo }
   *   gruppo = { fermate: [id], capolinea, offsets: [secondi], corsa, corse }
   */
  function indice(orari) {
    if (!orari) return new Map();
    if (fonte === orari && cache) return cache;
    const linee = new Map();
    const fermate = orari.fermate || [];
    const nomi = orari.linee || [];
    (orari.corse || []).forEach((voce, indiceCorsa) => {
      const info = nomi[voce[0]] || ['—', 3];
      const nome = String(info[0]).toUpperCase();
      const tipo = info[1];
      const fermateCorsa = [voce[2]];
      const tempi = [voce[3]];
      for (let j = 4; j < voce.length; j += 2) {
        fermateCorsa.push(fermateCorsa[fermateCorsa.length - 1] + voce[j]);
        tempi.push(tempi[tempi.length - 1] + voce[j + 1]);
      }
      if (fermateCorsa.length < 2) return;
      const ids = fermateCorsa.map((indice) => fermate[indice]);
      if (ids.some((id) => id == null)) return;
      const firma = ids.join('|');
      let linea = linee.get(nome);
      if (!linea) {
        linea = { nome: nome, tipo: tipo, gruppi: new Map() };
        linee.set(nome, linea);
      }
      let gruppo = linea.gruppi.get(firma);
      if (!gruppo) {
        gruppo = {
          fermate: ids,
          capolinea: ids[ids.length - 1],
          offsets: tempi.map((tempo) => tempo - tempi[0]),
          corsa: indiceCorsa,
          corse: []
        };
        linea.gruppi.set(firma, gruppo);
      }
      gruppo.corse.push({ servizio: voce[1], inizio: tempi[0], corsa: indiceCorsa });
    });
    cache = linee;
    fonte = orari;
    return linee;
  }

  function lineaDi(linee, nome) {
    if (!linee) return null;
    return linee.get(String(nome == null ? '' : nome).toUpperCase()) || null;
  }

  // Una voce per capolinea: è quello che l'utente chiama «direzione».
  function versi(linea) {
    if (!linea) return [];
    const perCapolinea = new Map();
    linea.gruppi.forEach((gruppo) => {
      const voce = perCapolinea.get(gruppo.capolinea);
      if (!voce) {
        perCapolinea.set(gruppo.capolinea, { capolinea: gruppo.capolinea, gruppi: [gruppo], corse: gruppo.corse.length });
      } else {
        voce.gruppi.push(gruppo);
        voce.corse += gruppo.corse.length;
      }
    });
    return Array.from(perCapolinea.values()).sort((a, b) => b.corse - a.corse);
  }

  function stessoCapolinea(a, b) {
    return a != null && b != null && String(a) === String(b);
  }

  function gruppoPrincipale(linea, capolinea) {
    if (!linea) return null;
    let migliore = null;
    linea.gruppi.forEach((gruppo) => {
      if (capolinea && !stessoCapolinea(gruppo.capolinea, capolinea)) return;
      if (!migliore || gruppo.corse.length > migliore.corse.length) migliore = gruppo;
    });
    return migliore;
  }

  function fermateVerso(linea, capolinea) {
    const gruppo = gruppoPrincipale(linea, capolinea);
    return gruppo ? gruppo.fermate.slice() : [];
  }

  function corsaVerso(linea, capolinea) {
    const gruppo = gruppoPrincipale(linea, capolinea);
    return gruppo ? gruppo.corsa : null;
  }

  function attivo(servizio, attive) {
    if (!attive) return true;
    if (typeof attive.has === 'function') return attive.has(servizio);
    return attive.indexOf(servizio) >= 0;
  }

  /**
   * Partenze attive di una linea, in ordine di orario.
   * `indiceFermata` è la posizione nell'elenco delle fermate del gruppo; senza,
   * si guarda la prima fermata (la partenza dal capolinea di origine).
   */
  function partenze(linea, capolinea, attive, indiceFermata) {
    if (!linea) return [];
    const elenco = [];
    linea.gruppi.forEach((gruppo) => {
      if (capolinea && !stessoCapolinea(gruppo.capolinea, capolinea)) return;
      const k = indiceFermata == null ? 0 : indiceFermata;
      // All'ultima fermata il bus arriva: non è una partenza.
      if (k < 0 || k >= gruppo.fermate.length - 1) return;
      gruppo.corse.forEach((corsa) => {
        if (!attivo(corsa.servizio, attive)) return;
        elenco.push({ secondi: corsa.inizio + gruppo.offsets[k], corsa: corsa.corsa, fermata: gruppo.fermate[k] });
      });
    });
    return elenco.sort((a, b) => a.secondi - b.secondi);
  }

  function ultima(linea, capolinea, attive) {
    const elenco = partenze(linea, capolinea, attive, 0);
    return elenco.length ? elenco[elenco.length - 1] : null;
  }

  /** Ultima partenza della linea da una fermata precisa (per il badge in scheda). */
  function ultimaAllaFermata(linea, capolinea, idFermata, attive) {
    if (!linea) return null;
    let massimo = null;
    linea.gruppi.forEach((gruppo) => {
      if (capolinea && !stessoCapolinea(gruppo.capolinea, capolinea)) return;
      const k = gruppo.fermate.lastIndexOf(idFermata);
      if (k < 0 || k >= gruppo.fermate.length - 1) return;
      gruppo.corse.forEach((corsa) => {
        if (!attivo(corsa.servizio, attive)) return;
        const secondi = corsa.inizio + gruppo.offsets[k];
        if (massimo == null || secondi > massimo.secondi) massimo = { secondi: secondi, corsa: corsa.corsa };
      });
    });
    return massimo;
  }

  /**
   * Linee che rispondono a un testo: nome esatto, poi prefisso, poi contenuto.
   * «linea 20» e «20» danno lo stesso risultato.
   */
  function cerca(linee, testo) {
    const q = normalizza(testo);
    if (!linee || !q) return [];
    const trovate = [];
    linee.forEach((linea) => {
      const nome = normalizza(linea.nome);
      let peso = -1;
      if (nome === q) peso = 0;
      else if (nome.indexOf(q) === 0) peso = 1;
      else if (nome.indexOf(q) > 0) peso = 2;
      if (peso < 0) return;
      trovate.push({ linea: linea, peso: peso });
    });
    trovate.sort((a, b) => a.peso - b.peso ||
      a.linea.nome.localeCompare(b.linea.nome, 'it', { numeric: true }));
    return trovate.slice(0, 8).map((voce) => {
      const linea = voce.linea;
      return {
        nome: linea.nome,
        tipo: linea.tipo,
        versi: versi(linea).map((verso) => verso.capolinea)
      };
    });
  }

  const API = {
    indice: indice,
    lineaDi: lineaDi,
    versi: versi,
    gruppoPrincipale: gruppoPrincipale,
    fermateVerso: fermateVerso,
    corsaVerso: corsaVerso,
    partenze: partenze,
    ultima: ultima,
    ultimaAllaFermata: ultimaAllaFermata,
    cerca: cerca
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Linee = API;
})(typeof window !== 'undefined' ? window : globalThis);
