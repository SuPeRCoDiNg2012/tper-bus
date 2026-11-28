/* Muovi Bologna — Worker delle notifiche push.
 *
 * Serve perché l'app è statica: la pagina consegna al Worker la sottoscrizione
 * del browser e l'elenco dei promemoria, il cron li spedisce anche ad app
 * chiusa. Nessun dato personale oltre alla sottoscrizione e all'orario: non
 * c'è alcun profilo utente.
 *
 * Deploy:  npx wrangler deploy --config push/wrangler.toml
 * Segreti: npx wrangler secret put VAPID_PRIVATE_JWK --config push/wrangler.toml
 *          npx wrangler secret put VAPID_SUBJECT     --config push/wrangler.toml
 * Variabile pubblica VAPID_PUBLIC e ORIGIN stanno in wrangler.toml (non sono
 * segreti: la chiave pubblica è per definizione pubblica).
 *
 * Quote: il piano gratuito dà 1.000 `list`, 100.000 letture e 1.000 scritture
 * al giorno. Con un giro al minuto una `list` per volta erano 1.440 list al
 * giorno, quindi il cron si spegneva a metà giornata; per questo il cron legge
 * **una sola chiave** (`indice`, id → prossima scadenza) e tocca solo i record
 * che hanno davvero qualcosa da spedire. La stessa ragione per cui
 * `/promemoria` non riscrive niente quando l'elenco non è cambiato: l'app
 * sincronizza ogni minuto mentre è aperta.
 */

import { inviaPush } from './crypto.mjs';

const LIMITE_PROMEMORIA = 40;
const GIORNO = 24 * 3600 * 1000;
const INDICE = 'indice';
// Silenzio notturno: un avviso alle 3 fa disattivare tutto. L'ultima corsa è
// l'eccezione, perché a mezzanotte serve.
const SILENZIO_DA = 23;
const SILENZIO_A = 6;
// Freno locale alle raffiche: 60 richieste al minuto per IP *dentro un isolate*.
// Misurato: 65 richieste di fila nella produzione hanno passato tutte, perché
// Cloudflare distribuisce le richieste su isolate diversi e questa mappa non è
// condivisa. Non è una protezione globale: quella vera è una regola di rate
// limiting di Cloudflare davanti al Worker (si configura dalla dashboard, il
// piano gratuito ne concede una). Qui resta perché una raffica che capita
// sullo stesso isolate la ferma, e non costa niente.
const LIMITE_RICHIESTE = 60;
const FINESTRA_LIMITE = 60000;
const contatori = new Map();

function origineConsentita(env, richiesta) {
  const consentite = String(env.ORIGIN || '')
    .split(',')
    .map((voce) => voce.trim())
    .filter(Boolean);
  if (!consentite.length) return true; // sviluppo locale senza configurazione
  const origine = richiesta.headers.get('Origin') || '';
  return consentite.indexOf(origine) !== -1;
}

function intestazioni(env) {
  return {
    'access-control-allow-origin': String(env.ORIGIN || '*').split(',')[0].trim(),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  };
}

function json(corpo, stato, env) {
  return new Response(JSON.stringify(corpo), { status: stato || 200, headers: intestazioni(env) });
}

async function impronta(endpoint) {
  const byte = new TextEncoder().encode(endpoint);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', byte));
  return Array.from(digest.slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function vapidDi(env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC || !env.VAPID_SUBJECT) return null;
  let chiave;
  try {
    chiave = JSON.parse(env.VAPID_PRIVATE_JWK);
  } catch (errore) {
    return null;
  }
  return { chiavePrivata: chiave, chiavePubblica: env.VAPID_PUBLIC, soggetto: env.VAPID_SUBJECT };
}

/** Ora locale di Bologna: il cron gira in UTC e il silenzio notturno è locale. */
function oraLocale(ms) {
  try {
    const formato = new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      hour: '2-digit',
      hour12: false
    });
    return Number(formato.format(new Date(ms))) % 24;
  } catch (errore) {
    return new Date(ms).getUTCHours() + 1;
  }
}

function inSilenzio(ms, tag) {
  const categoria = String(tag || '');
  // Ultima corsa e promemoria feriale sono a un'ora scelta: si rispettano.
  if (categoria.indexOf('ultima') === 0 || categoria.indexOf('feriale') === 0) return false;
  const ora = oraLocale(ms);
  return ora >= SILENZIO_DA || ora < SILENZIO_A;
}

function troppoTaffrico(richiesta) {
  const ip = richiesta.headers.get('cf-connecting-ip') || 'locale';
  const adesso = Date.now();
  const voce = contatori.get(ip);
  if (!voce || adesso - voce.inizio > FINESTRA_LIMITE) {
    contatori.set(ip, { inizio: adesso, n: 1 });
    // La memoria è dell'isolate: se cresce troppo si riparte, non è un registro.
    if (contatori.size > 5000) contatori.clear();
    return false;
  }
  voce.n += 1;
  return voce.n > LIMITE_RICHIESTE;
}

function normalizzaPromemoria(elenco) {
  if (!Array.isArray(elenco)) return [];
  return elenco
    .filter((voce) => voce && Number.isFinite(Number(voce.quando)) && String(voce.titolo || ''))
    .slice(0, LIMITE_PROMEMORIA)
    .map((voce) => ({
      id: String(voce.id || 'p' + Number(voce.quando)).slice(0, 64),
      quando: Number(voce.quando),
      titolo: String(voce.titolo).slice(0, 120),
      corpo: String(voce.corpo || '').slice(0, 220),
      fermata: String(voce.fermata || '').slice(0, 24),
      // Stesso tag della notifica locale: se arrivano tutte e due, la seconda
      // sostituisce la prima invece di lasciare due avvisi uguali.
      tag: String(voce.tag || '').slice(0, 48)
    }))
    .sort((a, b) => a.quando - b.quando);
}

function sottoscrizioneValida(sottoscrizione) {
  return !!(
    sottoscrizione &&
    typeof sottoscrizione.endpoint === 'string' &&
    sottoscrizione.endpoint.indexOf('https://') === 0 &&
    sottoscrizione.keys &&
    sottoscrizione.keys.p256dh &&
    sottoscrizione.keys.auth
  );
}

async function leggi(env, id) {
  const salvato = await env.PUSH_KV.get('sub:' + id, 'json');
  return salvato && sottoscrizioneValida(salvato.sottoscrizione) ? salvato : null;
}

async function scrivi(env, id, record) {
  record.aggiornato = Date.now();
  await env.PUSH_KV.put('sub:' + id, JSON.stringify(record));
}

/**
 * L'indice delle scadenze: `{ id: prossimaScadenzaMs }`. Una chiave sola,
 * quindi una lettura per giro di cron invece di una `list` (che sul piano
 * gratuito si esaurisce: 1.000 al giorno contro 1.440 giri).
 */
async function leggiIndice(env) {
  const salvato = await env.PUSH_KV.get(INDICE, 'json');
  return salvato && typeof salvato === 'object' && !Array.isArray(salvato) ? salvato : {};
}

async function scriviIndice(env, indice) {
  await env.PUSH_KV.put(INDICE, JSON.stringify(indice));
}

function prossimaScadenza(record) {
  const elenco = Array.isArray(record && record.promemoria) ? record.promemoria : [];
  let minore = null;
  elenco.forEach((voce) => {
    const quando = Number(voce.quando);
    if (!Number.isFinite(quando)) return;
    if (minore == null || quando < minore) minore = quando;
  });
  return minore;
}

async function consegna(env) {
  const vapid = vapidDi(env);
  if (!vapid) return { inviati: 0, scartati: 0, motivo: 'vapid-non-configurato' };
  const adesso = Date.now();
  const indice = await leggiIndice(env);
  const idDovuti = Object.keys(indice).filter((id) => Number(indice[id]) <= adesso + 1);
  if (!idDovuti.length) return { inviati: 0, scartati: 0 };
  let inviati = 0;
  let scartati = 0;
  let indiceCambiato = false;
  for (const id of idDovuti) {
    const record = await leggi(env, id);
    if (!record) {
      delete indice[id];
      indiceCambiato = true;
      continue;
    }
    const promemoria = Array.isArray(record.promemoria) ? record.promemoria : [];
    const dovuti = promemoria.filter((voce) => Number(voce.quando) <= adesso);
    // I promemoria vecchi di un giorno non interessano più a nessuno.
    const futuri = promemoria.filter(
      (voce) => Number(voce.quando) > adesso || adesso - Number(voce.quando) < GIORNO
    );
    let spenta = false;
    let cambiato = dovuti.length > 0 || futuri.length !== promemoria.length;
    for (const voce of dovuti) {
      if (spenta) break;
      // In silenzio notturno si scarta invece di rimandare: rinviandolo
      // arriverebbe alle 6 un «Bus 13 tra 5 min» di tre ore prima.
      if (inSilenzio(adesso, voce.tag)) {
        scartati += 1;
        continue;
      }
      try {
        const risposta = await inviaPush({
          sottoscrizione: record.sottoscrizione,
          payload: JSON.stringify({
            titolo: voce.titolo,
            corpo: voce.corpo,
            fermata: voce.fermata,
            tag: voce.tag
          }),
          vapid
        });
        if (risposta.status === 404 || risposta.status === 410) {
          // Il browser ha revocato il permesso o la sottoscrizione è scaduta.
          await env.PUSH_KV.delete('sub:' + id);
          delete indice[id];
          indiceCambiato = true;
          spenta = true;
          scartati += 1;
        } else if (risposta.ok) {
          inviati += 1;
          record.consegne = (Number(record.consegne) || 0) + 1;
          record.ultimoInvio = adesso;
          record.ultimoErrore = null;
        } else {
          record.ultimoErrore = 'http ' + risposta.status;
        }
      } catch (errore) {
        // Rete o servizio push giù: il promemoria resta e si ritenta al giro
        // dopo, ma l'errore si annota invece di sparire.
        record.ultimoErrore = 'rete';
        cambiato = true;
      }
    }
    if (spenta) continue;
    if (cambiato) {
      const rimasti = futuri.filter((voce) => dovuti.every((fatto) => fatto.id !== voce.id));
      const prossima = prossimaScadenza({ promemoria: rimasti });
      if (prossima == null) delete indice[id];
      else indice[id] = prossima;
      indiceCambiato = true;
      await scrivi(env, id, { ...record, promemoria: rimasti });
    }
  }
  if (indiceCambiato) await scriviIndice(env, indice);
  return { inviati, scartati };
}

export default {
  async fetch(richiesta, env) {
    const url = new URL(richiesta.url);
    if (richiesta.method === 'OPTIONS') return new Response(null, { status: 204, headers: intestazioni(env) });
    if (url.pathname === '/' || url.pathname === '/salute') {
      return json({ ok: true, vapid: !!vapidDi(env) }, 200, env);
    }
    // La chiave pubblica serve al browser per iscriversi: è pubblica apposta.
    if (url.pathname === '/config') {
      return json({ chiave: env.VAPID_PUBLIC || '' }, 200, env);
    }
    if (richiesta.method !== 'POST') return json({ errore: 'metodo' }, 405, env);
    if (!origineConsentita(env, richiesta)) return json({ errore: 'origine' }, 403, env);
    if (troppoTaffrico(richiesta)) return json({ errore: 'troppe-richieste' }, 429, env);
    let corpo;
    try {
      corpo = await richiesta.json();
    } catch (errore) {
      return json({ errore: 'json' }, 400, env);
    }
    if (!sottoscrizioneValida(corpo && corpo.sottoscrizione)) {
      return json({ errore: 'sottoscrizione' }, 400, env);
    }
    const id = await impronta(corpo.sottoscrizione.endpoint);
    if (url.pathname === '/iscrizione' || url.pathname === '/promemoria') {
      const precedente = await leggi(env, id);
      const promemoria = normalizzaPromemoria(corpo.promemoria);
      // L'app sincronizza ogni minuto mentre è aperta: senza questo confronto
      // le scritture (1.000 al giorno sul piano gratuito) finirebbero in poche
      // ore di app aperta.
      const uguale = precedente &&
        JSON.stringify(precedente.promemoria || []) === JSON.stringify(promemoria) &&
        JSON.stringify(precedente.sottoscrizione) === JSON.stringify(corpo.sottoscrizione);
      if (uguale) {
        return json({ id, promemoria: promemoria.length, invariato: true }, 200, env);
      }
      const record = {
        sottoscrizione: corpo.sottoscrizione,
        promemoria,
        creato: precedente ? precedente.creato : Date.now(),
        consegne: precedente ? Number(precedente.consegne) || 0 : 0,
        ultimoInvio: precedente ? precedente.ultimoInvio || null : null,
        ultimoErrore: precedente ? precedente.ultimoErrore || null : null
      };
      await scrivi(env, id, record);
      const indice = await leggiIndice(env);
      const prossima = prossimaScadenza(record);
      if (prossima == null) delete indice[id];
      else indice[id] = prossima;
      await scriviIndice(env, indice);
      return json({ id, promemoria: promemoria.length }, 200, env);
    }
    if (url.pathname === '/stato') {
      const record = await leggi(env, id);
      if (!record) return json({ iscritto: false }, 200, env);
      return json({
        iscritto: true,
        consegne: Number(record.consegne) || 0,
        ultimoInvio: record.ultimoInvio || null,
        ultimoErrore: record.ultimoErrore || null,
        promemoria: (record.promemoria || []).length,
        prossimo: prossimaScadenza(record)
      }, 200, env);
    }
    if (url.pathname === '/disiscrizione') {
      await env.PUSH_KV.delete('sub:' + id);
      const indice = await leggiIndice(env);
      if (id in indice) {
        delete indice[id];
        await scriviIndice(env, indice);
      }
      return json({ ok: true }, 200, env);
    }
    if (url.pathname === '/prova') {
      const vapid = vapidDi(env);
      if (!vapid) return json({ errore: 'vapid-non-configurato' }, 503, env);
      const risposta = await inviaPush({
        sottoscrizione: corpo.sottoscrizione,
        payload: JSON.stringify({
          titolo: 'Muovi Bologna',
          corpo: 'Notifiche attive anche ad app chiusa.',
          fermata: ''
        }),
        vapid
      });
      return json({ stato: risposta.status }, risposta.ok ? 200 : 502, env);
    }
    return json({ errore: 'rotta' }, 404, env);
  },

  async scheduled(evento, env, ctx) {
    ctx.waitUntil(
      consegna(env).catch((errore) => {
        // Un cron che fallisce in silenzio non si scopre mai: almeno resta nel log.
        console.error('consegna fallita', errore && errore.message ? errore.message : errore);
        return undefined;
      })
    );
  }
};
