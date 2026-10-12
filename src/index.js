'use strict';
require('dotenv').config();
const db = require('./db');
const { startApi } = require('./api');
const { initBot } = require('./bot');

(async () => {
  await db.init();
  startApi();
  initBot().catch((e) => console.error('[bot]', e.message));
})();