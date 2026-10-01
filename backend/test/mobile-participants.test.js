const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const mobileRouter = require('../dist/routes/mobile').default;

test('participant routes reject invalid segments, foreign sessions, and account switches', async () => {
  const originalQuery = database.query;
  const session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  database.query = async (sql) => {
    if (sql.includes('SELECT d.id, d.user_id FROM mobile_devices')) return [{ id: 'device', user_id: 'owner-a' }];
    return [];
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRouter);
  const server = await new Promise(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/mobile/sessions/${session}/participants`;
    const headers = { Authorization: `Bearer bcmd_${'a'.repeat(43)}` };
    assert.equal((await fetch(`${base}/segments/0?owner_user_id=owner-a`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/segments/12?owner_user_id=owner-b`, { headers })).status, 409);
    assert.equal((await fetch(`${base}/segments/12?owner_user_id=owner-a`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/segments/12/decision?owner_user_id=owner-a`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'correct' }),
    })).status, 400);
  } finally {
    database.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
