'use strict';
require('dotenv').config();
const db = require('./db');
const { startApi } = require('./api');
const { initBot } = require('./bot');

process.on('unhandledRejection', (e) => { console.error('[fatal] unhandled rejection:', e && e.stack ? e.stack : e); process.exit(1); });
process.on('uncaughtException', (e) => { console.error('[fatal] uncaught exception:', e && e.stack ? e.stack : e); process.exit(1); });

(async () => {
  try {
    await db.init();
  } catch (e) {
    console.error('[fatal] database init failed:', e.message);
    console.error('[hint] Set DATABASE_URL for PostgreSQL, or use Node >=22.5 (node:sqlite), or install better-sqlite3.');
    process.exit(1);
  }
  startApi();
  initBot().catch((e) => console.error('[bot]', e.message));
})();