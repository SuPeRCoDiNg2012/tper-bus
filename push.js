/* Muovi Bologna — notifiche push vere (ad app chiusa).
 *
 * La pagina iscrive il browser al servizio push e consegna al Worker l'elenco
 * dei promemoria; il Worker li spedisce col suo cron. Senza ENDPOINT valido
 * tutto resta spento e l'app continua con le notifiche locali, senza chiedere
 * permessi in più.
 *
 * Per accenderlo: `node push/genera-chiavi.js`, deploy di push/wrangler.toml,
 * poi incolla qui l'URL del Worker. Vedi il CHANGELOG.
 */
(function (globale) {
  'use strict';

  // Base del Worker, senza slash finale. Vuota = funzione spenta.
  const ENDPOINT = 'https://muovi-bologna-push.zeno-astolfi12.workers.dev';
  const K_ATTIVO = 'tperzc_push_v1';

  let chiaveCache = null;
  let promemoriaInCoda = [];

  function base() {
    return String(ENDPOINT).replace(/\/+$/, '');
  }

  function configurato() {
    return !!base();
  }

  function supportato() {
    return typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      typeof Notification !== 'undefined';
  }

  function attivo() {
    if (!configurato() || !supportato()) return false;
    if (Notification.permission !== 'granted') return false;
    try {
      return localStorage.getItem(K_ATTIVO) === '1';
    } catch (errore) {
      return false;
    }
  }

  function b64uToBytes(testo) {
    const base64 = String(testo).replace(/-/g, '+').replace(/_/g, '/');
    const riempimento = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binario = atob(base64 + riempimento);
    const byte = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) byte[i] = binario.charCodeAt(i);
    return byte;
  }

  async function chiavePubblica() {
    if (chiaveCache) return chiaveCache;
    const risposta = await fetch(base() + '/config', { cache: 'no-store' });
    if (!risposta.ok) throw new Error('config ' + risposta.status);
    const dati = await risposta.json();
    if (!dati || !dati.chiave) throw new Error('chiave mancante');
    chiaveCache = b64uToBytes(dati.chiave);
    return chiaveCache;
  }

  async function chiama(rotta, corpo) {
    const risposta = await fetch(base() + rotta, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo)
    });
    if (!risposta.ok) throw new Error('push ' + rotta + ' ' + risposta.status);
    return risposta.json().catch(() => ({}));
  }

  async function sottoscrizione() {
    const registrazione = await navigator.serviceWorker.ready;
    return registrazione.pushManager.getSubscription();
  }

  async function attiva() {
    if (!configurato()) return { esito: 'non-configurato' };
    if (!supportato()) return { esito: 'non-supportato' };
    const permesso = await Notification.requestPermission();
    if (permesso !== 'granted') return { esito: permesso };
    let sotto;
    try {
      const chiave = await chiavePubblica();
      sotto = await sottoscrizione();
      if (!sotto) {
        const registrazione = await navigator.serviceWorker.ready;
        sotto = await registrazione.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: chiave
        });
      }
      await chiama('/iscrizione', { sottoscrizione: sotto.toJSON(), promemoria: promemoriaInCoda });
    } catch (errore) {
      return { esito: 'errore', dettaglio: String(errore && errore.message ? errore.message : errore) };
    }
    try {
      localStorage.setItem(K_ATTIVO, '1');
    } catch (e) {
      // Safari in navigazione privata: l'iscrizione vale per questa sessione.
    }
    return { esito: 'ok' };
  }

  async function spegni() {
    try {
      localStorage.removeItem(K_ATTIVO);
    } catch (e) { /* nulla da fare */ }
    const sotto = await sottoscrizione();
    if (!sotto) return { esito: 'ok' };
    try {
      await chiama('/disiscrizione', { sottoscrizione: sotto.toJSON() });
    } catch (errore) { /* il server la scarterà da solo */ }
    await sotto.unsubscribe();
    return { esito: 'ok' };
  }

  /**
   * Elenco dei promemoria da tenere sul Worker. Quando la funzione è attiva
   * l'elenco viene sincronizzato subito, così quello che l'app sa (l'ultima
   * corsa di stasera) arriva anche se poi l'app viene chiusa.
   */
  async function sincronizza(elenco) {
    promemoriaInCoda = Array.isArray(elenco) ? elenco.slice(0, 40) : [];
    if (!attivo()) return { esito: 'spento' };
    const sotto = await sottoscrizione();
    if (!sotto) return { esito: 'senza-sottoscrizione' };
    try {
      await chiama('/promemoria', { sottoscrizione: sotto.toJSON(), promemoria: promemoriaInCoda });
      return { esito: 'ok', quanti: promemoriaInCoda.length };
    } catch (errore) {
      return { esito: 'errore' };
    }
  }

  async function prova() {
    const sotto = await sottoscrizione();
    if (!sotto) return { esito: 'senza-sottoscrizione' };
    try {
      await chiama('/prova', { sottoscrizione: sotto.toJSON() });
      return { esito: 'ok' };
    } catch (errore) {
      return { esito: 'errore' };
    }
  }

  const API = {
    configurato: configurato,
    supportato: supportato,
    attivo: attivo,
    attiva: attiva,
    spegni: spegni,
    sincronizza: sincronizza,
    prova: prova
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else globale.Push = API;
})(typeof window !== 'undefined' ? window : globalThis);
