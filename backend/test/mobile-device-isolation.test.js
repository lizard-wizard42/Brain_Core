const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const mobileRouter = require('../dist/routes/mobile').default;

test('two devices on one account retain separate session ownership', async () => {
  const originalQuery = database.query;
  const session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  let currentDevice = 'phone';
  const seen = [];
  database.query = async (sql, params) => {
    seen.push({ sql, params });
    if (sql.includes('SELECT d.id, d.user_id FROM mobile_devices')) return [{ id: currentDevice, user_id: 'account-a' }];
    if (sql.includes('SELECT session_id::text FROM mobile_sessions'))
      return currentDevice === 'phone' ? [{ session_id: session }] : [];
    if (sql.includes('SELECT session_id FROM mobile_sessions'))
      return currentDevice === 'phone' ? [{ session_id: session }] : [];
    return [];
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRouter);
  const server = await new Promise(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/mobile`;
    const headers = { Authorization: `Bearer bcmd_${'a'.repeat(43)}`, 'Content-Type': 'application/json' };
    const owned = async () => fetch(`${base}/sessions/owned`, {
      method: 'POST', headers, body: JSON.stringify({ session_ids: [session] }),
    }).then(response => response.json());
    assert.deepEqual((await owned()).session_ids, [session]);
    currentDevice = 'tablet';
    assert.deepEqual((await owned()).session_ids, []);
    const response = await fetch(`${base}/sessions/${session}/complete?owner_user_id=account-a`, {
      method: 'POST', headers, body: JSON.stringify({ status: 'stopped' }),
    });
    assert.equal(response.status, 404);
    assert.ok(seen.some(({ sql, params }) => sql.includes('device_id = $2') && params[1] === 'tablet'));
    assert.ok(seen.some(({ sql, params }) => sql.includes('device_id = $3') && params[2] === 'tablet'));
  } finally {
    database.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});
