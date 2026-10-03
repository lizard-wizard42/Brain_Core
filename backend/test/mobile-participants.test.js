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
    const post = { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: 'Synthetic' }) };
    assert.equal((await fetch(`${base}/identities?owner_user_id=owner-b`, post)).status, 409);
    assert.equal((await fetch(`${base}/identities?owner_user_id=owner-a`, post)).status, 404);
    assert.equal((await fetch(`${base}/segments/12/template?owner_user_id=owner-b`, post)).status, 409);
    assert.equal((await fetch(`${base}/segments/12/template?owner_user_id=owner-a`, post)).status, 404);
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


test('device participant creation and extraction use authenticated account and owned session', async () => {
  const service = require('../dist/remember/service');
  const original = { query: database.query, create: service.participants.create, template: service.participants.createTemplate };
  const session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const seen = [];
  database.query = async (sql, params) => {
    if (sql.includes('SELECT d.id, d.user_id FROM mobile_devices')) return [{ id: 'device', user_id: 'owner-a' }];
    if (sql.includes('SELECT session_id FROM mobile_sessions')) {
      assert.deepEqual(params, [session, 'owner-a', 'device']);
      return [{ session_id: session }];
    }
    return [];
  };
  service.participants.create = async (...args) => { seen.push(args); return { id: 'synthetic', display_name: args[1] }; };
  service.participants.createTemplate = async (...args) => { seen.push(args); return { id: 'template' }; };
  const app = express(); app.use(express.json()); app.use('/api/mobile', mobileRouter);
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/mobile/sessions/${session}/participants`;
    const options = { method: 'POST', headers: { Authorization: `Bearer bcmd_${'a'.repeat(43)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: ' Synthetic ' }) };
    assert.equal((await fetch(`${base}/identities?owner_user_id=owner-a`, options)).status, 201);
    assert.equal((await fetch(`${base}/segments/12/template?owner_user_id=owner-a`, options)).status, 201);
    assert.deepEqual(seen, [['owner-a', 'Synthetic'], ['owner-a', session, 12]]);
  } finally {
    database.query = original.query; service.participants.create = original.create; service.participants.createTemplate = original.template;
    await new Promise(resolve => server.close(resolve));
  }
});
