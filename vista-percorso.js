/* Muovi Bologna — scheda del percorso
 * Solo HTML: nessuno stato e nessun accesso ai dati dell'app. app.js passa uno
 * snapshot ({ stato, esito, opzioni, modo, ... }) e la funzione che risolve i
 * nomi delle fermate, così il rendering resta isolato e verificabile a parte.
 */
(function (globale) {
  'use strict';

  const Icone = typeof require === 'function' ? require('./icone') : globale.Icone;
  const Utilita = typeof require === 'function' ? require('./utilita') : globale.Utilita;
  // Le impronte a 16px si leggono come due puntini: una figura intera è
  // riconoscibile anche a questa dimensione.
  const ICONA_PEDANA = Icone.svg('person-standing', 18);

  function esc(valore) {
    return String(valore == null ? '' : valore)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function due(valore) { return String(valore).padStart(2, '0'); }

  function hhmm(secondi) {
    const s = ((secondi % 86400) + 86400) % 86400;
    return due(Math.floor(s / 3600)) + ':' + due(Math.floor((s % 3600) / 60));
  }

  function minuti(secondi) { return Math.max(1, Math.round(secondi / 60)); }

  /** Minuti a un orario HH:MM rispetto a un'ora del giorno, in -720..720. */
  function minutiA(ora, adessoMinuti) {
    const parti = String(ora || '').split(':');
    const ore = parseInt(parti[0], 10);
    const min = parseInt(parti[1], 10);
    if (!isFinite(ore) || !isFinite(min)) return 0;
    const target = ((ore % 24) * 60 + min) % 1440;
    const adesso = ((adessoMinuti % 1440) + 1440) % 1440;
    return ((target - adesso + 720 + 1440) % 1440) - 720;
  }

  // HelloBus aggiunge la variante alla linea (13A, 19C) mentre il GTFS colora
  // e numera la linea base (13, 19): per confrontarle serve la stessa chiave.
  function chiaveLinea(linea) {
    const testo = String(linea == null ? '' : linea).trim().toUpperCase();
    const variante = /^(\d+)[A-Z]+$/.exec(testo);
    return variante ? variante[1] : testo;
  }

  /**
   * Nomi delle linee presenti, già ridotti alla linea base: 13 e 13A danno una
   * chip sola, come la deduplica dell'elenco.
   */
  function lineeElenco(elenco) {
    const nomi = [];
    (elenco || []).forEach((voce) => {
      const nome = chiaveLinea(voce && voce.linea);
      if (nome && nomi.indexOf(nome) < 0) nomi.push(nome);
    });
    return nomi.sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
  }

  /**
   * Righe della linea scelta, confrontate sulla linea base: filtrare «13»
   * tiene anche le corse 13A, che la deduplica considera la stessa linea.
   */
  function filtraLinea(elenco, linea) {
    const righe = elenco || [];
    if (!linea) return righe.slice();
    const base = chiaveLinea(linea);
    return righe.filter((voce) => chiaveLinea(voce && voce.linea) === base);
  }

  /**
   * Minuti al prossimo passaggio, senza l'ambiguità delle 12 ore: a mezzogiorno
   * esatto il calcolo circolare darebbe -720 (dodici ore fa) anche per una
   * corsa che deve ancora partire.
   */
  function minutiVerso(ora, adessoMinuti) {
    const minuti = minutiA(ora, adessoMinuti);
    if (minuti !== -720) return minuti;
    const parti = String(ora || '').split(':');
    const ore = parseInt(parti[0], 10);
    const min = parseInt(parti[1], 10);
    if (!isFinite(ore) || !isFinite(min)) return minuti;
    const target = ((ore % 24) * 60 + min) % 1440;
    const adesso = ((adessoMinuti % 1440) + 1440) % 1440;
    return target > adesso ? 720 : minuti;
  }

  /**
   * Un solo elenco di arrivi: corse in tempo reale e orari programmati,
   * ordinati per quanto manca. Se la stessa corsa (linea + ora) arriva da
   * entrambe le fonti vince quella con la posizione reale.
   * `realtime`: [{ linea, ora, tipo, bus }], `programmati`: [{ linea, ora, destinazione }].
   */
  // Tetto massimo della finestra fra corsa reale e programmata. Il valore
  // effettivo scende sulle linee frequenti: vedi `finestra` in arriviUniti.
  const SOGLIA_STESSA_CORSA = 8;

  function arriviUniti(realtime, programmati, adessoMinuti, opzioni) {
    const minimo = opzioni && opzioni.minimo != null ? opzioni.minimo : -1;
    // Nessun tetto di default: l'elenco della fermata è tutto quello che resta
    // nella giornata. Il limite si può passare quando serve (test).
    const massimo = opzioni && opzioni.massimo != null ? opzioni.massimo : Infinity;
    const soglia = opzioni && opzioni.soglia != null ? opzioni.soglia : SOGLIA_STESSA_CORSA;
    // Corse viste dal satellite e corse programmate (HelloBus «Previsto» e GTFS),
    // ridotte a una voce per linea e orario: le due fonti dicono la stessa cosa.
    const vivi = (realtime || [])
      .filter((arrivo) => arrivo.tipo === 'live')
      .map((arrivo) => ({
        base: chiaveLinea(arrivo.linea),
        minuti: minutiVerso(arrivo.ora, adessoMinuti),
        preso: false
      }));
    const candidate = [];
    const chiaviCandidate = new Set();
    const aggiungiCandidata = (linea, ora) => {
      const base = chiaveLinea(linea);
      const chiave = base + '|' + ora;
      if (chiaviCandidate.has(chiave)) return;
      chiaviCandidate.add(chiave);
      candidate.push({ chiave: chiave, base: base, minuti: minutiVerso(ora, adessoMinuti) });
    };
    (realtime || []).forEach((arrivo) => {
      if (arrivo.tipo === 'live') return;
      aggiungiCandidata(arrivo.linea, arrivo.ora);
    });
    (programmati || []).forEach((p) => aggiungiCandidata(p.linea, p.ora));
    // Passo della linea: distanza tipica fra due corse programmate. Una linea
    // ogni 6 minuti non può avere la finestra di una ogni mezz'ora, altrimenti
    // un bus in ritardo assorbe quello precedente.
    const orariLinea = new Map();
    candidate.forEach((c) => {
      if (!orariLinea.has(c.base)) orariLinea.set(c.base, []);
      orariLinea.get(c.base).push(c.minuti);
    });
    const passi = new Map();
    orariLinea.forEach((minuti, base) => {
      const ordinati = minuti.slice().sort((a, b) => a - b);
      const scarti = [];
      for (let i = 1; i < ordinati.length; i += 1) {
        const scarto = ordinati[i] - ordinati[i - 1];
        // I vuoti di servizio (notte, domenica) non sono il passo della linea.
        if (scarto > 0 && scarto <= 60) scarti.push(scarto);
      }
      if (!scarti.length) return;
      scarti.sort((a, b) => a - b);
      passi.set(base, scarti[Math.floor(scarti.length / 2)]);
    });
    const finestra = (base) => {
      const passo = passi.get(base);
      if (!passo) return soglia;
      // Sempre meno del passo: la corsa prima della stessa linea resta in elenco.
      return Math.min(soglia, Math.max(0.5, passo - 1.5));
    };
    // Associazione una a una, dalla coppia più vicina: un bus reale non può
    // nascondere due corse. Una corsa che viene dopo il passaggio reale è più
    // probabilmente quella successiva, quindi costa qualche punto in più.
    const coppie = [];
    candidate.forEach((c) => {
      const limite = finestra(c.base);
      vivi.forEach((vivo, indice) => {
        if (vivo.base !== c.base) return;
        const scarto = vivo.minuti - c.minuti;
        if (Math.abs(scarto) > limite) return;
        coppie.push({ chiave: c.chiave, indice: indice, peso: Math.abs(scarto) + (scarto < 0 ? 4 : 0) });
      });
    });
    coppie.sort((a, b) => a.peso - b.peso);
    const nascoste = new Set();
    coppie.forEach((coppia) => {
      if (nascoste.has(coppia.chiave) || vivi[coppia.indice].preso) return;
      nascoste.add(coppia.chiave);
      vivi[coppia.indice].preso = true;
    });
    const visti = new Set();
    const elenco = [];
    const aggiungi = (voce) => {
      const chiave = chiaveLinea(voce.linea) + '|' + voce.ora;
      if (visti.has(chiave)) return;
      visti.add(chiave);
      elenco.push(voce);
    };
    (realtime || []).forEach((arrivo) => {
      // HelloBus elenca anche i passaggi «Previsto» accanto a quelli reali:
      // quando il bus è localizzato resta solo la riga con il GPS.
      if (arrivo.tipo !== 'live' &&
        nascoste.has(chiaveLinea(arrivo.linea) + '|' + arrivo.ora)) return;
      aggiungi({
        linea: String(arrivo.linea),
        ora: arrivo.ora,
        tipo: arrivo.tipo === 'live' ? 'live' : 'orario',
        bus: arrivo.bus || null,
        destinazione: arrivo.destinazione || ''
      });
    });
    // Il capolinea si prende dal GTFS anche per le corse che restano fuori
    // dalla finestra: una riga live senza direzione non dice dove va il bus.
    const destinazioni = new Map();
    const perLinea = new Map();
    (programmati || []).forEach((p) => {
      const base = chiaveLinea(p.linea);
      const chiave = base + '|' + p.ora;
      if (p.destinazione) destinazioni.set(chiave, p.destinazione);
      if (!perLinea.has(base)) perLinea.set(base, []);
      if (p.destinazione) {
        perLinea.get(base).push({
          ora: p.ora,
          destinazione: p.destinazione,
          minuti: minutiVerso(p.ora, adessoMinuti)
        });
      }
      const minuti = minutiVerso(p.ora, adessoMinuti);
      if (minuti < minimo || minuti > massimo) return;
      // Stessa corsa già mostrata dal tempo reale: l'orario di tabella sparisce
      // invece di comparire come un secondo bus a pochi minuti di distanza.
      if (nascoste.has(base + '|' + p.ora)) return;
      aggiungi({ linea: String(p.linea), ora: p.ora, tipo: 'orario', bus: null, destinazione: p.destinazione || '' });
    });
    elenco.forEach((voce) => {
      voce.minuti = minutiVerso(voce.ora, adessoMinuti);
      if (!voce.destinazione) {
        const base = chiaveLinea(voce.linea);
        let destinazione = destinazioni.get(base + '|' + voce.ora) || '';
        // HelloBus a volte anticipa o posticipa di qualche minuto rispetto al
        // GTFS: la corsa live non trova la riga con lo stesso orario e finiva
        // per mostrare «Bus 5554» al posto del capolinea. Si usa la corsa
        // programmata più vicina della stessa linea, entro 45 minuti.
        if (!destinazione) {
          const vicine = (perLinea.get(base) || [])
            .slice()
            .sort((a, b) => Math.abs(a.minuti - voce.minuti) - Math.abs(b.minuti - voce.minuti));
          if (vicine.length && Math.abs(vicine[0].minuti - voce.minuti) <= 45) {
            destinazione = vicine[0].destinazione;
          }
        }
        voce.destinazione = destinazione;
      }
    });
    return elenco.filter((voce) => voce.minuti >= minimo).sort((a, b) => a.minuti - b.minuti);
  }

  function cambiTesto(n) {
    return n === 0 ? 'diretto' : (n === 1 ? '1 cambio' : n + ' cambi');
  }

  /** Comandi data/ora sopra il percorso, più la soglia a piedi. */
  function controlli(giorno, orario, modo, camminata) {
    const arrivo = modo === 'arrivo';
    const minutiCammino = Math.min(25, Math.max(3, parseInt(camminata, 10) || 10));
    return '<div class="modo-quando" role="group" aria-label="Tipo di orario">' +
      '<button type="button" data-azione="modo-partenza" class="' + (arrivo ? '' : 'attivo') + '" aria-pressed="' + (arrivo ? 'false' : 'true') + '">Parti alle</button>' +
      '<button type="button" data-azione="modo-arrivo" class="' + (arrivo ? 'attivo' : '') + '" aria-pressed="' + (arrivo ? 'true' : 'false') + '">Arriva entro</button>' +
      '</div>' +
      '<div class="quando">' +
      '<input id="input-data" type="date" value="' + esc(giorno) + '" aria-label="Giorno">' +
      '<span class="sep"></span>' +
      '<input id="input-ora" type="time" step="300" value="' + esc(orario) + '" aria-label="' + (arrivo ? 'Ora di arrivo' : 'Ora di partenza') + '">' +
      (arrivo
        ? '<button type="button" class="adesso" data-azione="tra-un-ora">Tra 1 ora</button>'
        : '<button type="button" class="adesso" data-azione="ora-adesso">Adesso</button>') +
      '</div>' +
      // Quanto si è disposti a camminare: il pianificatore usa questa soglia per
      // le fermate raggiungibili a piedi e per i cambi a piedi.
      '<div class="camminata">' +
      '<label for="input-camminata">' + Icone.svg('person-standing', 16) + '<span>A piedi</span></label>' +
      '<input id="input-camminata" type="range" min="3" max="25" step="1" value="' + minutiCammino +
      '" aria-label="Minuti disposti a camminare" aria-valuetext="' + minutiCammino + ' minuti">' +
      '<output id="valore-camminata" for="input-camminata">' + minutiCammino + ' min</output>' +
      '</div>';
  }

  function piediHTML(testo) {
    return '<div class="piedi">' + ICONA_PEDANA + '<span>' + testo + '</span></div>';
  }

  /** Unico ingresso alla navigazione guidata con la posizione reale. */
  function navigaHTML() {
    return '<button type="button" class="btn btn-primario btn-naviga" data-azione="avvia-navigazione">' +
      Icone.svg('navigation', 16) + 'Avvia navigazione</button>';
  }

  // Sequenza compatta delle linee, nell'ordine in cui si prendono.
  // I minuti a piedi restano solo nel riepilogo: niente badge ripetuti e la
  // riga chiusa sta su una linea sola.
  function modiHTML(e) {
    const pezzi = [];
    e.tappe.forEach((tappa) => {
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      const stile = !treno && tappa.colore
        ? ' style="background:' + esc(tappa.colore) + ';color:' + esc(tappa.coloreTesto || '#FFFFFF') + '"'
        : '';
      pezzi.push('<span class="opzione-linea' + (treno ? ' treno' : '') + '"' + stile + '>' + esc(tappa.linea) + '</span>');
    });
    return pezzi.slice(0, 9).join('');
  }

  // Ritardo live della singola corsa (secondi, calcolato dall'app). Sotto i due
  // minuti non si scrive niente: è rumore, non informazione.
  function ritardoHTML(e, indice) {
    const scarto = e && e.ritardi ? e.ritardi[indice] : null;
    if (scarto == null || Math.abs(scarto) < 120) return '';
    const segno = scarto > 0 ? '+' : '−';
    return ' · <b>' + segno + Math.round(Math.abs(scarto) / 60) + ' min</b>';
  }

  /** Itinerario completo di una singola opzione. */
  function dettaglioHTML(e, etichetta) {
    let html = '<div class="viaggio">';
    if (e.camminoIniziale > 0) {
      html += piediHTML('A piedi <b>' + minuti(e.camminoIniziale) + ' min</b>');
    }
    e.tappe.forEach((tappa, indice) => {
      if (indice > 0) {
        // L'attesa è al netto del tratto a piedi, che ha la sua riga.
        const attesa = Math.round((tappa.attesa - (tappa.camminoPrima ? tappa.camminoPrima.secondi : 0)) / 60);
        // Un cambio che il ritardo della corsa precedente ha già mangiato non
        // va nascosto: è il motivo per cui il percorso potrebbe saltare.
        const rischio = (e.rischi || []).filter((r) => r.indice === indice - 1)[0];
        html += '<div class="cambio' + (rischio ? ' cambio-rischio' : '') + '">Cambio' +
          (attesa >= 1 ? ' · ' + attesa + ' min' : '') +
          (rischio ? ' · <b>a rischio</b>: ' + esc(rischio.motivo) : '') + '</div>';
      }
      if (tappa.camminoPrima && tappa.camminoPrima.secondi >= 45) {
        const minPiedi = Math.max(1, Math.round(tappa.camminoPrima.secondi / 60));
        html += piediHTML('A piedi <b>' + minPiedi + ' min</b> fino a ' + esc(etichetta(tappa.da)));
      }
      const durata = minuti(tappa.arrivo - tappa.partenza);
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      const peopleMover = String(tappa.linea).toUpperCase() === 'MEX';
      // Il badge porta il colore ufficiale della linea, lo stesso del tracciato.
      const colore = !treno && tappa.colore
        ? ' style="background:' + esc(tappa.colore) + ';color:' + esc(tappa.coloreTesto || '#FFFFFF') + '"'
        : '';
      html += '<div class="corsa">' +
        '<span class="corsa-badge' + (treno ? ' treno' : '') + '"' + colore + '>' + esc(tappa.linea) + '</span>' +
        '<div class="corsa-corpo">' +
        '<div class="corsa-riga"><span class="corsa-ora">' + hhmm(tappa.partenza) + '</span><span class="corsa-fermata">' + esc(etichetta(tappa.da)) + '</span></div>' +
        '<div class="corsa-info">' + (peopleMover ? 'People mover' : treno ? 'Treno' : tappa.fermate + ' ' + (tappa.fermate === 1 ? 'fermata' : 'fermate')) + ' · ' + Utilita.durata(durata) +
        ritardoHTML(e, indice) + (tappa.ultimaCorsa ? ' · <b class="ultima-corsa">ultima corsa</b>' : '') + '</div>' +
        '<div class="corsa-riga"><span class="corsa-ora">' + hhmm(tappa.arrivo) + '</span><span class="corsa-fermata">' + esc(etichetta(tappa.a)) + '</span></div>' +
        '</div></div>';
    });
    if (e.camminoFinale > 0) {
      html += piediHTML('A piedi <b>' + minuti(e.camminoFinale) + ' min</b> fino a destinazione');
    }
    html += '</div>';
    return html;
  }

  /** Riga compatta (collassata) di un'opzione: si apre al clic. */
  function opzioneHTML(e, indice, vista, etichetta) {
    // L'orario mostrato è quello in cui si è davvero a destinazione: dopo
    // l'ultimo bus c'è il tratto a piedi fino alla fermata scelta.
    const arrivoDestinazione = e.arrivo + (e.camminoFinale || 0);
    const uscita = Math.max(0, e.partenza - e.camminoIniziale);
    const totale = minuti(arrivoDestinazione - uscita);
    const piedi = Math.round((e.camminoIniziale + e.camminoFinale) / 60);
    const extra = piedi >= 1 ? ' · ' + piedi + ' min a piedi' : '';
    const margine = vista.modo === 'arrivo' && e.margine != null
      ? Math.round(e.margine / 60) : null;
    return '<details class="opzione" data-opzione="' + indice + '"' + (vista.aperto === indice ? ' open' : '') + '>' +
      '<summary class="opzione-testa">' +
      '<span class="opzione-orari">' + hhmm(uscita) + '<span class="freccia">→</span>' + hhmm(arrivoDestinazione) + '</span>' +
      '<span class="opzione-meta">' + Utilita.durata(totale) + ' · ' + cambiTesto(e.cambi) + esc(extra) +
      (margine != null && margine >= 0 ? ' · ' + margine + ' min di margine' : '') +
      (e.tappe.some((tappa) => tappa.ultimaCorsa) ? ' · <b class="ultima-corsa">ultima corsa</b>' : '') + '</span>' +
      '<span class="opzione-linee">' + modiHTML(e) + '</span>' +
      Icone.svg('chevron-down', 16, 'opzione-freccia') +
      '</summary>' +
      '<div class="opzione-corpo">' + dettaglioHTML(e, etichetta) + '</div>' +
      '</details>';
  }

  /**
   * Corpo della scheda: scheletro, errore, avvisi, nessun collegamento oppure
   * le opzioni di viaggio (chiuse) con cambi e tratti a piedi.
   * @param vista { stato, esito, opzioni, modo, scadenza, orario, errore, piedi, aperto }
   * @param etichetta funzione id fermata → nome breve
   */
  function esito(vista, etichetta) {
    if (vista.stato === 'idle' || vista.stato === 'caricamento') {
      return '<div class="box-messaggio"><div class="scheletro"><span></span><span></span><span></span></div></div>';
    }
    if (vista.stato === 'errore') {
      return '<div class="box-messaggio errore">Percorso non calcolato (' + esc(vista.errore) + '). Controlla la connessione.' +
        '<button class="btn btn-secondario" data-azione="riprova-percorso">Riprova</button></div>';
    }
    if (vista.stato === 'piedi') {
      return '<div class="box-messaggio">Partenza e arrivo distano ' + vista.piedi.metri + ' m: ci arrivi a piedi in circa ' +
        vista.piedi.minuti + ' min.</div>' + navigaHTML();
    }
    if (vista.stato === 'messaggio') {
      const codice = vista.esito && vista.esito.errore;
      let testo = 'Percorso non disponibile per queste fermate.';
      if (codice === 'senza-orari') testo = 'Nessuna fermata con orari entro ' + (vista.camminata || 10) + ' min a piedi: scegli una fermata bus vicina o aumenta i minuti a piedi.';
      return '<div class="box-messaggio">' + esc(testo) + '</div>';
    }
    if (vista.stato === 'nessuno') {
      const testo = vista.modo === 'arrivo'
        ? 'Nessun viaggio arriva entro le ' + esc(vista.orario || '') + '.'
        : 'Nessun viaggio a quest\'ora: di domenica e in tarda serata i bus sono pochi.';
      return '<div class="box-messaggio">' + testo +
        '<button class="btn btn-secondario" data-azione="prova-domani">Prova domani alle 08:00</button></div>';
    }

    const opzioni = vista.opzioni && vista.opzioni.length ? vista.opzioni : [vista.esito];
    let html =
      // Riempito dall'app con il passaggio reale del primo bus (o l'avviso
      // che per i treni vale l'orario programmato).
      '<div class="live-percorso" id="live-percorso" hidden></div>' +
      '<div class="opzioni">' +
      opzioni.map((e, indice) => opzioneHTML(e, indice, vista, etichetta)).join('') + '</div>' +
      // La navigazione arriva dopo le alternative: prima si sceglie il viaggio,
      // poi si parte. In cima spingeva il confronto degli orari più in basso.
      navigaHTML();
    html += '<div class="avviso nota-tracciato" id="nota-tracciato" hidden>' +
      Icone.svg('triangle-alert', 16) +
      '<span>Senza tracciato: sulla mappa è una linea tratteggiata.</span></div>';
    return html;
  }

  const API = {
    controlli: controlli,
    esito: esito,
    dettaglio: dettaglioHTML,
    arriviUniti: arriviUniti,
    chiaveLinea: chiaveLinea,
    lineeElenco: lineeElenco,
    filtraLinea: filtraLinea,
    minutiA: minutiA,
    ICONA_PEDANA: ICONA_PEDANA
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.VistaPercorso = API;
})(typeof window !== 'undefined' ? window : globalThis);
