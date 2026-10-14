'use strict';
const express = require('express');

function tryReq(...p) {
  for (const x of p) { try { return require(x); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }
  throw new Error('Modulo no encontrado: ' + p.join(' | '));
}

const { Store } = tryReq('./src/store', './store');
const apiRouter = tryReq('./src/api', './api');
const { startBot } = tryReq('./src/bot', './bot');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || './data';
const AUTH_SECRET = process.env.AUTH_SECRET || '';

const store = new Store(DATA_DIR);

const hits = new Map();
function rl(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x';
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  if (rec.n > 400) return res.status(429).json({ ok: false, error: 'rate' });
  next();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(rl);

app.get('/', (_q, r) => r.json({ ok: true, service: 'hook-slx-auth' }));
app.get('/health', (_q, r) => r.json({ ok: true, users: store.list().length }));

let bot = null;
app.use('/api', apiRouter(store, AUTH_SECRET, (kind, u) => {
  if (bot && bot.notifyNew && kind === 'new') bot.notifyNew(u).catch((e) => console.error('[bot] notify', e.message));
}));

/* Escuchamos PRIMERO: el healthcheck de Railway no depende de Discord */
app.listen(PORT, '0.0.0.0', () => {
  console.log('[auth] escuchando en :' + PORT);
  console.log('[auth] secret: ' + (AUTH_SECRET ? 'ON' : 'OFF (sin proteccion)'));
  console.log('[auth] data dir: ' + DATA_DIR);
});

/* El bot arranca en paralelo */
startBot(store)
  .then((b) => { bot = b; if (b) console.log('[auth] bot listo'); })
  .catch((e) => console.error('[bot] arranque:', e.message));

function shutdown() { try { store.flush(); } catch {} process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);