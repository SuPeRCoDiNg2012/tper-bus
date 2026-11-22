/* TPER Zone Calc — scheda del percorso
 * Solo HTML: nessuno stato e nessun accesso ai dati dell'app. app.js passa uno
 * snapshot ({ stato, esito, errore, piedi }) e la funzione che risolve i nomi
 * delle fermate, così il rendering resta isolato e verificabile a parte.
 */
(function (globale) {
  'use strict';

  const ICONA_PEDANA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4" r="2"/><path d="M11 7h2.2l1.3 4.3H19v1.8h-4.4l-.6-2H13v5.2a4.2 4.2 0 1 1-2-3.6V7z"/></svg>';

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

  /** Comandi data/ora sopra il percorso. */
  function controlli(giorno, orario) {
    return '<div class="quando">' +
      '<input id="input-data" type="date" value="' + esc(giorno) + '" aria-label="Giorno di partenza">' +
      '<span class="sep"></span>' +
      '<input id="input-ora" type="time" step="300" value="' + esc(orario) + '" aria-label="Ora di partenza">' +
      '<button type="button" class="adesso" data-azione="ora-adesso">Adesso</button></div>';
  }

  function piediHTML(testo) {
    return '<div class="piedi">' + ICONA_PEDANA + '<span>' + testo + '</span></div>';
  }

  /**
   * Corpo della scheda: scheletro, errore, avvisi, nessun collegamento oppure
   * il viaggio completo con cambi e tratti a piedi.
   * @param vista { stato, esito, errore, piedi }
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
      if (codice === 'senza-orari') testo = 'Nessuna fermata con orari bus nel raggio di 500 m: le stazioni ferroviarie e i pali senza corse non hanno orari. Scegli una fermata vicina.';
      return '<div class="box-messaggio">' + esc(testo) + '</div>';
    }
    if (vista.stato === 'nessuno') {
      return '<div class="box-messaggio">Nessun collegamento trovato a quest\'ora: di domenica e in tarda serata il servizio urbano è ridotto. Prova un altro orario o un giorno feriale.' +
        '<button class="btn btn-secondario" data-azione="prova-domani">Prova domani alle 08:00</button></div>';
    }

    const e = vista.esito;
    const uscita = Math.max(0, e.partenza - e.camminoIniziale);
    const totale = minuti(e.arrivo - uscita);
    const cambi = e.cambi === 0 ? 'diretto' : (e.cambi === 1 ? '1 cambio' : e.cambi + ' cambi');
    const piedi = Math.round((e.camminoIniziale + e.camminoFinale) / 60);
    const extra = piedi >= 1 ? ' · ' + piedi + ' min a piedi' : '';

    let html = '<div class="riepilogo"><div class="riep-orari">' + hhmm(uscita) +
      '<span class="freccia">→</span>' + hhmm(e.arrivo) + '</div>' +
      '<div class="riep-durata"><b>' + totale + ' min</b>' + cambi + esc(extra) + '</div></div>';
    html += '<div class="viaggio">';

    if (e.camminoIniziale > 0) {
      html += piediHTML('A piedi <b>' + minuti(e.camminoIniziale) + ' min</b>');
    }
    e.tappe.forEach((tappa, indice) => {
      if (indice > 0) {
        const attesa = Math.round(tappa.attesa / 60);
        html += '<div class="cambio">Cambio' + (attesa >= 1 ? ' · ' + attesa + ' min di attesa' : '') + '</div>';
      }
      const durata = minuti(tappa.arrivo - tappa.partenza);
      const treno = tappa.tipo === 1 || tappa.tipo === 2;
      html += '<div class="corsa">' +
        '<span class="corsa-badge' + (treno ? ' treno' : '') + '">' + esc(tappa.linea) + '</span>' +
        '<div class="corsa-corpo">' +
        '<div class="corsa-riga"><span class="corsa-ora">' + hhmm(tappa.partenza) + '</span><span class="corsa-fermata">' + esc(etichetta(tappa.da)) + '</span></div>' +
        '<div class="corsa-info">' + tappa.fermate + ' ' + (tappa.fermate === 1 ? 'fermata' : 'fermate') + ' · ' + durata + ' min</div>' +
        '<div class="corsa-riga"><span class="corsa-ora">' + hhmm(tappa.arrivo) + '</span><span class="corsa-fermata">' + esc(etichetta(tappa.a)) + '</span></div>' +
        '</div></div>';
    });
    if (e.camminoFinale > 0) {
      html += piediHTML('A piedi <b>' + minuti(e.camminoFinale) + ' min</b> fino a destinazione');
    }
    html += '</div>' +
      '<div class="avviso nota-tracciato" id="nota-tracciato" hidden>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.2 21 19.8H3L12 4.2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="16.6" r=".95" fill="currentColor"/></svg>' +
      '<span>Senza tracciato GTFS per un tratto: sulla mappa è una <b>linea diritta tratteggiata</b> tra le fermate, non il percorso reale del bus.</span></div>' +
      '<p class="nota-piccola">Orari programmati: possibili variazioni.</p>';
    return html;
  }

  globale.VistaPercorso = {
    controlli: controlli,
    esito: esito,
    ICONA_PEDANA: ICONA_PEDANA
  };
})(window);
