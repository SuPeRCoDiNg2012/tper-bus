/* Muovi Bologna — calcolo percorsi
 * Usa data/orari.json(.gz), generato da scripts/preprocess-orari.js a partire
 * dal GTFS ufficiale TPER. Algoritmo: RAPTOR a round (una corsa per round),
 * con tempo minimo di cambio alla stessa fermata.
 * Nessuna dipendenza esterna.
 */
(function (globale) {
  'use strict';

  // Il cambio non costa lo stesso tempo per tutti i mezzi: due bus alla stessa
  // palina si prendono in due minuti, mentre un treno chiede banchina, scale e
  // a volte il sottopasso. Con un valore unico di 150 s il pianificatore
  // proponeva cambi treno+bus che nella realtà si perdono.
  const CAMBIO_BUS = 120;
  const CAMBIO_TRENO = 240;
  const CAMMINO_CAMBIO_MASSIMO = 300;   // secondi di cammino per un cambio a piedi
  const INF = 0x7fffffff;

  let dati = null;
  let indiceFermate = null;
  let tracciati = null;            // geometrie reali delle linee (data/tracciati.json)
  // Fermate vicine raggiungibili a piedi: Map indice → [[indice, secondi]].
  // Servono per i cambi tra paline opposte o fermate della stessa piazza.
  let cammini = new Map();
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
      // Anche la prima fermata della corsa va indicizzata: da lì si sale
      // esattamente come dalle altre. Senza, una corsa che parte dalla
      // fermata scelta risultava inesistente.
      conteggio[fermata] += 1;
      for (let j = 4; j < voce.length; j += 2) {
        const posizione = (j - 2) / 2;
        fermata += voce[j];
        tempo += voce[j + 1];
        fermate[posizione] = fermata;
        orari[posizione] = tempo;
        conteggio[fermata] += 1;
      }
      const linea = dati.linee[voce[0]] || ['—', 3];
      corse.push({
        fermate: fermate,
        orari: orari,
        linea: voce[0],
        // Nome e tipo servono nel ciclo caldo: verificare le linee vietate e
        // scegliere il tempo di cambio senza altre ricerche negli array.
        nome: String(linea[0]).toUpperCase(),
        tipo: linea[1],
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
      for (let p = 0; p < corsa.fermate.length; p += 1) {
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

  // I treni si chiamano per categoria, non per linea: RV per i regionali
  // veloci, REG per tutti gli altri (S1A/S2A compresi, che sono regionali).
  function etichettaTreno(nome) {
    return /rv|veloce/i.test(String(nome == null ? '' : nome)) ? 'RV' : 'REG';
  }

  /**
   * RAPTOR: ad ogni round si può salire su una corsa in più.
   * orario[fermata] = prima ora di arrivo conosciuta; giri[fermata] = con
   * quante corse ci si arriva; predecessori[giro][fermata] = la corsa usata
   * in quel giro. Le tratte stanno per giro (e non per fermata), così la
   * ricostruzione non può entrare in loop quando una fermata migliora due volte.
   */
  function pianifica(chiave, origini, destinazioni, oraPartenza, maxCambi, vietate, camminoMax) {
    const limitePiedi = camminoMax != null ? camminoMax : CAMMINO_CAMBIO_MASSIMO;
    const rete = costruisciRete(chiave);
    const numeroFermate = dati.fermate.length;
    let orario = new Int32Array(numeroFermate).fill(INF);
    const giri = new Int32Array(numeroFermate).fill(-1);
    // Tipo di linea con cui si arriva in ogni fermata: serve a decidere se il
    // cambio è tra bus o coinvolge un treno.
    const tipoArrivo = new Int8Array(numeroFermate).fill(3);
    const predecessori = [];
    const camminoOrigine = new Map();

    let marcate = [];
    origini.forEach((origine) => {
      const etichetta = oraPartenza + (origine.cammino || 0);
      if (etichetta < orario[origine.indice]) {
        orario[origine.indice] = etichetta;
        giri[origine.indice] = 0;
        camminoOrigine.set(origine.indice, origine.cammino || 0);
        marcate.push(origine.indice);
      }
    });

    // Etichette a doppio buffer: in un round si sale solo sulle fermate
    // raggiunte nei round precedenti. Senza questo, una corsa presa nello
    // stesso round ne apriva un'altra e l'itinerario usava molti più cambi di
    // quelli richiesti (arrivando anche prima, ma con giri assurdi).
    for (let round = 0; round <= maxCambi && marcate.length; round += 1) {
      // Cambio a piedi tra fermate vicine: non consuma un cambio di bus, quindi
      // si applica prima di salire e resta nello stesso giro. Senza questo una
      // palina opposta sembrava un'altra città e l'itinerario faceva giri di ore.
      if (cammini.size) {
        if (!predecessori[round]) predecessori[round] = new Array(numeroFermate).fill(null);
        // Si chiude a punto fisso, così etichette e predecessori restano
        // coerenti anche quando si attraversano due paline di fila. Il cammino
        // totale è limitato: un cambio a piedi resta un cambio, non una gita.
        const piediTotali = new Int32Array(numeroFermate);
        const coda = marcate.slice();
        const inCoda = new Set(coda);
        const migliorate = [];
        let passi = 0;
        while (coda.length && passi < 200000) {
          const fermata = coda.shift();
          inCoda.delete(fermata);
          passi += 1;
          const vicini = cammini.get(fermata);
          if (!vicini) continue;
          for (let v = 0; v < vicini.length; v += 1) {
            const altra = vicini[v][0];
            const secondi = vicini[v][1];
            if (piediTotali[fermata] + secondi > limitePiedi) continue;
            const arrivo = orario[fermata] + secondi;
            if (arrivo >= orario[altra]) continue;
            orario[altra] = arrivo;
            giri[altra] = giri[fermata];
            piediTotali[altra] = piediTotali[fermata] + secondi;
            tipoArrivo[altra] = tipoArrivo[fermata];
            predecessori[round][altra] = { piedi: true, da: fermata, secondi: secondi };
            migliorate.push(altra);
            if (!inCoda.has(altra)) { coda.push(altra); inCoda.add(altra); }
          }
        }
        if (migliorate.length) marcate = marcate.concat(migliorate);
      }
      const nuovo = orario.slice();
      const predecessoreGiro = new Array(numeroFermate).fill(null);
      const migliorCorsa = new Map();   // corsa → istante di salita già valutato
      const cambiate = new Set();
      // Le fermate con arrivo più basso per prime: si sale prima sulla corsa migliore.
      marcate.sort((a, b) => orario[a] - orario[b]);

      for (let m = 0; m < marcate.length; m += 1) {
        const fermata = marcate[m];
        for (let k = rete.offset[fermata]; k < rete.offset[fermata + 1]; k += 1) {
          const indiceCorsa = rete.perCorsa[k];
          const posizione = rete.perPosizione[k];
          const corsa = rete.corse[indiceCorsa];
          // Linea vietata: si sta cercando un'alternativa diversa da quella
          // già trovata, non la stessa corsa con qualche minuto di scarto.
          if (vietate && vietate.has(corsa.nome)) continue;
          const attesaMinima = round === 0 ? 0
            : ((tipoArrivo[fermata] === 2 || corsa.tipo === 2) ? CAMBIO_TRENO : CAMBIO_BUS);
          const pronto = orario[fermata] + attesaMinima;
          if (corsa.orari[posizione] < pronto) continue;
          // Se la stessa corsa è già stata presa a una fermata raggiunta prima,
          // risalirci più avanti non può migliorare nessun arrivo.
          const giaPresa = migliorCorsa.get(indiceCorsa);
          if (giaPresa !== undefined && giaPresa <= pronto) continue;
          migliorCorsa.set(indiceCorsa, pronto);
          for (let p = posizione + 1; p < corsa.fermate.length; p += 1) {
            const prossima = corsa.fermate[p];
            const arrivo = corsa.orari[p];
            if (arrivo < nuovo[prossima]) {
              nuovo[prossima] = arrivo;
              giri[prossima] = round + 1;
              tipoArrivo[prossima] = corsa.tipo;
              predecessoreGiro[prossima] = { corsa: indiceCorsa, salita: posizione, discesa: p, da: fermata };
              cambiate.add(prossima);
            }
          }
        }
      }
      predecessori[round + 1] = predecessoreGiro;
      orario = nuovo;
      marcate = Array.from(cambiate);
    }

    // Il più veloce è porta-a-porta: all'arrivo del bus va sommato il tratto a
    // piedi fino alla destinazione, altrimenti vince una fermata lontana.
    let destinazione = null;
    let miglioreTotale = INF;
    let giroDestinazione = -1;
    destinazioni.forEach((dest) => {
      if (orario[dest.indice] === INF) return;
      const totale = orario[dest.indice] + (dest.cammino || 0);
      if (totale < miglioreTotale) {
        miglioreTotale = totale;
        destinazione = dest;
        giroDestinazione = giri[dest.indice];
      }
    });
    if (!destinazione) return null;

    // Ricostruzione a ritroso, giro per giro: se una fermata è migliorata in un
    // giro successivo, il giro prima non ha una tratta nuova e si scende di uno
    // senza cambiare fermata. I passaggi a piedi restano nello stesso giro.
    const passi = [];
    let fermata = destinazione.indice;
    let guardia = 0;
    let giro = giroDestinazione;
    while (giro > 0 && guardia < 40) {
      guardia += 1;
      const passo = predecessori[giro] ? predecessori[giro][fermata] : null;
      if (!passo) { giro -= 1; continue; }
      if (passo.piedi) {
        passi.push({ piedi: true, da: passo.da, a: fermata, secondi: passo.secondi });
        fermata = passo.da;
        continue;
      }
      const corsa = rete.corse[passo.corsa];
      passi.push({
        corsa: corsa,
        salita: passo.salita,
        discesa: passo.discesa,
        da: corsa.fermate[passo.salita],
        a: corsa.fermate[passo.discesa],
        partenza: corsa.orari[passo.salita],
        arrivo: corsa.orari[passo.discesa]
      });
      fermata = corsa.fermate[passo.salita];
      giro -= 1;
    }

    // Tratto a piedi prima della prima corsa: dalla fermata di partenza alla
    // palina da cui si sale.
    let camminoExtra = 0;
    for (let g = 0; g < 10; g += 1) {
      const passo = predecessori[0] ? predecessori[0][fermata] : null;
      if (!passo || !passo.piedi) break;
      camminoExtra += passo.secondi;
      fermata = passo.da;
    }
    const origine = fermata;
    const camminoIniziale = (camminoOrigine.get(origine) || 0) + camminoExtra;
    passi.reverse();
    // Cammino finale: se la fermata di destinazione si raggiunge a piedi da una
    // palina vicina, quel tratto si somma alla camminata verso la destinazione.
    let camminoDopo = 0;
    while (passi.length && passi[passi.length - 1].piedi) {
      camminoDopo += passi.pop().secondi;
    }
    if (!passi.length) return null;
    // L'arrivo è quello etichettato: la differenza dall'ultima corsa è il
    // cammino che manca davvero, anche se in mezzo c'erano più paline.
    const ultimaCorsa = passi[passi.length - 1];
    camminoDopo = Math.max(camminoDopo, orario[destinazione.indice] - ultimaCorsa.arrivo);

    const tappe = [];
    let camminoPrima = null;
    passi.forEach((passo) => {
      if (passo.piedi) {
        // Più passi a piedi di fila diventano un solo tratto: conta il tempo
        // totale e la fermata da cui si è partiti.
        if (camminoPrima) camminoPrima.secondi += passo.secondi;
        else camminoPrima = { da: dati.fermate[passo.da], secondi: passo.secondi };
        return;
      }
      const info = nomeLinea(passo.corsa.linea);
      const precedente = tappe.length ? tappe[tappe.length - 1] : null;
      const ferroviario = info.tipo === 1 || info.tipo === 2;
      tappe.push({
        linea: ferroviario ? etichettaTreno(info.linea) : info.linea,
        // Le linee FER (suburbani S1A/S2A: Bologna–Vignola, –Portomaggiore)
        // viaggiano con i titoli a zone, non con la tariffa a km.
        fer: ferroviario && /^s\d/i.test(String(info.linea)),
        tipo: info.tipo,
        da: dati.fermate[passo.da],
        a: dati.fermate[passo.a],
        partenza: passo.partenza,
        arrivo: passo.arrivo,
        fermate: passo.discesa - passo.salita,
        forma: passo.corsa.forma,
        // Fermate della corsa tra salita e discesa: servono a tagliare il
        // tracciato nel verso giusto (anelli e linee con fermate ripetute).
        sequenza: Array.prototype.slice.call(passo.corsa.fermate, passo.salita, passo.discesa + 1),
        stops: Array.prototype.slice.call(passo.corsa.fermate, passo.salita, passo.discesa + 1).map((indice) => dati.fermate[indice]),
        // Cammino fatto per raggiungere la palina di salita (cambio a piedi).
        camminoPrima: camminoPrima,
        attesa: precedente ? passo.partenza - precedente.arrivo : passo.partenza - (oraPartenza + camminoIniziale)
      });
      camminoPrima = null;
    });
    if (!tappe.length) return null;

    return {
      chiave: chiave,
      da: dati.fermate[origine],
      a: dati.fermate[destinazione.indice],
      richiesta: oraPartenza,
      partenza: tappe[0].partenza,
      arrivo: orario[destinazione.indice],
      durata: orario[destinazione.indice] - oraPartenza,
      viaggio: orario[destinazione.indice] - tappe[0].partenza,
      attesaIniziale: tappe[0].partenza - (oraPartenza + camminoIniziale),
      camminoIniziale: camminoIniziale,
      camminoFinale: (destinazione.cammino || 0) + camminoDopo,
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
    // Linee da evitare: si usa per chiedere un'alternativa davvero diversa.
    const vietate = opzioni && Array.isArray(opzioni.vietate) && opzioni.vietate.length
      ? new Set(opzioni.vietate.map((nome) => String(nome).toUpperCase())) : null;
    // Quanto si è disposti a camminare (secondi) per un cambio a piedi tra
    // fermate: lo decide l'utente dalla scheda (3–25 minuti).
    const camminoMax = opzioni && opzioni.camminoMax != null ? Number(opzioni.camminoMax) : null;
    const origini = normalizzaElenco(daId);
    const destinazioni = normalizzaElenco(aId);
    if (!origini.length || !destinazioni.length) return { errore: 'senza-orari' };
    if (origini.length === 1 && destinazioni.length === 1 && origini[0].indice === destinazioni[0].indice) {
      return { errore: 'stessa-fermata' };
    }

    const ora = secondiDa(data);

    // Dopo mezzanotte le corse serali appartengono al giorno precedente e
    // hanno orari oltre 24:00. Non basta provare prima il giorno corrente:
    // una corsa delle 24:30 verrebbe presa come se partisse tra 24 ore, con
    // una durata assurda. Si calcolano entrambi e si sceglie l'arrivo più
    // presto sullo stesso asse temporale (mezzanotte del giorno prima).
    if (data.getHours() < 4) {
      const ieri = new Date(data.getTime() - 86400000);
      const diIeri = pianifica(chiaveDi(ieri), origini, destinazioni, ora + 86400, maxCambi, vietate, camminoMax);
      const diOggi = pianifica(chiaveDi(data), origini, destinazioni, ora, maxCambi, vietate, camminoMax);
      if (!diIeri) return diOggi || null;
      if (!diOggi) return diIeri;
      return diIeri.arrivo <= diOggi.arrivo + 86400 ? diIeri : diOggi;
    }

    return pianifica(chiaveDi(data), origini, destinazioni, ora, maxCambi, vietate, camminoMax) || null;
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

  // Cambi a piedi: coppie [idA, idB, secondi] tra fermate vicine. Si passano
  // una volta sola dopo il caricamento degli orari; restano fuori dalla rete.
  function impostaCammini(coppie) {
    cammini = new Map();
    if (!indiceFermate || !Array.isArray(coppie)) return;
    coppie.forEach((voce) => {
      if (!voce) return;
      const a = indiceFermate.get(voce[0]);
      const b = indiceFermate.get(voce[1]);
      const secondi = voce[2];
      if (a === undefined || b === undefined || a === b || !(secondi >= 0)) return;
      if (!cammini.has(a)) cammini.set(a, []);
      if (!cammini.has(b)) cammini.set(b, []);
      cammini.get(a).push([b, secondi]);
      cammini.get(b).push([a, secondi]);
    });
    cammini.forEach((elenco) => elenco.sort((x, y) => x[1] - y[1]));
  }

  const API = {
    carica: carica,
    impostaCammini: impostaCammini,
    caricaTracciati: caricaTracciati,
    tratta: tratta,
    calcola: calcola,
    disponibile: function () { return !!dati; },
    fermateDisponibili: function () { return indiceFermate ? Array.from(indiceFermate.keys()) : []; },
    etichettaTreno: etichettaTreno
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.TPERRouting = API;
})(typeof window !== 'undefined' ? window : globalThis);
