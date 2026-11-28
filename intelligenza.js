/* ------------------------------------------------------------------------- *
 * intelligenza.js — i conti dei livelli 1–4, senza rete e senza ML.
 *
 * Tutto qui dentro è puro: riceve dati già letti (tappe di un percorso,
 * osservazioni dello storico, meteo, ora) e restituisce numeri o piccoli
 * oggetti. Niente DOM, niente fetch, niente localStorage: così i pesi si
 * possono provare uno per uno e, se un dato manca, ogni funzione risponde
 * "nessun aggiustamento" invece di bloccare il percorso.
 *
 * Regola: un dato che non c'è vale zero, mai una stima inventata.
 * ------------------------------------------------------------------------- */
(function (globale) {
  'use strict';

  // Pesi in secondi equivalenti (Parte 7.1). Un unico posto da tarare.
  const PESI = {
    CAMBIO: 300,
    CAMMINO: 1.3,
    ATTESA: 0.6,
    RITARDO: 1.0,
    AFFIDABILITA: 120
  };

  const SOGLIE = {
    RITARDO_VISIBILE: 120,      // sotto i 2 minuti non si mostra nulla
    RITARDO_ABBANDONO: 900,     // oltre 15 min la corsa è da scartare
    OSSERVAZIONI_MINIME: 5,     // sotto, l'affidabilità resta neutra
    OSSERVAZIONI_MAX: 500,
    GIORNI_STORICO: 30,
    RITARDO_MASSIMO: 1800       // oltre mezz'ora è rumore, non ritardo
  };

  /* ------------------------------------------------------------------ *
   * Livello 1 — ritardo reale e cambi a rischio
   * ------------------------------------------------------------------ */

  // Probabilità di perdere un cambio dato il buffer effettivo (Parte 2.2).
  // Le soglie sono quelle del prompt: 60/120/180 secondi.
  function probabilitaCambio(bufferSecondi) {
    const buffer = Number(bufferSecondi);
    if (!Number.isFinite(buffer)) return 0;
    if (buffer < 60) return 0.9;
    if (buffer < 120) return 0.7;
    if (buffer < 180) return 0.4;
    return 0.05;
  }

  // Buffer effettivo = attesa prevista meno il ritardo già accumulato dalla
  // corsa che arriva. Il ritardo live, se c'è, mangia il buffer.
  function bufferEffettivo(tappaArrivo, tappaPartenza) {
    if (!tappaArrivo || !tappaPartenza) return null;
    const arrivo = Number(tappaArrivo.arrivo);
    const partenza = Number(tappaPartenza.partenza);
    if (!Number.isFinite(arrivo) || !Number.isFinite(partenza)) return null;
    const ritardo = Number(tappaArrivo.ritardoLive);
    return partenza - arrivo - (Number.isFinite(ritardo) && ritardo > 0 ? ritardo : 0);
  }

  // Elenca solo i cambi che rischiano davvero: sotto il 50% non è un
  // problema da mostrare, è la normalità di un cambio fatto bene.
  function rischioCambi(tappe) {
    const rischi = [];
    if (!Array.isArray(tappe)) return rischi;
    for (let i = 0; i < tappe.length - 1; i += 1) {
      const buffer = bufferEffettivo(tappe[i], tappe[i + 1]);
      if (buffer === null) continue;
      const probabilita = probabilitaCambio(buffer);
      if (probabilita <= 0.5) continue;
      const ritardo = Number(tappe[i] && tappe[i].ritardoLive);
      rischi.push({
        indice: i,
        buffer,
        probabilita,
        motivo: Number.isFinite(ritardo) && ritardo > 0
          ? 'ritardo di ' + Math.round(ritardo / 60) + ' min sulla corsa che arriva'
          : 'attesa di ' + Math.round(buffer / 60) + ' min: troppo poca'
      });
    }
    return rischi;
  }

  // Ritardo che si propaga alle tappe successive: chi arriva in ritardo parte
  // in ritardo, e il ritardo si somma finché non c'è margine per recuperarlo.
  function ritardoCascata(tappe) {
    if (!Array.isArray(tappe)) return 0;
    let accumulato = 0;
    tappe.forEach((tappa) => {
      const live = Number(tappa && tappa.ritardoLive);
      if (Number.isFinite(live) && live > 0) accumulato = Math.max(accumulato, live);
    });
    return accumulato;
  }

  // `null` e `undefined` non sono zero: sono «HelloBus non ha risposto per
  // questa corsa». Confonderli con zero faceva sembrare in orario un viaggio
  // di cui conoscevamo una tappa sola.
  function haRitardo(tappa) {
    if (!tappa || tappa.ritardoLive == null || tappa.ritardoLive === '') return false;
    return Number.isFinite(Number(tappa.ritardoLive));
  }

  // 1 = tutto in orario, 0.2 = ritardo grave o cambio a rischio, null = non
  // abbiamo ricevuto niente da HelloBus per nessuna tappa.
  function affidabilitaRealtime(tappe) {
    if (!Array.isArray(tappe) || !tappe.length) return null;
    const conDato = tappe.filter(haRitardo);
    if (!conDato.length) return null;
    const ritardi = conDato.map((t) => Math.max(0, Number(t.ritardoLive)));
    const massimo = Math.max.apply(null, ritardi);
    const gravi = ritardi.filter((r) => r > 300).length;
    const rischi = rischioCambi(tappe).length;
    if (massimo > 600 || rischi > 0) return 0.2;
    if (massimo > 120 || gravi > 1) return 0.5;
    if (massimo > 0) return 0.8;
    return 1;
  }

  // Quante corse bus hanno davvero un ritardo noto. Serve a non spacciare per
  // «in orario» un viaggio in cui HelloBus ha risposto solo per una tappa.
  function coperturaRealtime(tappe) {
    if (!Array.isArray(tappe)) return { corse: 0, note: 0, completa: false };
    const bus = tappe.filter((t) => t && t.tipo !== 1 && t.tipo !== 2);
    const note = bus.filter(haRitardo).length;
    return { corse: bus.length, note: note, completa: bus.length > 0 && note === bus.length };
  }

  // Una corsa si scarta se è troppo in ritardo per essere ancora quella che
  // l'utente aspetta, o se HelloBus dice che la linea non è gestita.
  function corsaDaScartare(tappa) {
    if (!tappa) return false;
    if (tappa.nonGestita === true || tappa.cancellata === true) return true;
    const ritardo = Number(tappa.ritardoLive);
    return Number.isFinite(ritardo) && ritardo > SOGLIE.RITARDO_ABBANDONO;
  }

  /* ------------------------------------------------------------------ *
   * Livello 2 — storico locale, mediana e dispersione
   * ------------------------------------------------------------------ */

  function mediana(valori) {
    if (!valori.length) return null;
    const ordinati = valori.slice().sort((a, b) => a - b);
    const mezzo = Math.floor(ordinati.length / 2);
    return ordinati.length % 2 ? ordinati[mezzo] : (ordinati[mezzo - 1] + ordinati[mezzo]) / 2;
  }

  // Mediana e MAD invece di media e deviazione standard: un bus in ritardo di
  // mezz'ora non deve spostare la stima di tutti gli altri giorni.
  function statistiche(osservazioni) {
    const valori = (Array.isArray(osservazioni) ? osservazioni : [])
      .map((o) => Number(o && o.ritardo))
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.max(-300, Math.min(SOGLIE.RITARDO_MASSIMO, v)))
      .slice(-SOGLIE.OSSERVAZIONI_MAX);
    if (!valori.length) return { n: 0, mediana: null, mad: null, affidabilita: 0.5, ritardoPrevisto: null };
    const m = mediana(valori);
    const scarti = valori.map((v) => Math.abs(v - m));
    const mad = mediana(scarti);
    let affidabilita = 0.5;
    if (valori.length >= SOGLIE.OSSERVAZIONI_MINIME) {
      if (mad <= 60) affidabilita = 0.95;
      else if (mad <= 180) affidabilita = 0.75;
      else if (mad <= 300) affidabilita = 0.55;
      else affidabilita = 0.3;
    }
    return { n: valori.length, mediana: m, mad, affidabilita, ritardoPrevisto: m };
  }

  // Aggiunge un'osservazione tenendo il tetto e scartando le più vecchie.
  // Nessuna coordinata, nessun identificativo di dispositivo: solo linea,
  // giorno, ora e ritardo, come chiede la Parte 8.
  function registraOsservazione(elenco, osservazione, adesso) {
    const ora = Number.isFinite(Number(adesso)) ? Number(adesso) : Date.now();
    const lista = (Array.isArray(elenco) ? elenco : []).filter((o) => o && Number.isFinite(Number(o.ritardo)));
    const ritardo = Math.max(-300, Math.min(SOGLIE.RITARDO_MASSIMO, Number(osservazione && osservazione.ritardo)));
    if (!Number.isFinite(ritardo)) return lista;
    lista.push({
      linea: String((osservazione && osservazione.linea) || ''),
      giorno: Number((osservazione && osservazione.giorno) || 0),
      ora: Number((osservazione && osservazione.ora) || 0),
      ritardo,
      ts: ora
    });
    const limite = ora - SOGLIE.GIORNI_STORICO * 24 * 3600 * 1000;
    return lista.filter((o) => o.ts >= limite).slice(-SOGLIE.OSSERVAZIONI_MAX);
  }

  // Statistiche della linea: prima la fascia oraria, poi il giorno intero.
  function statisticheLinea(elenco, linea, giorno, ora) {
    const dellaLinea = (Array.isArray(elenco) ? elenco : []).filter((o) => o && String(o.linea) === String(linea));
    if (!dellaLinea.length) return null;
    const perFascia = dellaLinea.filter((o) => Number(o.giorno) === Number(giorno) && Number(o.ora) === Number(ora));
    if (perFascia.length) return statistiche(perFascia);
    const perGiorno = dellaLinea.filter((o) => Number(o.giorno) === Number(giorno));
    if (perGiorno.length) return statistiche(perGiorno);
    return statistiche(dellaLinea);
  }

  /* ------------------------------------------------------------------ *
   * Livello 3 — contesto: meteo, ora, giorno, eventi
   * ------------------------------------------------------------------ */

  const FESTIVI = {
    // Calcolati per anno: Pasqua con l'algoritmo di Gauss, le altre sono fisse.
    2026: ['2026-01-01', '2026-01-06', '2026-04-06', '2026-04-25', '2026-05-01', '2026-06-02', '2026-08-15', '2026-11-01', '2026-12-08', '2026-12-25', '2026-12-26'],
    2027: ['2027-01-01', '2027-01-06', '2027-03-29', '2027-04-25', '2027-05-01', '2027-06-02', '2027-08-15', '2027-11-01', '2027-12-08', '2027-12-25', '2027-12-26']
  };

  function isoData(data) {
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return null;
    const mese = String(d.getMonth() + 1).padStart(2, '0');
    const giorno = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mese + '-' + giorno;
  }

  function festivo(data) {
    const iso = isoData(data);
    if (!iso) return false;
    const anno = FESTIVI[Number(iso.slice(0, 4))];
    return !!(anno && anno.indexOf(iso) !== -1);
  }

  function oraDi(data) {
    const d = data instanceof Date ? data : new Date(data);
    return Number.isNaN(d.getTime()) ? null : d.getHours();
  }

  // Aggiustamento meteo in secondi. Pioggia e vento pesano sul cammino, il
  // caldo e il freddo sull'attesa: sono i due pezzi che l'utente sente.
  function aggiustamentoMeteo(meteo, camminoMetri, attesaSecondi) {
    if (!meteo || typeof meteo !== 'object') return 0;
    const pioggia = Number(meteo.precipitazione);
    const vento = Number(meteo.vento);
    const temperatura = Number(meteo.temperatura);
    const cammino = Math.max(0, Number(camminoMetri) || 0);
    const attesa = Math.max(0, Number(attesaSecondi) || 0);
    let extra = 0;
    if (Number.isFinite(pioggia) && pioggia > 0.5 && cammino > 500) extra += cammino * 0.5 * 0.9;
    if (Number.isFinite(vento) && vento > 30) extra += cammino * 0.2 * 0.9;
    if (Number.isFinite(temperatura) && (temperatura > 35 || temperatura < 0)) extra += attesa * 0.2;
    return Math.round(extra);
  }

  // Rush hour e notte: non cambiano la verità del percorso, cambiano cosa
  // conviene. Valori in secondi, coerenti con i pesi.
  function aggiustamentoOra(data, cambi, attesaSecondi) {
    const ora = oraDi(data);
    if (ora === null) return 0;
    const nCambi = Math.max(0, Number(cambi) || 0);
    const attesa = Math.max(0, Number(attesaSecondi) || 0);
    let extra = 0;
    const rush = (ora >= 7 && ora <= 9) || (ora >= 17 && ora <= 19);
    if (rush) extra += Math.max(0, nCambi - 1) * 60;
    if (ora >= 22 || ora <= 6) {
      if (attesa > 900) extra += 120;
    }
    return extra;
  }

  // Eventi e disruzioni: si scarta una soluzione se tocca una fermata chiusa
  // o una linea deviata dentro la finestra dell'evento.
  function dentroFinestra(evento, quando) {
    if (!evento || !evento.data) return false;
    const data = quando instanceof Date ? quando : new Date(quando);
    if (Number.isNaN(data.getTime())) return false;
    if (isoData(data) !== String(evento.data)) return false;
    const ora = oraDi(data);
    if (ora === null) return true;
    const inizio = evento.ora_inizio ? Number(String(evento.ora_inizio).split(':')[0]) : 0;
    const fine = evento.ora_fine ? Number(String(evento.ora_fine).split(':')[0]) : 24;
    return ora >= inizio && ora < fine;
  }

  function disturboAttivo(eventi, quando) {
    const lista = Array.isArray(eventi) ? eventi : [];
    return lista.filter((evento) => dentroFinestra(evento, quando));
  }

  function toccaDisturbo(tappe, disturbi) {
    const colpiti = [];
    (Array.isArray(tappe) ? tappe : []).forEach((tappa) => {
      const linee = (disturbi || []).reduce((acc, d) => acc.concat(d.linee_deviate || []), []);
      const fermate = (disturbi || []).reduce((acc, d) => acc.concat(d.fermate_chiuse || []), []);
      const linea = String((tappa && tappa.linea) || '');
      const fermata = String((tappa && (tappa.fermataId || tappa.id)) || '');
      if (linee.indexOf(linea) !== -1) colpiti.push({ tipo: 'linea', valore: linea });
      if (fermata && fermate.indexOf(fermata) !== -1) colpiti.push({ tipo: 'fermata', valore: fermata });
    });
    return colpiti;
  }

  /* ------------------------------------------------------------------ *
   * Punteggio unificato
   * ------------------------------------------------------------------ */

  function punteggioCombinato(base) {
    const b = base && typeof base === 'object' ? base : {};
    const numero = (valore) => (Number.isFinite(Number(valore)) ? Number(valore) : 0);
    let totale = numero(b.tempoTotale);
    totale += numero(b.cambi) * PESI.CAMBIO;
    totale += numero(b.metriCammino) * PESI.CAMMINO;
    totale += numero(b.tempoAttesa) * PESI.ATTESA;
    totale += numero(b.ritardoLive) * PESI.RITARDO;
    if (Number.isFinite(Number(b.affidabilita))) {
      totale += (0.5 - Number(b.affidabilita)) * PESI.AFFIDABILITA;
    }
    totale += numero(b.aggiustamentoMeteo) + numero(b.aggiustamentoOra) + numero(b.aggiustamentoPersonale);
    return Math.round(totale);
  }

  /* ------------------------------------------------------------------ *
   * Livello 5 — quale suggerimento mostrare
   * ------------------------------------------------------------------ */

  // Priorità della Parte 6.2: prima "il bus è passato", poi "sta arrivando",
  // poi il cambio a rischio, e così via. Uno solo, il più urgente.
  const PRIORITA_SUGGERIMENTI = ['N5', 'N2', 'N3', 'N1', 'N4', 'N6', 'N7', 'N8'];

  function scegliSuggerimento(candidati, ignorati) {
    const scartati = {};
    (Array.isArray(ignorati) ? ignorati : []).forEach((tipo) => {
      if (Number(tipo && tipo.volte) >= 3) scartati[tipo.tipo] = true;
    });
    const validi = (Array.isArray(candidati) ? candidati : [])
      .filter((c) => c && c.tipo && c.testo && !scartati[c.tipo]);
    if (!validi.length) return null;
    return validi.slice().sort((a, b) => {
      const pa = PRIORITA_SUGGERIMENTI.indexOf(a.tipo);
      const pb = PRIORITA_SUGGERIMENTI.indexOf(b.tipo);
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    })[0];
  }

  function registraIgnorato(elenco, tipo) {
    const lista = (Array.isArray(elenco) ? elenco : []).filter((v) => v && v.tipo);
    const trovato = lista.filter((v) => v.tipo === tipo)[0];
    if (trovato) {
      trovato.volte = Number(trovato.volte || 0) + 1;
      return lista;
    }
    lista.push({ tipo, volte: 1 });
    return lista;
  }

  // Una spiegazione breve, al massimo due motivi, solo se le soluzioni
  // differiscono davvero (Parte 7.2).
  function spiegaConfronto(scelta, altra) {
    if (!scelta || !altra) return '';
    const motivi = [];
    const cambi = Number(altra.cambi || 0) - Number(scelta.cambi || 0);
    const cammino = Number(altra.metriCammino || 0) - Number(scelta.metriCammino || 0);
    const arrivo = Number(altra.arrivo || 0) - Number(scelta.arrivo || 0);
    if (cambi > 0) motivi.push(cambi + (cambi === 1 ? ' cambio in meno' : ' cambi in meno'));
    if (cammino > 200) motivi.push(Math.round(cammino / 100) / 10 + ' km a piedi in meno');
    if (arrivo > 300) motivi.push('arrivi ' + Math.round(arrivo / 60) + ' min prima');
    return motivi.slice(0, 2).join(' · ');
  }

  const API = {
    PESI,
    SOGLIE,
    probabilitaCambio,
    bufferEffettivo,
    rischioCambi,
    ritardoCascata,
    affidabilitaRealtime,
    coperturaRealtime,
    corsaDaScartare,
    mediana,
    statistiche,
    registraOsservazione,
    statisticheLinea,
    festivo,
    aggiustamentoMeteo,
    aggiustamentoOra,
    disturboAttivo,
    toccaDisturbo,
    punteggioCombinato,
    scegliSuggerimento,
    registraIgnorato,
    spiegaConfronto,
    PRIORITA_SUGGERIMENTI
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Intelligenza = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
