'use strict';
const crypto = require('crypto');
function safeEqual(a, b) {
  a = Buffer.from(String(a || '')); b = Buffer.from(String(b || ''));
  if (a.length !== b.length) { a = crypto.createHash('sha256').update(a).digest(); b = crypto.createHash('sha256').update(b).digest(); }
  return crypto.timingSafeEqual(a, b);
}
function fmtDuration(ms) {
  if (ms == null) return 'lifetime';
  const d = ms / 864e5;
  if (d >= 365) return Math.round(d / 365) + 'y';
  if (d >= 1) return Math.round(d) + 'd';
  const h = ms / 36e5; if (h >= 1) return Math.round(h) + 'h';
  return Math.max(1, Math.round(ms / 6e4)) + 'm';
}
module.exports = { safeEqual, fmtDuration };