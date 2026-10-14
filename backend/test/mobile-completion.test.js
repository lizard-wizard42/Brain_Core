const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const { config } = require('../dist/config');
const router = require('../dist/routes/mobile').default;

test('mobile completion forwards recorded end and propagates invalid-time refusals', async () => {
  const saved = { query: database.query, fetch: global.fetch, mode: config.CELTWO_MEMORY_MODE, url: config.CELTWO_MEMORY_URL, token: config.CELTWO_MEMORY_TOKEN };
  const session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  database.query = async sql => {
    if (sql.includes('SELECT d.id, d.user_id')) return [{ id: 'device', user_id: 'owner' }];
    if (sql.includes('SELECT session_id FROM mobile_sessions')) return [{ session_id: session }];
    return [];
  };
  config.CELTWO_MEMORY_MODE = 'proxy'; config.CELTWO_MEMORY_URL = 'http://memory.invalid'; config.CELTWO_MEMORY_TOKEN = 'synthetic';
  const seen = []; let upstreamStatus = 200;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('http://memory.invalid')) return saved.fetch(url, options);
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ status: 'stopped' }), { status: upstreamStatus });
  };
  const app = express(); app.use(express.json()); app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const complete = ended_at => saved.fetch(`http://127.0.0.1:${server.address().port}/sessions/${session}/complete?owner_user_id=owner`, {
      method: 'POST', headers: { Authorization: `Bearer bcmd_${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped', ended_at }),
    });
    const end = '2026-01-01T01:02:03.000Z';
    assert.equal((await complete(end)).status, 200);
    assert.deepEqual(seen[0], { status: 'stopped', ended_at: end });
    assert.equal((await complete(undefined)).status, 200);
    assert.deepEqual(seen[1], { status: 'stopped' });
    assert.equal((await complete('invalid')).status, 400);
    assert.equal(seen.length, 2);
    upstreamStatus = 400;
    assert.equal((await complete(end)).status, 400);
  } finally {
    database.query = saved.query; global.fetch = saved.fetch;
    config.CELTWO_MEMORY_MODE = saved.mode; config.CELTWO_MEMORY_URL = saved.url; config.CELTWO_MEMORY_TOKEN = saved.token;
    await new Promise(resolve => server.close(resolve));
  }
});
