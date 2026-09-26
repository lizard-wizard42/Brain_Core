const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const database = require('../dist/config/database');
const { config } = require('../dist/config');
const mobileRouter = require('../dist/routes/mobile').default;
const rememberRouter = require('../dist/routes/remember').default;

async function serve(path, router, userId) {
  const app = express();
  app.use(express.json());
  app.use(path, userId ? (req, _res, next) => { req.userId = userId; next(); } : router, ...(userId ? [router] : []));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}${path}` };
}

async function close(server) { await new Promise((resolve) => server.close(resolve)); }

test('Android linking rejects unconfigured and mismatched origins, then verifies account switch', async () => {
  const originalQuery = database.query;
  const originalOrigins = [...config.CORS_ORIGINS];
  const allowedOrigin = 'https://computer.example-tailnet.ts.net';
  const token = jwt.sign({ sub: 'user-b', sv: 1, type: 'access' }, config.JWT_SECRET);
  let inserts = 0;
  database.query = async (sql) => {
    if (sql.includes('SELECT session_version FROM users')) return [{ session_version: 1 }];
    if (sql.includes('SELECT COUNT(*)')) return [{ count: '0' }];
    if (sql.includes('INSERT INTO mobile_devices')) { inserts++; return [{ id: 'device-b', user_id: 'user-b' }]; }
    return [];
  };
  const { server, url } = await serve('/api/mobile', mobileRouter);
  const headers = { Authorization: `Bearer ${token}`, Origin: allowedOrigin,
    'X-Brain-Core-Device': 'android', 'Content-Type': 'application/json' };
  const post = (extraHeaders, body = {}) => fetch(`${url}/devices`, {
    method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body),
  });
  try {
    config.CORS_ORIGINS.splice(0);
    assert.equal((await post({})).status, 403);
    config.CORS_ORIGINS.push(allowedOrigin);
    assert.equal((await post({ Origin: 'https://other.example-tailnet.ts.net' })).status, 403);
    assert.equal((await post({ 'X-Brain-Core-Device': 'browser' })).status, 403);
    assert.equal((await post({}, { expected_user_id: 'user-a' })).status, 403);
    assert.equal((await post({}, { previous_user_id: 'user-a' })).status, 409);
    const accepted = await post({}, { expected_user_id: 'user-b', previous_user_id: 'user-a', confirm_switch: true });
    assert.equal(accepted.status, 201);
    const response = await accepted.json();
    assert.equal(response.user_id, 'user-b');
    assert.ok(response.token.startsWith('bcmd_'));
    assert.equal(inserts, 1);
  } finally {
    config.CORS_ORIGINS.splice(0, config.CORS_ORIGINS.length, ...originalOrigins);
    database.query = originalQuery;
    await close(server);
  }
});

test('Android session lookup and completion require the authenticated device', async () => {
  const originalQuery = database.query;
  const sessionId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  let deviceId = 'phone';
  database.query = async (sql) => {
    if (sql.includes('SELECT d.id, d.user_id FROM mobile_devices')) return [{ id: deviceId, user_id: 'user-b' }];
    if (sql.includes('SELECT session_id::text FROM mobile_sessions')) return deviceId === 'phone' ? [{ session_id: sessionId }] : [];
    if (sql.includes('SELECT session_id FROM mobile_sessions')) return deviceId === 'phone' ? [{ session_id: sessionId }] : [];
    return [];
  };
  const { server, url } = await serve('/api/mobile', mobileRouter);
  const headers = { Authorization: `Bearer bcmd_${'a'.repeat(43)}`, 'Content-Type': 'application/json' };
  try {
    const lookup = () => fetch(`${url}/sessions/owned`, {
      method: 'POST', headers, body: JSON.stringify({ session_ids: [sessionId] }),
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    assert.deepEqual((await lookup()).body.session_ids, [sessionId]);
    deviceId = 'tablet';
    assert.deepEqual((await lookup()).body.session_ids, []);
    const completion = await fetch(`${url}/sessions/${sessionId}/complete?owner_user_id=user-b`, {
      method: 'POST', headers, body: JSON.stringify({ status: 'stopped' }),
    });
    assert.equal(completion.status, 404);
    const crossAccount = await fetch(`${url}/sessions/${sessionId}/transcript?owner_user_id=user-a`, { headers });
    assert.equal(crossAccount.status, 409);
  } finally { database.query = originalQuery; await close(server); }
});

test('browser chunk upload and claim reject a different account before storage', async () => {
  const originalQuery = database.query;
  let queries = 0;
  database.query = async () => { queries++; return []; };
  const { server, url } = await serve('/api/remember', rememberRouter, 'user-b');
  const sessionId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  try {
    const common = `session_id=${sessionId}&chunk_num=1&started_at=2026-09-24T12%3A00%3A00Z&owner_user_id=user-a`;
    const upload = await fetch(`${url}/memory/browser/chunks?${common}`, {
      method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('synthetic audio'),
    });
    assert.equal(upload.status, 409);
    const claim = await fetch(`${url}/memory/browser/sessions/${sessionId}/claim?owner_user_id=user-a&started_at=2026-09-24T12%3A00%3A00Z`, { method: 'POST' });
    assert.equal(claim.status, 409);
    assert.equal(queries, 0);
  } finally { database.query = originalQuery; await close(server); }
});
