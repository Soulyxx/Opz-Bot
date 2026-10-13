'use strict';

const USE_PG = !!process.env.DATABASE_URL;
let pool = null, sqlite = null;

const T = {
  keys: `CREATE TABLE IF NOT EXISTS keys (
    key TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL, expires_at BIGINT, hwid TEXT, owner TEXT, avatar TEXT, note TEXT,
    created_by TEXT, activations INTEGER DEFAULT 0, last_seen BIGINT, last_ip TEXT, last_user TEXT, last_host TEXT)`,
  sessions: `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, key TEXT NOT NULL, hwid TEXT, created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL, last_seen BIGINT)`,
  logs: `CREATE TABLE IF NOT EXISTS logs (
    id BIGSERIAL PRIMARY KEY, key TEXT, action TEXT, detail TEXT, at BIGINT)`
};

/* Driver sqlite sin binarios nativos: node:sqlite (Node >=22.5) o better-sqlite3. */
function loadSqlite() {
  try { return require('node:sqlite').DatabaseSync; }
  catch {
    try { return require('better-sqlite3'); }
    catch { throw new Error('No sqlite driver available. Use Node >=22.5, install better-sqlite3, or set DATABASE_URL.'); }
  }
}

async function init() {
  if (USE_PG) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5
    });
    await pool.query(T.keys);
    await pool.query(T.sessions);
    await pool.query(T.logs);
    console.log('[db] postgres ready');
  } else {
    const DatabaseSync = loadSqlite();
    sqlite = new DatabaseSync(process.env.DB_FILE || 'auth.db');
    try { sqlite.exec('PRAGMA journal_mode = WAL'); } catch {}
    sqlite.exec(T.keys.replace('BIGSERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT'));
    sqlite.exec(T.sessions);
    sqlite.exec(T.logs.replace('BIGSERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT'));
    console.log('[db] sqlite ready (local)');
  }
}

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
const num = (v) => (v == null ? v : Number(v));
const clean = (r) => {
  if (r) { r.expires_at = num(r.expires_at); r.created_at = num(r.created_at); r.last_seen = num(r.last_seen); }
  return r;
};

/* Ambos drivers (node:sqlite y better-sqlite3) aceptan `.prepare().run/get/all`
   con argumentos posicionales via spread. No envolver en array. */
const run = (sql, p = []) => (USE_PG ? pool.query(toPg(sql), p) : sqlite.prepare(sql).run(...p));
const all = async (sql, p = []) => (USE_PG ? (await pool.query(toPg(sql), p)).rows : sqlite.prepare(sql).all(...p));
const get = async (sql, p = []) => (USE_PG ? (await pool.query(toPg(sql), p)).rows[0] : sqlite.prepare(sql).get(...p));

const getKey = async (k) => clean(await get('SELECT * FROM keys WHERE key = ?', [k]));
const insertKey = (r) => run(
  `INSERT INTO keys (key,plan,status,created_at,expires_at,owner,avatar,note,created_by)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [r.key, r.plan, 'active', r.created_at, r.expires_at ?? null, r.owner ?? null, r.avatar ?? null, r.note ?? null, r.created_by ?? null]);
const updateKey = (k, patch) => {
  const cols = Object.keys(patch);
  if (!cols.length) return Promise.resolve();
  return run(`UPDATE keys SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE key = ?`, [...cols.map((c) => patch[c]), k]);
};
const deleteKey = (k) => run('DELETE FROM keys WHERE key = ?', [k]);
const bump = (k) => run('UPDATE keys SET activations = activations + 1 WHERE key = ?', [k]);

async function listKeys({ status, plan, page = 1, perPage = 12 } = {}) {
  const w = [], p = [];
  if (status) { w.push('status = ?'); p.push(status); }
  if (plan) { w.push('plan = ?'); p.push(plan); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const total = Number((await get(`SELECT COUNT(*) AS c FROM keys ${where}`, p)).c);
  const rows = (await all(`SELECT * FROM keys ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...p, perPage, (page - 1) * perPage])).map(clean);
  return { total, rows };
}
const stats = () => all('SELECT status, plan, COUNT(*) AS c FROM keys GROUP BY status, plan');

const createSession = (s) => run('INSERT INTO sessions (token,key,hwid,created_at,expires_at,last_seen) VALUES (?,?,?,?,?,?)',
  [s.token, s.key, s.hwid, s.created_at, s.expires_at, s.created_at]);
const getSession = (t) => get('SELECT * FROM sessions WHERE token = ?', [t]);
const touchSession = (t) => run('UPDATE sessions SET last_seen = ? WHERE token = ?', [Date.now(), t]);
const dropSession = (t) => run('DELETE FROM sessions WHERE token = ?', [t]);
const dropKeySessions = (k) => run('DELETE FROM sessions WHERE key = ?', [k]);
const purgeSessions = () => run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);

const log = (key, action, detail = '') =>
  run('INSERT INTO logs (key,action,detail,at) VALUES (?,?,?,?)', [key, action, String(detail), Date.now()]);

module.exports = {
  init, getKey, insertKey, updateKey, deleteKey, bump, listKeys, stats,
  createSession, getSession, touchSession, dropSession, dropKeySessions, purgeSessions, log
};