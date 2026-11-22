/* TPER Zone Calc — calcolo percorsi
 * Usa data/orari.json(.gz), generato da scripts/preprocess-orari.js a partire
 * dal GTFS ufficiale TPER. Algoritmo: RAPTOR a round (una corsa per round),
 * con tempo minimo di cambio alla stessa fermata.
 * Nessuna dipendenza esterna.
 */
(function (globale) {
  'use strict';

  const CAMBIO_MINIMO = 150;      // secondi minimi per un cambio
  const INF = 0x7fffffff;

  let dati = null;
  let indiceFermate = null;
  let tracciati = null;            // geometrie reali delle linee (data/tracciati.json)
  let caricamentoTracciati = null;
  const formeDecodificate = new Map();
  const reti = new Map();

  function isoDi(data) {
    const mese = String(data.getMonth() + 1).padStart(2, '0');
    const giorno = String(data.getDate()).padStart(2, '0');
    return data.getFullYear() + '-' + mese + '-' + giorno;
  }

  function chiaveDi(data) {
    return isoDi(data).replace(/-/g, '');
  }

  let caricamento = null;

  async function carica(urlGz, urlRaw) {
    if (dati) return dati;
    if (caricamento) return caricamento;
    caricamento = scarica(urlGz, urlRaw).catch((errore) => {
      caricamento = null;
      throw errore;
    });
    return caricamento;
  }

  async function scaricaJSON(urlGz, urlRaw) {
    let risultato = null;

    if (urlGz && typeof DecompressionStream !== 'undefined') {
      try {
        // 'default' (non force-cache): il file si rivalida, così un aggiornamento
        // dei dati arriva davvero; offline ci pensa il service worker.
        const risposta = await fetch(urlGz, { cache: 'default' });
        if (risposta.ok && risposta.body) {
          const flusso = risposta.body.pipeThrough(new DecompressionStream('gzip'));
          risultato = JSON.parse(await new Response(flusso).text());
        }
      } catch (errore) { /* si prova il file non compresso */ }
    }

    if (!risultato && urlRaw) {
      const risposta = await fetch(urlRaw, { cache: 'default' });
      if (!risposta.ok) throw new Error('Dati non disponibili');
      risultato = await risposta.json();
    }
    if (!risultato) throw new Error('Dati non caricabili in questo browser');
    return risultato;
  }

  async function scarica(urlGz, urlRaw) {
    const risultato = await scaricaJSON(urlGz, urlRaw);
    dati = risultato;
    indiceFermate = new Map();
    dati.fermate.forEach((id, indice) => indiceFermate.set(id, indice));
    return dati;
  }

  function serviziAttivi(chiave) {
    const data = new Date(
      parseInt(chiave.slice(0, 4), 10),
      parseInt(chiave.slice(4, 6), 10) - 1,
      parseInt(chiave.slice(6, 8), 10),
      12, 0, 0
    );
    const indiceGiorno = (data.getDay() + 6) % 7; // 0 = lunedì
    const bit = 1 << indiceGiorno;
    const numero = parseInt(chiave, 10);
    const attivi = new Set();
    dati.servizi.forEach((servizio, indice) => {
      if ((servizio[0] & bit) && numero >= servizio[1] && numero <= servizio[2]) attivi.add(indice);
    });
    const eccezioni = dati.eccezioni[chiave];
    if (eccezioni) {
      if (eccezioni.a) eccezioni.a.forEach((indice) => attivi.add(indice));
      if (eccezioni.r) eccezioni.r.forEach((indice) => attivi.delete(indice));
    }
    return attivi;
  }

  /**
   * Espande le corse attive in una rete utilizzabile dall'algoritmo:
   * - per ogni corsa, fermate e orari come array tipizzati
   * - per ogni fermata, l'elenco delle corse che la servono con la posizione
   */
  function costruisciRete(chiave) {
    if (reti.has(chiave)) return reti.get(chiave);
    const attivi = serviziAttivi(chiave);
    const numeroFermate = dati.fermate.length;

    const corse = [];
    const conteggio = new Uint32Array(numeroFermate + 1);

    for (let i = 0; i < dati.corse.length; i += 1) {
      const voce = dati.corse[i];
      if (!attivi.has(voce[1])) continue;
      const quante = (voce.length - 4) / 2 + 1;
      if (quante < 2) continue;
      const fermate = new Uint16Array(quante);
      const orari = new Uint32Array(quante);
      let fermata = voce[2];
      let tempo = voce[3];
      fermate[0] = fermata;
      orari[0] = tempo;
      for (let j = 4; j < voce.length; j += 2) {
        const posizione = (j - 2) / 2;
        fermata += voce[j];
        tempo += voce[j + 1];
        fermate[posizione] = fermata;
        orari[posizione] = tempo;
        conteggio[fermata] += 1;
      }
      corse.push({
        fermate: fermate,
        orari: orari,
        linea: voce[0],
        forma: tracciati && tracciati.corse ? tracciati.corse[i] : -1
      });
    }

    // Offset per fermata → elenco delle corse che la servono.
    const offset = new Uint32Array(numeroFermate + 1);
    let somma = 0;
    for (let i = 0; i < numeroFermate; i += 1) {
      offset[i] = somma;
      somma += conteggio[i];
      conteggio[i] = offset[i];
    }
    offset[numeroFermate] = somma;

    const perCorsa = new Uint32Array(somma);
    const perPosizione = new Uint16Array(somma);
    corse.forEach((corsa, indiceCorsa) => {
      for (let p = 1; p < corsa.fermate.length; p += 1) {
        const fermata = corsa.fermate[p];
        const posto = conteggio[fermata];
        perCorsa[posto] = indiceCorsa;
        perPosizione[posto] = p;
        conteggio[fermata] = posto + 1;
      }
    });

    const rete = {
      chiave: chiave,
      corse: corse,
      offset: offset,
      perCorsa: perCorsa,
      perPosizione: perPosizione
    };
    if (reti.size > 2) reti.clear();
    reti.set(chiave, rete);
    return rete;
  }

  function secondiDa(data) {
    return data.getHours() * 3600 + data.getMinutes() * 60 + data.getSeconds();
  }

  function nomeLinea(indiceLinea) {
    const linea = dati.linee[indiceLinea] || ['—', 3];
    return { linea: linea[0], tipo: linea[1] };
  }

  /**
   * RAPTOR: ad ogni round si può salire su una corsa in più.
   * orario[fermata] = prima ora di arrivo conosciuta; prec[fermata] = ultima tratta.
   */
  function pianifica(chiave, origini, destinazioni, oraPartenza, maxCambi) {
    const rete = costruisciRete(chiave);
    const numeroFermate = dati.fermate.length;
    const orario = new Int32Array(numeroFermate).fill(INF);
    const prec = new Array(numeroFermate).fill(null);
    const camminoOrigine = new Map();

    let marcate = [];
    origini.forEach((origine) => {
      const etichetta = oraPartenza + (origine.cammino || 0);
      if (etichetta < orario[origine.indice]) {
        orario[origine.indice] = etichetta;
        prec[origine.indice] = null;
        camminoOrigine.set(origine.indice, origine.cammino || 0);
        marcate.push(origine.indice);
      }
    });

    for (let round = 0; round <= maxCambi && marcate.length; round += 1) {
      const nuove = [];
      // Le fermate con arrivo più basso per prime: si sale prima sulla corsa migliore.
      marcate.sort((a, b) => orario[a] - orario[b]);

      for (let m = 0; m < marcate.length; m += 1) {
        const fermata = marcate[m];
        const pronto = orario[fermata] + (round === 0 ? 0 : CAMBIO_MINIMO);
        for (let k = rete.offset[fermata]; k < rete.offset[fermata + 1]; k += 1) {
          const indiceCorsa = rete.perCorsa[k];
          const posizione = rete.perPosizione[k];
          const corsa = rete.corse[indiceCorsa];
          if (corsa.orari[posizione] < pronto) continue;
          for (let p = posizione + 1; p < corsa.fermate.length; p += 1) {
            const prossima = corsa.fermate[p];
            const arrivo = corsa.orari[p];
            if (arrivo < orario[prossima]) {
              orario[prossima] = arrivo;
              prec[prossima] = { corsa: indiceCorsa, salita: posizione, discesa: p, da: fermata };
              nuove.push(prossima);
            }
          }
        }
      }
      const viste = new Set();
      marcate = [];
      nuove.forEach((fermata) => {
        if (viste.has(fermata)) return;
        viste.add(fermata);
        marcate.push(fermata);
      });
    }

    let destinazione = null;
    destinazioni.forEach((dest) => {
      if (orario[dest.indice] === INF) return;
      if (!destinazione || orario[dest.indice] < orario[destinazione.indice]) destinazione = dest;
    });
    if (!destinazione) return null;

    // Ricostruzione delle tratte a ritroso.
    const tratte = [];
    let fermata = destinazione.indice;
    let guardia = 0;
    let origine = null;
    while (guardia < 12) {
      const passo = prec[fermata];
      if (!passo) { origine = fermata; break; }
      const corsa = rete.corse[passo.corsa];
      tratte.push({
        corsa: corsa,
        salita: passo.salita,
        discesa: passo.discesa,
        da: corsa.fermate[passo.salita],
        a: corsa.fermate[passo.discesa],
        partenza: corsa.orari[passo.salita],
        arrivo: corsa.orari[passo.discesa]
      });
      fermata = corsa.fermate[passo.salita];
      guardia += 1;
    }
    if (origine === null) return null;
    tratte.reverse();
    if (!tratte.length) return null;

    const tappe = tratte.map((tratta, indice) => {
      const info = nomeLinea(tratta.corsa.linea);
      const precedente = indice > 0 ? tratte[indice - 1] : null;
      return {
        linea: info.linea,
        tipo: info.tipo,
        da: dati.fermate[tratta.da],
        a: dati.fermate[tratta.a],
        partenza: tratta.partenza,
        arrivo: tratta.arrivo,
        fermate: tratta.discesa - tratta.salita,
        forma: tratta.corsa.forma,
        // Fermate della corsa tra salita e discesa: servono a tagliare il
        // tracciato nel verso giusto (anelli e linee con fermate ripetute).
        sequenza: Array.prototype.slice.call(tratta.corsa.fermate, tratta.salita, tratta.discesa + 1),
        stops: Array.prototype.slice.call(tratta.corsa.fermate, tratta.salita, tratta.discesa + 1).map((indice) => dati.fermate[indice]),
        attesa: precedente ? tratta.partenza - precedente.arrivo : tratta.partenza - (oraPartenza + (camminoOrigine.get(origine) || 0))
      };
    });

    return {
      chiave: chiave,
      da: dati.fermate[origine],
      a: dati.fermate[destinazione.indice],
      richiesta: oraPartenza,
      partenza: tappe[0].partenza,
      arrivo: orario[destinazione.indice],
      durata: orario[destinazione.indice] - oraPartenza,
      viaggio: orario[destinazione.indice] - tappe[0].partenza,
      attesaIniziale: tappe[0].partenza - orario[origine],
      camminoIniziale: camminoOrigine.get(origine) || 0,
      camminoFinale: destinazione.cammino || 0,
      cambi: tappe.length - 1,
      tappe: tappe
    };
  }

  /**
   * Calcola il percorso tra due codici fermata.
   * @param {string} daId codice fermata di partenza
   * @param {string} aId codice fermata di destinazione
   * @param {Date} quando ora di partenza desiderata
   */
  function normalizzaElenco(valore) {
    const elenco = Array.isArray(valore) ? valore : [{ id: valore, cammino: 0 }];
    const risultato = [];
    const visti = new Set();
    elenco.forEach((voce) => {
      const id = typeof voce === 'string' ? voce : voce.id;
      const cammino = typeof voce === 'string' ? 0 : (voce.cammino || 0);
      const indice = indiceFermate.get(id);
      if (indice === undefined || visti.has(indice)) return;
      visti.add(indice);
      risultato.push({ indice: indice, cammino: cammino });
    });
    return risultato;
  }

  function calcola(daId, aId, quando, opzioni) {
    if (!dati) throw new Error('Orari non ancora caricati');
    const data = quando || new Date();
    const maxCambi = opzioni && opzioni.maxCambi != null ? opzioni.maxCambi : 3;
    const origini = normalizzaElenco(daId);
    const destinazioni = normalizzaElenco(aId);
    if (!origini.length || !destinazioni.length) return { errore: 'senza-orari' };
    if (origini.length === 1 && destinazioni.length === 1 && origini[0].indice === destinazioni[0].indice) {
      return { errore: 'stessa-fermata' };
    }

    const ora = secondiDa(data);
    const risultato = pianifica(chiaveDi(data), origini, destinazioni, ora, maxCambi);
    if (risultato) return risultato;

    // Dopo mezzanotte le corse serali appartengono al giorno precedente.
    if (data.getHours() < 4) {
      const ieri = new Date(data.getTime() - 86400000);
      return pianifica(chiaveDi(ieri), origini, destinazioni, ora + 86400, maxCambi) || null;
    }
    return null;
  }

  /* --- Geometria delle corse ------------------------------------------ */

  // Le forme sono polilinee codificate (vedi scripts/preprocess-orari.js):
  // si decodificano una volta sola, alla prima tratta che le usa.
  function decodifica(testo) {
    const punti = [];
    let indice = 0;
    let lat = 0;
    let lon = 0;
    const numero = () => {
      let risultato = 0;
      let shift = 0;
      let byte;
      do {
        byte = testo.charCodeAt(indice++) - 63;
        risultato |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return (risultato & 1) ? ~(risultato >> 1) : (risultato >> 1);
    };
    while (indice < testo.length) {
      lat += numero();
      lon += numero();
      punti.push([lat / 1e5, lon / 1e5]);
    }
    return punti;
  }

  function forma(indiceForma) {
    if (!tracciati || indiceForma == null || indiceForma < 0) return null;
    if (!formeDecodificate.has(indiceForma)) {
      formeDecodificate.set(indiceForma, decodifica(tracciati.forme[indiceForma] || ''));
    }
    return formeDecodificate.get(indiceForma);
  }

  /**
   * Pezzo di tracciato tra due fermate, in coordinate GeoJSON [lon, lat].
   * Usa la tabella fermata→punto calcolata in fase di preprocessing: niente
   * proiezioni approssimate, e le linee ad anello seguono il verso giusto.
   * Restituisce null se la geometria non è disponibile.
   */
  function tratta(indiceForma, da, a, sequenza) {
    const punti = forma(indiceForma);
    if (!punti || punti.length < 2) return null;
    const tabella = tracciati.posizioni && tracciati.posizioni[indiceForma];
    if (!tabella || !tabella.length) return null;

    let salita = -1;
    let discesa = -1;

    if (sequenza && sequenza.length >= 2) {
      // Si segue l'ordine reale delle fermate della corsa: ogni fermata prende
      // la prima occorrenza sul tracciato che non torna indietro.
      let ultimo = 0;
      for (let i = 0; i < sequenza.length; i += 1) {
        const fermata = sequenza[i];
        let vertice = -1;
        for (let k = 0; k < tabella.length; k += 2) {
          if (tabella[k] !== fermata) continue;
          if (tabella[k + 1] >= ultimo) { vertice = tabella[k + 1]; break; }
        }
        if (vertice < 0) continue;
        ultimo = vertice;
        if (salita < 0) salita = vertice;
        discesa = vertice;
      }
    } else {
      const indiceDa = indiceFermate.get(da);
      const indiceA = indiceFermate.get(a);
      if (indiceDa === undefined || indiceA === undefined) return null;
      let minimo = Infinity;
      for (let k = 0; k < tabella.length; k += 2) {
        if (tabella[k] !== indiceDa) continue;
        for (let j = k + 2; j < tabella.length; j += 2) {
          if (tabella[j] !== indiceA) continue;
          const salto = j - k;
          if (salto < minimo) { minimo = salto; salita = tabella[k + 1]; discesa = tabella[j + 1]; }
          break;
        }
      }
    }

    if (salita < 0 || discesa <= salita) return null;
    return punti.slice(salita, discesa + 1).map((punto) => [punto[1], punto[0]]);
  }

  async function caricaTracciati(urlGz, urlRaw) {
    if (tracciati) return tracciati;
    if (caricamentoTracciati) return caricamentoTracciati;
    caricamentoTracciati = scaricaJSON(urlGz, urlRaw).then((risultato) => {
      tracciati = risultato;
      // Le reti già costruite non conoscono le geometrie: si ricostruiscono.
      reti.clear();
      return tracciati;
    }).catch((errore) => {
      caricamentoTracciati = null;
      throw errore;
    });
    return caricamentoTracciati;
  }

  const API = {
    carica: carica,
    caricaTracciati: caricaTracciati,
    tratta: tratta,
    calcola: calcola,
    disponibile: function () { return !!dati; },
    fermateDisponibili: function () { return indiceFermate ? Array.from(indiceFermate.keys()) : []; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.TPERRouting = API;
})(typeof window !== 'undefined' ? window : globalThis);
