/* Muovi Bologna — Worker delle notifiche push.
 *
 * Serve perché GitHub Pages è statico: la pagina consegna al Worker la
 * sottoscrizione del browser e l'elenco dei promemoria, il cron li spedisce
 * anche ad app chiusa. Nessun dato personale oltre alla sottoscrizione e
 * all'orario: non c'è alcun profilo utente.
 *
 * Deploy:  npx wrangler deploy --config push/wrangler.toml
 * Segreti: npx wrangler secret put VAPID_PRIVATE_JWK --config push/wrangler.toml
 *          npx wrangler secret put VAPID_SUBJECT     --config push/wrangler.toml
 * Variabile pubblica VAPID_PUBLIC e ORIGIN stanno in wrangler.toml (non sono
 * segreti: la chiave pubblica è per definizione pubblica).
 */

import { inviaPush } from './crypto.mjs';

const LIMITE_PROMEMORIA = 40;
const GIORNO = 24 * 3600 * 1000;

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
      fermata: String(voce.fermata || '').slice(0, 24)
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

async function consegna(env) {
  const vapid = vapidDi(env);
  if (!vapid) return { inviati: 0, scartati: 0, motivo: 'vapid-non-configurato' };
  const adesso = Date.now();
  let inviati = 0;
  let scartati = 0;
  let cursore;
  for (;;) {
    const pagina = await env.PUSH_KV.list({ prefix: 'sub:', cursor: cursore });
    for (const chiave of pagina.keys) {
      const record = await leggi(env, chiave.name.slice(4));
      if (!record) {
        await env.PUSH_KV.delete(chiave.name);
        continue;
      }
      const promemoria = Array.isArray(record.promemoria) ? record.promemoria : [];
      const dovuti = promemoria.filter((voce) => Number(voce.quando) <= adesso);
      // I promemoria vecchi di un giorno non interessano più a nessuno.
      const futuri = promemoria.filter(
        (voce) => Number(voce.quando) > adesso || adesso - Number(voce.quando) < GIORNO
      );
      if (!dovuti.length) {
        if (futuri.length !== promemoria.length) await scrivi(env, chiave.name.slice(4), { ...record, promemoria: futuri });
        continue;
      }
      let spenta = false;
      for (const voce of dovuti) {
        if (spenta) break;
        try {
          const risposta = await inviaPush({
            sottoscrizione: record.sottoscrizione,
            payload: JSON.stringify({ titolo: voce.titolo, corpo: voce.corpo, fermata: voce.fermata }),
            vapid
          });
          if (risposta.status === 404 || risposta.status === 410) {
            // Il browser ha revocato il permesso o la sottoscrizione è scaduta.
            await env.PUSH_KV.delete(chiave.name);
            spenta = true;
            scartati += 1;
          } else if (risposta.ok) {
            inviati += 1;
          }
        } catch (errore) {
          // Rete o servizio push giù: il promemoria resta e si ritenta al giro dopo.
        }
      }
      if (spenta) continue;
      const rimasti = futuri.filter((voce) => dovuti.every((fatto) => fatto.id !== voce.id));
      await scrivi(env, chiave.name.slice(4), { ...record, promemoria: rimasti });
    }
    if (pagina.list_complete) break;
    cursore = pagina.cursor;
  }
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
      const record = {
        sottoscrizione: corpo.sottoscrizione,
        promemoria: normalizzaPromemoria(corpo.promemoria),
        creato: precedente ? precedente.creato : Date.now()
      };
      await scrivi(env, id, record);
      return json({ id, promemoria: record.promemoria.length }, 200, env);
    }
    if (url.pathname === '/disiscrizione') {
      await env.PUSH_KV.delete('sub:' + id);
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
    ctx.waitUntil(consegna(env).then(() => undefined));
  }
};
