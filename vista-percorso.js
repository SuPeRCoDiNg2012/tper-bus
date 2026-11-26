/* Muovi Bologna — scheda del percorso
 * Solo HTML: nessuno stato e nessun accesso ai dati dell'app. app.js passa uno
 * snapshot ({ stato, esito, opzioni, modo, ... }) e la funzione che risolve i
 * nomi delle fermate, così il rendering resta isolato e verificabile a parte.
 */
(function (globale) {
  'use strict';

  const Icone = typeof require === 'function' ? require('./icone') : globale.Icone;
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
   * Un solo elenco di arrivi: corse in tempo reale e orari programmati,
   * ordinati per quanto manca. Se la stessa corsa (linea + ora) arriva da
   * entrambe le fonti vince quella con la posizione reale.
   * `realtime`: [{ linea, ora, tipo, bus }], `programmati`: [{ linea, ora, destinazione }].
   */
  function arriviUniti(realtime, programmati, adessoMinuti, opzioni) {
    const minimo = opzioni && opzioni.minimo != null ? opzioni.minimo : -1;
    // Sei ore: oltre, l'elenco smetterebbe di essere «i prossimi arrivi» e
    // diventerebbe l'orario del giorno, che sta nella sezione sotto.
    const massimo = opzioni && opzioni.massimo != null ? opzioni.massimo : 360;
    const visti = new Set();
    const elenco = [];
    const aggiungi = (voce) => {
      const chiave = chiaveLinea(voce.linea) + '|' + voce.ora;
      if (visti.has(chiave)) return;
      visti.add(chiave);
      elenco.push(voce);
    };
    (realtime || []).forEach((arrivo) => aggiungi({
      linea: String(arrivo.linea),
      ora: arrivo.ora,
      tipo: arrivo.tipo === 'live' ? 'live' : 'orario',
      bus: arrivo.bus || null,
      destinazione: arrivo.destinazione || ''
    }));
    // Il capolinea si prende dal GTFS anche per le corse che restano fuori
    // dalla finestra: una riga live senza direzione non dice dove va il bus.
    const destinazioni = new Map();
    (programmati || []).forEach((p) => {
      const chiave = chiaveLinea(p.linea) + '|' + p.ora;
      if (p.destinazione) destinazioni.set(chiave, p.destinazione);
      const minuti = minutiA(p.ora, adessoMinuti);
      if (minuti < minimo || minuti > massimo) return;
      aggiungi({ linea: String(p.linea), ora: p.ora, tipo: 'orario', bus: null, destinazione: p.destinazione || '' });
    });
    elenco.forEach((voce) => {
      if (!voce.destinazione) {
        voce.destinazione = destinazioni.get(chiaveLinea(voce.linea) + '|' + voce.ora) || '';
      }
      voce.minuti = minutiA(voce.ora, adessoMinuti);
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
        html += '<div class="cambio">Cambio' + (attesa >= 1 ? ' · ' + attesa + ' min' : '') + '</div>';
      }
      if (tappa.camminoPrima && tappa.camminoPrima.secondi >= 45) {
        const minPiedi = Math.max(1, Math.round(tappa.camminoPrima.secondi / 60));
        html += piediHTML('A piedi <b>' + minPiedi + ' min</b> fino a ' + esc(etichetta(tappa.da)));
      }
      const durata = minuti(tappa.arrivo - tappa.partenza);
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      // Il badge porta il colore ufficiale della linea, lo stesso del tracciato.
      const colore = !treno && tappa.colore
        ? ' style="background:' + esc(tappa.colore) + ';color:' + esc(tappa.coloreTesto || '#FFFFFF') + '"'
        : '';
      html += '<div class="corsa">' +
        '<span class="corsa-badge' + (treno ? ' treno' : '') + '"' + colore + '>' + esc(tappa.linea) + '</span>' +
        '<div class="corsa-corpo">' +
        '<div class="corsa-riga"><span class="corsa-ora">' + hhmm(tappa.partenza) + '</span><span class="corsa-fermata">' + esc(etichetta(tappa.da)) + '</span></div>' +
        '<div class="corsa-info">' + (treno ? 'Treno' : tappa.fermate + ' ' + (tappa.fermate === 1 ? 'fermata' : 'fermate')) + ' · ' + durata + ' min' +
        ritardoHTML(e, indice) + '</div>' +
        '<div class="corsa-riga"><span class="corsa-ora">' + hhmm(tappa.arrivo) + '</span><span class="corsa-fermata">' + esc(etichetta(tappa.a)) + '</span></div>' +
        '</div></div>';
      // Segnalazione condivisa: solo per i bus, i treni non hanno controllori.
      if (!treno) {
        html += '<button type="button" class="controllore" data-controllore="' + esc(tappa.linea) +
          '">Ho visto il controllore su questa linea</button>';
      }
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
      '<span class="opzione-meta">' + totale + ' min · ' + cambiTesto(e.cambi) + esc(extra) +
      (margine != null && margine >= 0 ? ' · ' + margine + ' min di margine' : '') + '</span>' +
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
      '<span>Senza tracciato GTFS per un tratto: sulla mappa è una <b>linea diritta tratteggiata</b> tra le fermate, non il percorso reale del bus.</span></div>' +
      '<p class="nota-piccola">Orari programmati; il primo bus mostra il passaggio reale quando c\'è.</p>';
    return html;
  }

  const API = {
    controlli: controlli,
    esito: esito,
    dettaglio: dettaglioHTML,
    arriviUniti: arriviUniti,
    chiaveLinea: chiaveLinea,
    minutiA: minutiA,
    ICONA_PEDANA: ICONA_PEDANA
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.VistaPercorso = API;
})(typeof window !== 'undefined' ? window : globalThis);
