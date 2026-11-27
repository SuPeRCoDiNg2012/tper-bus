/* Muovi Bologna — rifiniture trasversali
 * Logica pura, senza DOM: la usa l'app e la verifica tests/utilita.test.js.
 */
(function (globale) {
  'use strict';

  /* Timeout per tipo di chiamata: un file di orari da 280 KB non può avere lo
   * stesso tempo di un elenco di fermate, e Nominatim va lasciato libero. */
  const TIMEOUT = {
    fermate: 10000,
    orari: 15000,
    nominatim: 5000,
    osrm: 8000,
    hellobus: 9000
  };

  /* Cache locali rigenerabili: si possono buttare senza perdere nulla di
   * scritto dall'utente (recenti, tratta, abbonamento restano). */
  const CACHE_RIGENERABILI = ['tperzc_snap_v4', 'tperzc_piedi_v4', 'tperzc_storico_ritardi_v2'];
  const SOGLIA_CACHE = 3.5 * 1024 * 1024;

  function canale(valore) {
    const v = valore / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminanza(hex) {
    const pulito = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(pulito)) return null;
    const r = parseInt(pulito.slice(0, 2), 16);
    const g = parseInt(pulito.slice(2, 4), 16);
    const b = parseInt(pulito.slice(4, 6), 16);
    return 0.2126 * canale(r) + 0.7152 * canale(g) + 0.0722 * canale(b);
  }

  /** Rapporto di contrasto WCAG fra due colori esadecimali (1–21). */
  function contrasto(a, b) {
    const la = luminanza(a);
    const lb = luminanza(b);
    if (la == null || lb == null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * Testo leggibile sopra un badge colorato: si sceglie fra bianco e nero il
   * colore con il contrasto migliore, così un giallo o un verde chiaro non
   * restano con testo bianco illeggibile.
   */
  function testoSuColore(sfondo, preferito) {
    if (contrasto(sfondo, '#FFFFFF') == null) return preferito || '#FFFFFF';
    const bianco = contrasto(sfondo, '#FFFFFF');
    const nero = contrasto(sfondo, '#1A1A1A');
    if (bianco >= 4.5 || nero >= 4.5) return bianco >= nero ? '#FFFFFF' : '#1A1A1A';
    return bianco >= nero ? '#FFFFFF' : '#1A1A1A';
  }

  /**
   * Chiavi da svuotare quando il localStorage è troppo pieno. `misure` è una
   * mappa chiave → byte stimati. Si svuota solo il necessario, partendo dalle
   * cache rigenerabili, così i dati dell'utente restano.
   */
  function cacheDaSvuotare(misure, soglia) {
    const limite = typeof soglia === 'number' ? soglia : SOGLIA_CACHE;
    const mappa = misure || {};
    let totale = 0;
    Object.keys(mappa).forEach((chiave) => { totale += Number(mappa[chiave]) || 0; });
    const svuotate = [];
    CACHE_RIGENERABILI.forEach((chiave) => {
      if (totale <= limite) return;
      if (mappa[chiave]) {
        totale -= Number(mappa[chiave]) || 0;
        svuotate.push(chiave);
      }
    });
    return svuotate;
  }

  /** L'invito all'installazione arriva al terzo uso e non si ripete. */
  function deveMostrareInvito(uso, visto, installata) {
    if (installata) return false;
    if (visto) return false;
    return Number(uso || 0) >= 3;
  }

  function timeoutPer(tipo) {
    return TIMEOUT[tipo] || TIMEOUT.fermate;
  }

  /**
   * Durata leggibile: sotto l'ora restano i minuti, sopra si passa a «1h» o
   * «2h e 35min». Evita i «95 min» che costringono a fare il conto a mente.
   */
  function durata(minuti) {
    const totali = Math.max(0, Math.round(Number(minuti) || 0));
    if (totali < 60) return totali + ' min';
    const ore = Math.floor(totali / 60);
    const resto = totali % 60;
    return resto ? ore + 'h e ' + resto + 'min' : ore + 'h';
  }

  /**
   * Douglas-Peucker su una linea di coordinate [lon, lat]. Toglie i punti che
   * stanno entro `tolleranza` (in gradi) dalla retta fra i due estremi: la
   * geometria GTFS ha un vertice ogni pochi metri e senza questo le linee
   * sulla mappa sembrano tremolanti. Gli estremi restano sempre.
   */
  function semplifica(punti, tolleranza) {
    if (!Array.isArray(punti) || punti.length < 3) return (punti || []).slice();
    const soglia = Math.max(0, Number(tolleranza) || 0);
    const quadrato = soglia * soglia;
    const distanza = (p, a, b) => {
      let x = a[0];
      let y = a[1];
      let dx = b[0] - x;
      let dy = b[1] - y;
      if (dx !== 0 || dy !== 0) {
        const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p[0] - x;
      dy = p[1] - y;
      return dx * dx + dy * dy;
    };
    const tenuti = [punti[0]];
    const passo = (primo, ultimo) => {
      let massimo = 0;
      let indice = 0;
      for (let i = primo + 1; i < ultimo; i += 1) {
        const d = distanza(punti[i], punti[primo], punti[ultimo]);
        if (d > massimo) { massimo = d; indice = i; }
      }
      if (massimo > quadrato) {
        if (indice - primo > 1) passo(primo, indice);
        tenuti.push(punti[indice]);
        if (ultimo - indice > 1) passo(indice, ultimo);
      }
    };
    passo(0, punti.length - 1);
    tenuti.push(punti[punti.length - 1]);
    return tenuti;
  }

  /**
   * Involucro convesso (monotone chain) di punti [lon, lat]: il poligono più
   * piccolo che contiene tutte le fermate di una zona. Restituisce l'anello
   * senza ripetere il primo punto; con meno di tre punti non è un'area.
   */
  function involucro(punti) {
    const elenco = (punti || [])
      .filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
      .map((p) => [Number(p[0]), Number(p[1])])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const unici = [];
    elenco.forEach((p) => {
      const ultimo = unici[unici.length - 1];
      if (!ultimo || p[0] !== ultimo[0] || p[1] !== ultimo[1]) unici.push(p);
    });
    if (unici.length < 3) return unici;
    // Due catene, bassa e alta: la svolta non deve mai essere oraria.
    const catena = (punti) => {
      const pila = [];
      punti.forEach((p) => {
        while (pila.length >= 2) {
          const a = pila[pila.length - 2];
          const b = pila[pila.length - 1];
          const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          if (cross <= 0) pila.pop();
          else break;
        }
        pila.push(p);
      });
      pila.pop();
      return pila;
    };
    const anello = catena(unici).concat(catena(unici.slice().reverse()));
    const visti = new Set();
    return anello.filter((p) => {
      const chiave = p[0] + ',' + p[1];
      if (visti.has(chiave)) return false;
      visti.add(chiave);
      return true;
    });
  }

  /**
   * Raggruppa punti [lon, lat] vicini: due punti stanno nello stesso gruppo se
   * una catena di distanze li collega entro `metri`. Serve alle aree delle zone
   * tariffarie: una zona con fermate sparse non deve diventare un unico
   * triangolo che attraversa mezza provincia.
   */
  function raggruppa(punti, metri) {
    const elenco = (punti || [])
      .filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
      .map((p) => [Number(p[0]), Number(p[1])]);
    const n = elenco.length;
    if (!n) return [];
    if (n < 2) return [elenco];
    const raggio = Math.max(1, Number(metri) || 0);
    // Una cella è un quadrato di `raggio` metri in latitudine; la longitudine
    // viene schiacciata di cos(lat) così anche lì la cella misura lo stesso.
    const lato = raggio / 111320;
    const lat0 = elenco.reduce((somma, p) => somma + p[1], 0) / n;
    const compressione = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
    const piatte = elenco.map((p) => [p[0] * compressione, p[1]]);
    const padre = elenco.map((_, i) => i);
    const radice = (i) => {
      let r = i;
      while (padre[r] !== r) r = padre[r];
      while (padre[i] !== r) {
        const dopo = padre[i];
        padre[i] = r;
        i = dopo;
      }
      return r;
    };
    const unisci = (a, b) => {
      const ra = radice(a);
      const rb = radice(b);
      if (ra !== rb) padre[rb] = ra;
    };
    const chiave = (x, y) => x + ':' + y;
    const celle = new Map();
    piatte.forEach((p, i) => {
      const k = chiave(Math.floor(p[0] / lato), Math.floor(p[1] / lato));
      if (!celle.has(k)) celle.set(k, []);
      celle.get(k).push(i);
    });
    piatte.forEach((p, i) => {
      const x = Math.floor(p[0] / lato);
      const y = Math.floor(p[1] / lato);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const lista = celle.get(chiave(x + dx, y + dy));
          if (!lista) continue;
          lista.forEach((j) => {
            if (j <= i) return;
            const ddx = piatte[j][0] - p[0];
            const ddy = piatte[j][1] - p[1];
            if (ddx * ddx + ddy * ddy <= lato * lato) unisci(i, j);
          });
        }
      }
    });
    const gruppi = new Map();
    elenco.forEach((p, i) => {
      const r = radice(i);
      if (!gruppi.has(r)) gruppi.set(r, []);
      gruppi.get(r).push(p);
    });
    return Array.from(gruppi.values());
  }

  /**
   * Anello di un cerchio geografico di `raggio` metri attorno a [lon, lat].
   * Serve alle aree delle zone: un cerchio non lascia buchi interni e resta
   * della stessa dimensione a ogni zoom. Restituisce i punti senza ripetere
   * il primo; con coordinate non valide restituisce un elenco vuoto.
   */
  function cerchio(centro, raggio, passi) {
    if (!Array.isArray(centro) || !isFinite(centro[0]) || !isFinite(centro[1])) return [];
    const metri = Number(raggio);
    if (!isFinite(metri) || metri <= 0) return [];
    const R = 6371000;
    const lat1 = (Number(centro[1]) * Math.PI) / 180;
    const lon1 = (Number(centro[0]) * Math.PI) / 180;
    const angolo = metri / R;
    const quanti = Math.max(12, Math.round(Number(passi) || 48));
    const anello = [];
    for (let i = 0; i < quanti; i += 1) {
      const direzione = (i * 2 * Math.PI) / quanti;
      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angolo) +
        Math.cos(lat1) * Math.sin(angolo) * Math.cos(direzione)
      );
      const lon2 = lon1 + Math.atan2(
        Math.sin(direzione) * Math.sin(angolo) * Math.cos(lat1),
        Math.cos(angolo) - Math.sin(lat1) * Math.sin(lat2)
      );
      anello.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    return anello;
  }

  /** Punto medio di coordinate [lon, lat]; null se non ce ne sono di valide. */
  function centroide(punti) {
    const elenco = (punti || [])
      .filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
      .map((p) => [Number(p[0]), Number(p[1])]);
    if (!elenco.length) return null;
    const somma = elenco.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [somma[0] / elenco.length, somma[1] / elenco.length];
  }

  // Abbreviazioni che si vedono davvero sui cartelli e nelle ricerche: senza
  // espanderle, «vle» o «p.za» non trovano niente.
  function espandi(testo) {
    return String(testo || '')
      .toLowerCase()
      .replace(/\bv\.?\s?le\b/g, 'viale')
      .replace(/\bv\.?\s?li\b/g, 'viali')
      .replace(/\bp\.?\s?zza\b/g, 'piazza')
      .replace(/\bp\.?\s?za\b/g, 'piazza')
      .replace(/\bstaz\.?(?=\s|$)/g, 'stazione')
      .replace(/\bosp\.?(?=\s|$)/g, 'ospedale')
      .replace(/\bstr\.?(?=\s|$)/g, 'strada');
  }

  // Distanza di Levenshtein a due righe: sufficiente per parole di un nome di
  // fermata e abbastanza economica da girare su tutte le fermate.
  function distanzaEdit(a, b) {
    const s = String(a || '');
    const t = String(b || '');
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    let precedente = new Array(t.length + 1);
    let corrente = new Array(t.length + 1);
    for (let j = 0; j <= t.length; j += 1) precedente[j] = j;
    for (let i = 1; i <= s.length; i += 1) {
      corrente[0] = i;
      for (let j = 1; j <= t.length; j += 1) {
        const costo = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
        corrente[j] = Math.min(precedente[j] + 1, corrente[j - 1] + 1, precedente[j - 1] + costo);
      }
      const scambio = precedente;
      precedente = corrente;
      corrente = scambio;
    }
    return precedente[t.length];
  }

  // «viale zamboni» contro «viale zamboni 2» sì, «bologna» contro «bolognina»
  // no: la soglia cresce con la lunghezza e vale per una parola o per il nome
  // intero, non per qualunque sottostringa.
  function vicina(nome, query) {
    const n = String(nome || '');
    const q = String(query || '').trim();
    if (!n || q.length < 4) return false;
    const soglia = q.length >= 10 ? 2 : 1;
    if (Math.abs(n.length - q.length) <= soglia && distanzaEdit(n, q) <= soglia) return true;
    return n.split(/[^a-z0-9]+/).some((parola) =>
      parola.length >= 3 && Math.abs(parola.length - q.length) <= soglia && distanzaEdit(parola, q) <= soglia
    );
  }

  /**
   * Coordinate dentro un testo o un link condiviso: Google Maps (`@lat,lon`,
   * `!3d…!4d…`, `q=lat,lon`), Apple Maps (`ll=`), OpenStreetMap (`mlat`/
   * `mlon`) e il formato `geo:lat,lon`. Restituisce null se non le trova.
   */
  function coordinateCondivise(testo) {
    const originale = String(testo || '');
    if (!originale) return null;
    let s = originale;
    try { s = decodeURIComponent(originale); } catch (errore) { /* resta com'è */ }
    const schemi = [
      /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
      /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
      /[?&](?:q|ll|center|query)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
      /geo:(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
      /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/
    ];
    for (let i = 0; i < schemi.length; i += 1) {
      const trovato = s.match(schemi[i]);
      if (!trovato) continue;
      const lat = parseFloat(trovato[1]);
      const lon = parseFloat(trovato[2]);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat: lat, lon: lon };
      }
    }
    const mlat = s.match(/[?&]mlat=(-?\d{1,2}(?:\.\d+)?)/);
    const mlon = s.match(/[?&]mlon=(-?\d{1,3}(?:\.\d+)?)/);
    if (mlat && mlon) {
      const lat = parseFloat(mlat[1]);
      const lon = parseFloat(mlon[1]);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat: lat, lon: lon };
      }
    }
    return null;
  }

  /**
   * Effetto dei ritardi sulle tappe: un ritardo su una corsa intermedia può
   * far perdere il cambio. `cambioDa` è la fermata da cui ripartire.
   */
  function analizzaRitardi(tappe, valori) {
    const corsa = Array.isArray(tappe) ? tappe : [];
    const scarti = Array.isArray(valori) ? valori : [];
    let noti = 0;
    let ultimo = 0;
    let cambioRischioso = false;
    let cambioPerso = false;
    let lineaPersa = '';
    let cambioDa = '';
    corsa.forEach((tappa, indice) => {
      const scarto = scarti[indice];
      if (scarto == null) return;
      noti += 1;
      const successiva = corsa[indice + 1];
      if (successiva) {
        const margine = successiva.partenza - tappa.arrivo;
        if (scarto > margine) {
          cambioPerso = true;
          lineaPersa = successiva.linea;
          cambioDa = successiva.da || '';
        } else if (margine - scarto < 120) {
          cambioRischioso = true;
        }
      } else if (scarto > 0) {
        ultimo = scarto;
      }
    });
    return {
      noti: noti, totale: corsa.length, ultimo: ultimo,
      cambioRischioso: cambioRischioso, cambioPerso: cambioPerso,
      lineaPersa: lineaPersa, cambioDa: cambioDa
    };
  }

  /** Da dove ripartire dopo un cambio perso: posizione, cambio, poi partenza. */
  function scegliOrigineRitardo(posizione, cambio) {
    if (posizione) return { tipo: 'posizione', luogo: posizione };
    if (cambio) return { tipo: 'cambio', luogo: cambio };
    return { tipo: 'partenza', luogo: null };
  }

  /** Testo utile di una condivisione, senza link né spazi doppi. */
  function testoCondiviso(testo) {
    return String(testo || '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  const API = {
    TIMEOUT: TIMEOUT,
    espandi: espandi,
    distanzaEdit: distanzaEdit,
    vicina: vicina,
    CACHE_RIGENERABILI: CACHE_RIGENERABILI,
    SOGLIA_CACHE: SOGLIA_CACHE,
    luminanza: luminanza,
    contrasto: contrasto,
    testoSuColore: testoSuColore,
    cacheDaSvuotare: cacheDaSvuotare,
    deveMostrareInvito: deveMostrareInvito,
    timeoutPer: timeoutPer,
    durata: durata,
    semplifica: semplifica,
    coordinateCondivise: coordinateCondivise,
    testoCondiviso: testoCondiviso,
    analizzaRitardi: analizzaRitardi,
    scegliOrigineRitardo: scegliOrigineRitardo,
    involucro: involucro,
    raggruppa: raggruppa,
    centroide: centroide,
    cerchio: cerchio
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Utilita = API;
})(typeof window !== 'undefined' ? window : globalThis);
