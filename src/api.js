'use strict';
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const keys = require('./keys');
const { safeEqual } = require('./util');

const SECRET = process.env.AUTH_SECRET || '';
const ADMIN = process.env.ADMIN_SECRET || SECRET || '';

const hits = new Map();
function rate(ip, max = 40, win = 60000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length <= max;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function startApi() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));

  app.get('/', (_q, res) => res.json({ ok: true, service: 'lost-optimizations-auth', v: 2 }));
  app.get('/api/ping', (_q, res) => res.json({ ok: true, t: Date.now() }));

  const guard = (req, res, next) => {
    if (SECRET && !safeEqual(req.headers['x-lost-secret'] || '', SECRET)) return res.json({ ok: false, error: 'Bad secret' });
    if (!rate(ipOf(req))) return res.json({ ok: false, error: 'Too many requests' });
    next();
  };

  app.post('/api/login', guard, async (req, res) => {
    try { const { key, hwid, user, host, version } = req.body || {}; res.json(await auth.login({ key, hwid, user, host, version, ip: ipOf(req) })); }
    catch { res.json({ ok: false, error: 'Server error' }); }
  });
  app.post('/api/session', guard, async (req, res) => {
    try { const { token, hwid } = req.body || {}; res.json(await auth.session({ token, hwid })); }
    catch { res.json({ ok: false, error: 'Server error' }); }
  });
  app.post('/api/logout', async (req, res) => { try { res.json(await auth.logout(req.body || {})); } catch { res.json({ ok: true }); } });

  /* ── Admin ───────────────────────────────────────────── */
  const admin = (req, res, next) => {
    if (!ADMIN || !safeEqual(req.headers['x-admin-secret'] || '', ADMIN)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    next();
  };

  app.post('/admin/keys', admin, async (req, res) => {
    const { plan = 'month', duration, owner, avatar, note, amount = 1, createdBy } = req.body || {};
    const ms = duration !== undefined ? keys.parseDuration(duration) : (keys.PLANS[plan] ?? null) * 864e5;
    if (ms === undefined) return res.json({ ok: false, error: 'Bad duration' });
    const created = [];
    for (let i = 0; i < Math.min(50, Math.max(1, amount)); i++) {
      const key = keys.gen();
      await db.insertKey({ key, plan, created_at: Date.now(), expires_at: ms == null ? null : Date.now() + ms, owner, avatar, note, created_by: createdBy });
      created.push(key);
    }
    await db.log(created[0], 'create', `plan=${plan} n=${created.length} by=${createdBy || ''}`);
    res.json({ ok: true, keys: created });
  });

  app.get('/admin/keys', admin, async (req, res) => {
    const { status, plan, page, perPage } = req.query || {};
    res.json({ ok: true, ...(await db.listKeys({ status, plan, page: Number(page) || 1, perPage: Number(perPage) || 12 })) });
  });
  app.get('/admin/stats', admin, async (_q, res) => res.json({ ok: true, stats: await db.stats() }));

  app.post('/admin/keys/:key/revoke', admin, async (req, res) => {
    const k = keys.normalize(req.params.key);
    await db.updateKey(k, { status: 'revoked' }); await db.dropKeySessions(k); await db.log(k, 'revoke');
    res.json({ ok: true });
  });
  app.post('/admin/keys/:key/reset', admin, async (req, res) => {
    const k = keys.normalize(req.params.key);
    await db.updateKey(k, { hwid: null }); await db.dropKeySessions(k); await db.log(k, 'reset-hwid');
    res.json({ ok: true });
  });
  app.post('/admin/keys/:key/extend', admin, async (req, res) => {
    const k = keys.normalize(req.params.key);
    const rec = await db.getKey(k);
    if (!rec) return res.json({ ok: false, error: 'Not found' });
    const ms = keys.parseDuration(req.body && req.body.duration);
    if (ms == null || ms === undefined) return res.json({ ok: false, error: 'Bad duration' });
    await db.updateKey(k, { expires_at: Math.max(Date.now(), Number(rec.expires_at) || 0) + ms, status: 'active' });
    await db.log(k, 'extend', req.body.duration);
    res.json({ ok: true });
  });
  app.delete('/admin/keys/:key', admin, async (req, res) => {
    const k = keys.normalize(req.params.key);
    await db.dropKeySessions(k); await db.deleteKey(k); await db.log(k, 'delete');
    res.json({ ok: true });
  });

  setInterval(() => db.purgeSessions().catch(() => {}), 3600e3);

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('[api] listening on ' + port));
}
module.exports = { startApi };