/* Muovi Bologna — scheda del percorso
 * Solo HTML: nessuno stato e nessun accesso ai dati dell'app. app.js passa uno
 * snapshot ({ stato, esito, opzioni, modo, ... }) e la funzione che risolve i
 * nomi delle fermate, così il rendering resta isolato e verificabile a parte.
 */
(function (globale) {
  'use strict';

  const Icone = typeof require === 'function' ? require('./icone') : globale.Icone;
  const ICONA_PEDANA = Icone.svg('footprints', 16);

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

  function cambiTesto(n) {
    return n === 0 ? 'diretto' : (n === 1 ? '1 cambio' : n + ' cambi');
  }

  /** Comandi data/ora sopra il percorso. */
  function controlli(giorno, orario, modo) {
    const arrivo = modo === 'arrivo';
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
      '</div>';
  }

  function piediHTML(testo) {
    return '<div class="piedi">' + ICONA_PEDANA + '<span>' + testo + '</span></div>';
  }

  function piediBadge(secondi) {
    const minutiPiedi = Math.max(1, Math.round(secondi / 60));
    return '<span class="opzione-piedi" title="A piedi ' + minutiPiedi + ' min" aria-label="A piedi ' +
      minutiPiedi + ' min">' + ICONA_PEDANA + '</span>';
  }

  // Sequenza compatta dei modi: piedi → linea → piedi → linea → piedi.
  // Le linee non vengono più accorpate per nome, così un cambio bus/treno
  // resta visibile nell'ordine in cui avviene.
  function modiHTML(e) {
    const pezzi = [];
    if (e.camminoIniziale > 0) pezzi.push(piediBadge(e.camminoIniziale));
    e.tappe.forEach((tappa) => {
      if (tappa.camminoPrima && tappa.camminoPrima.secondi > 0) {
        pezzi.push(piediBadge(tappa.camminoPrima.secondi));
      }
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      const stile = !treno && tappa.colore
        ? ' style="background:' + esc(tappa.colore) + ';color:' + esc(tappa.coloreTesto || '#FFFFFF') + '"'
        : '';
      pezzi.push('<span class="opzione-linea' + (treno ? ' treno' : '') + '"' + stile + '>' + esc(tappa.linea) + '</span>');
    });
    if (e.camminoFinale > 0) pezzi.push(piediBadge(e.camminoFinale));
    return pezzi.slice(0, 9).join('');
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
        html += '<div class="cambio">Cambio' + (attesa >= 1 ? ' · ' + attesa + ' min di attesa' : '') + '</div>';
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
        '<div class="corsa-info">' + (treno ? 'Tratta ferroviaria' : tappa.fermate + ' ' + (tappa.fermate === 1 ? 'fermata' : 'fermate')) + ' · ' + durata + ' min</div>' +
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
      return '<div class="box-messaggio errore">Non riesco a calcolare il percorso (' + esc(vista.errore) + '). Controlla la connessione e riprova.' +
        '<button class="btn btn-secondario" data-azione="riprova-percorso">Riprova</button></div>';
    }
    if (vista.stato === 'piedi') {
      return '<div class="box-messaggio">Partenza e arrivo distano ' + vista.piedi.metri + ' m: ci arrivi a piedi in circa ' +
        vista.piedi.minuti + ' min.</div>';
    }
    if (vista.stato === 'messaggio') {
      const codice = vista.esito && vista.esito.errore;
      let testo = 'Percorso non disponibile per queste fermate.';
      if (codice === 'senza-orari') testo = 'Nessuna fermata con orari nel raggio di 500 m: questa stazione non ha corse disponibili (per alcune linee ferroviarie locali non esiste un GTFS aperto). Scegli una fermata bus vicina.';
      return '<div class="box-messaggio">' + esc(testo) + '</div>';
    }
    if (vista.stato === 'nessuno') {
      const testo = vista.modo === 'arrivo'
        ? 'Nessun collegamento arriva entro le ' + esc(vista.orario || '') + '. Prova a spostare l\'orario o il giorno.'
        : 'Nessun collegamento trovato a quest\'ora: di domenica e in tarda serata il servizio urbano è ridotto. Prova un altro orario o un giorno feriale.';
      return '<div class="box-messaggio">' + testo +
        '<button class="btn btn-secondario" data-azione="prova-domani">Prova domani alle 08:00</button></div>';
    }

    const opzioni = vista.opzioni && vista.opzioni.length ? vista.opzioni : [vista.esito];
    let html = '<div class="opzioni">' +
      opzioni.map((e, indice) => opzioneHTML(e, indice, vista, etichetta)).join('') + '</div>';
    html += '<div class="avviso nota-tracciato" id="nota-tracciato" hidden>' +
      Icone.svg('triangle-alert', 16) +
      '<span>Senza tracciato GTFS per un tratto: sulla mappa è una <b>linea diritta tratteggiata</b> tra le fermate, non il percorso reale del bus.</span></div>' +
      '<p class="nota-piccola">Orari programmati: possibili variazioni.</p>';
    return html;
  }

  const API = {
    controlli: controlli,
    esito: esito,
    ICONA_PEDANA: ICONA_PEDANA
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.VistaPercorso = API;
})(typeof window !== 'undefined' ? window : globalThis);
