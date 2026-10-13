'use strict';
const db = require('./db');
const { normalize, token: newToken } = require('./keys');

const SESSION_TTL = 30 * 864e5;

async function login({ key, hwid, user, host, version, ip }) {
  const k = normalize(key);
  if (!k) return { ok: false, error: 'Missing key', code: 'invalid_key' };
  const rec = await db.getKey(k);
  if (!rec) return { ok: false, error: 'Invalid key', code: 'invalid_key' };
  if (rec.status === 'revoked') return { ok: false, error: 'Key revoked', code: 'revoked', revoked: true };
  if (rec.expires_at != null && Number(rec.expires_at) > 0 && Number.isFinite(Number(rec.expires_at)) && Date.now() > Number(rec.expires_at)) return { ok: false, error: 'Key expired', code: 'expired', expired: true };

  const h = String(hwid || '').toUpperCase().slice(0, 64);
  if (!rec.hwid) { if (h) { await db.updateKey(k, { hwid: h }); await db.log(k, 'bind', h); } }
  else if (h && rec.hwid !== h) { await db.log(k, 'hwid-mismatch', 'got ' + h); return { ok: false, error: 'Key bound to another device', code: 'device_limit' }; }

  const t = newToken();
  await db.createSession({ token: t, key: k, hwid: h, created_at: Date.now(), expires_at: Date.now() + SESSION_TTL });
  await db.bump(k);
  await db.updateKey(k, { last_seen: Date.now(), last_ip: ip || '', last_user: user || '', last_host: host || '' });
  await db.log(k, 'login', `${user || ''}@${host || ''} ${version || ''}`);

  return { ok: true, token: t, plan: rec.plan, user: rec.owner || user || '', avatar: rec.avatar || null, expiresAt: rec.expires_at || null };
}

async function session({ token, hwid }) {
  const s = await db.getSession(String(token || ''));
  if (!s) return { ok: false, error: 'Invalid session', code: 'session_expired' };
  if (Number(s.expires_at) < Date.now()) { await db.dropSession(s.token); return { ok: false, error: 'Session expired', code: 'session_expired', expired: true }; }
  if (s.hwid && hwid && s.hwid !== String(hwid).toUpperCase()) { await db.dropSession(s.token); return { ok: false, error: 'HWID changed', code: 'device_limit' }; }
  const rec = await db.getKey(s.key);
  if (!rec) { await db.dropSession(s.token); return { ok: false, error: 'Invalid key', code: 'invalid_key' }; }
  if (rec.status === 'revoked') { await db.dropSession(s.token); return { ok: false, error: 'Key revoked', code: 'revoked', revoked: true }; }
  if (rec.expires_at != null && Number(rec.expires_at) > 0 && Number.isFinite(Number(rec.expires_at)) && Date.now() > Number(rec.expires_at)) { await db.dropKeySessions(rec.key); return { ok: false, error: 'Key expired', code: 'expired', expired: true }; }
  await db.touchSession(s.token);
  return { ok: true, plan: rec.plan, user: rec.owner || '', avatar: rec.avatar || null, expiresAt: rec.expires_at || null };
}

const logout = ({ token }) => db.dropSession(String(token || '')).then(() => ({ ok: true }));

module.exports = { login, session, logout };