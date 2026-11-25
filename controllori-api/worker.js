// API delle segnalazioni "controllore a bordo" per Muovi Bologna.
// Pubblica in lettura, con scrittura anonima ma limitata: una segnalazione vale
// 25 minuti, lo stesso dispositivo non può ripetere la stessa linea per 10
// minuti e ogni linea ha un tetto orario anti-spam.

const TTL_MS = 25 * 60 * 1000;
const ATTESA_MS = 10 * 60 * 1000;
const MAX_ORA = 40;

const ORIGINI = [
  'https://tper-bus.vercel.app',
  'http://localhost:8123',
  'http://127.0.0.1:8123'
];

let pronta = false;

// Il client puo' girare anche sul dominio personalizzato o su un deploy di
// prova: le origini ammesse restano queste, tutto il resto riceve la prima.
function cors(origine) {
  const consentita = ORIGINI.indexOf(origine) >= 0 ? origine : ORIGINI[0];
  return {
    'Access-Control-Allow-Origin': consentita,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function risposta(dati, stato, origine) {
  return new Response(JSON.stringify(dati), {
    status: stato || 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, cors(origine))
  });
}

function lineaPulita(valore) {
  const linea = String(valore || '').trim().toUpperCase();
  return /^[A-Z0-9]{1,5}$/.test(linea) ? linea : '';
}

async function prepara(env) {
  if (pronta) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS segnalazioni (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
    'linea TEXT NOT NULL, ' +
    'verso TEXT, ' +
    'dispositivo TEXT NOT NULL, ' +
    'ts INTEGER NOT NULL)'
  ).run();
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_segnalazioni_linea ON segnalazioni (linea, ts)'
  ).run();
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_segnalazioni_dispositivo ON segnalazioni (dispositivo, linea, ts)'
  ).run();
  pronta = true;
}

async function leggi(env, linee) {
  const adesso = Date.now();
  const limite = adesso - TTL_MS;
  if (!linee.length) {
    const risultato = await env.DB.prepare(
      'SELECT linea, MAX(ts) AS ultima, COUNT(*) AS quante FROM segnalazioni WHERE ts >= ? GROUP BY linea'
    ).bind(limite).all();
    return risultato.results || [];
  }
  const segnaposto = linee.map(() => '?').join(',');
  const risultato = await env.DB.prepare(
    'SELECT linea, MAX(ts) AS ultima, COUNT(*) AS quante FROM segnalazioni ' +
    'WHERE ts >= ? AND linea IN (' + segnaposto + ') GROUP BY linea'
  ).bind(limite, ...linee).all();
  return risultato.results || [];
}

async function scrivi(env, linea, verso, dispositivo) {
  const adesso = Date.now();
  const limite = adesso - TTL_MS;

  // Pulizia leggera: le segnalazioni scadute non servono a nessuno.
  await env.DB.prepare('DELETE FROM segnalazioni WHERE ts < ?').bind(limite).run();

  const recente = await env.DB.prepare(
    'SELECT ts FROM segnalazioni WHERE dispositivo = ? AND linea = ? AND ts >= ? ORDER BY ts DESC LIMIT 1'
  ).bind(dispositivo, linea, adesso - ATTESA_MS).first();
  if (recente) {
    return { errore: 'attesa', fra: Math.ceil((ATTESA_MS - (adesso - recente.ts)) / 1000) };
  }

  const conteggio = await env.DB.prepare(
    'SELECT COUNT(*) AS quante FROM segnalazioni WHERE linea = ? AND ts >= ?'
  ).bind(linea, adesso - 60 * 60 * 1000).first();
  if (conteggio && conteggio.quante >= MAX_ORA) {
    return { errore: 'troppe' };
  }

  await env.DB.prepare(
    'INSERT INTO segnalazioni (linea, verso, dispositivo, ts) VALUES (?, ?, ?, ?)'
  ).bind(linea, verso || null, dispositivo, adesso).run();

  return { ok: true, linea: linea, ts: adesso };
}

export default {
  async fetch(request, env) {
    const origine = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const percorso = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origine) });
    }
    if (percorso !== '/api/controllori') {
      return risposta({ errore: 'percorso sconosciuto' }, 404, origine);
    }

    try {
      await prepara(env);

      if (request.method === 'GET') {
        const chieste = String(url.searchParams.get('linee') || '')
          .split(',')
          .map(lineaPulita)
          .filter(Boolean)
          .slice(0, 12);
        const righe = await leggi(env, chieste);
        return risposta({
          adesso: Date.now(),
          ttl: TTL_MS,
          linee: righe.map((riga) => ({
            linea: riga.linea,
            ultima: riga.ultima,
            quante: riga.quante
          }))
        }, 200, origine);
      }

      if (request.method === 'POST') {
        const testo = await request.text();
        if (testo.length > 500) {
          return risposta({ errore: 'richiesta troppo grande' }, 413, origine);
        }
        let corpo = {};
        try { corpo = JSON.parse(testo || '{}'); } catch (errore) {
          return risposta({ errore: 'json non valido' }, 400, origine);
        }
        const linea = lineaPulita(corpo.linea);
        const dispositivo = String(corpo.dispositivo || '').trim();
        const verso = corpo.verso ? String(corpo.verso).trim().slice(0, 60) : null;
        if (!linea) return risposta({ errore: 'linea non valida' }, 400, origine);
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(dispositivo)) {
          return risposta({ errore: 'dispositivo non valido' }, 400, origine);
        }
        const esito = await scrivi(env, linea, verso, dispositivo);
        if (esito.errore === 'attesa') {
          return risposta({ errore: 'attesa', fra: esito.fra }, 429, origine);
        }
        if (esito.errore === 'troppe') {
          return risposta({ errore: 'troppe segnalazioni' }, 429, origine);
        }
        return risposta({ ok: true, linea: linea, ts: esito.ts, ttl: TTL_MS }, 201, origine);
      }

      return risposta({ errore: 'metodo non supportato' }, 405, origine);
    } catch (errore) {
      return risposta({ errore: 'errore interno' }, 500, origine);
    }
  }
};
