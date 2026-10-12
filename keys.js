'use strict';
const crypto = require('crypto');
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const seg = (n = 4) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length]; return s; };
const gen = () => 'LOST-' + seg() + '-' + seg() + '-' + seg();
const token = () => crypto.randomBytes(32).toString('hex');
const normalize = (k) => String(k || '').trim().toUpperCase().replace(/\s+/g, '');
function parseDuration(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (['life', 'lifetime', 'perm', 'permanent', 'forever', 'inf'].includes(s)) return null;
  const m = s.match(/^(\d+)\s*(m|min|h|d|w|mo|y)$/);
  if (!m) return undefined;
  const mult = { m: 6e4, min: 6e4, h: 36e5, d: 864e5, w: 6048e5, mo: 2592e6, y: 31536e6 }[m[2]];
  return parseInt(m[1], 10) * mult;
}
const PLANS = { trial: 1, week: 7, month: 30, lifetime: null };
module.exports = { gen, token, normalize, parseDuration, PLANS };