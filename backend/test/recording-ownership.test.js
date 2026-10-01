const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rememberRouter = require('../dist/routes/remember').default;
const mobileRouter = require('../dist/routes/mobile').default;
const database = require('../dist/config/database');

test('browser upload and completion reject a mismatched recording owner before storage', async () => {
  const app = express();
  app.use('/api/remember', (req, _res, next) => { req.userId = 'user-b'; next(); }, rememberRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const sessionId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const upload = await fetch(`${origin}/api/remember/memory/browser/chunks?session_id=${sessionId}&chunk_num=1&started_at=2026-09-24T12%3A00%3A00Z&owner_user_id=user-a`, {
      method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('audio'),
    });
    assert.equal(upload.status, 409);

    const completion = await fetch(`${origin}/api/remember/memory/browser/sessions/${sessionId}/complete?owner_user_id=user-a`, { method: 'POST' });
    assert.equal(completion.status, 409);

    const claim = await fetch(`${origin}/api/remember/memory/browser/sessions/${sessionId}/claim?owner_user_id=user-a&started_at=2026-09-24T12%3A00%3A00Z`, { method: 'POST' });
    assert.equal(claim.status, 409);

    // Matching ownership passes the guard and reaches ordinary input validation.
    const validOwner = await fetch(`${origin}/api/remember/memory/browser/chunks?session_id=bad&chunk_num=1&started_at=2026-09-24T12%3A00%3A00Z&owner_user_id=user-b`, {
      method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('audio'),
    });
    assert.equal(validOwner.status, 400);
    const malformedClaim = await fetch(`${origin}/api/remember/memory/browser/sessions/bad/claim?owner_user_id=user-b&started_at=2026-09-24T12%3A00%3A00Z`, { method: 'POST' });
    assert.equal(malformedClaim.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('legacy browser claim refuses a session already registered to another account', async () => {
  const originalQuery = database.query;
  database.query = async (sql) => sql.includes('SELECT user_id FROM browser_recording_sessions')
    ? [{ user_id: 'user-a' }] : [];
  const app = express();
  app.use('/api/remember', (req, _res, next) => { req.userId = 'user-b'; next(); }, rememberRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/remember/memory/browser/sessions/${sessionId}/claim?owner_user_id=user-b&started_at=2026-09-24T12%3A00%3A00Z`, { method: 'POST' });
    assert.equal(result.status, 409, await result.text());
  } finally {
    database.query = originalQuery;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('mobile routes reject a mismatched owner and return only server-owned legacy sessions', async () => {
  const originalQuery = database.query;
  const owned = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  database.query = async (sql) => {
    if (sql.includes('SELECT d.id, d.user_id FROM mobile_devices')) return [{ id: owned, user_id: 'user-b' }];
    if (sql.includes('SELECT session_id::text FROM mobile_sessions')) return [{ session_id: owned }];
    return [];
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}/api/mobile`;
    const headers = { Authorization: `Bearer bcmd_${'a'.repeat(43)}` };
    const completion = await fetch(`${origin}/sessions/${owned}/complete?owner_user_id=user-a`, { method: 'POST', headers });
    assert.equal(completion.status, 409);
    const transcript = await fetch(`${origin}/sessions/${owned}/transcript?owner_user_id=user-a`, { headers });
    assert.equal(transcript.status, 409);
    const migration = await fetch(`${origin}/sessions/owned`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: [owned, other] }),
    });
    assert.equal(migration.status, 200);
    assert.deepEqual(await migration.json(), { session_ids: [owned] });
    database.query = async () => { throw new Error('database offline'); };
    const unavailable = await fetch(`${origin}/device`, { headers });
    assert.equal(unavailable.status, 503);
  } finally {
    database.query = originalQuery;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('device binding verifies web session identity and prevents silent account switch', async () => {
  const originalQuery = database.query;
  const config = require('../dist/config').config;
  const originalOrigins = config.CORS_ORIGINS;
  config.CORS_ORIGINS = ['https://brain.example.org'];
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ sub: 'user-b', sv: 1, type: 'access' }, config.JWT_SECRET);
  database.query = async (sql) => {
    if (sql.includes('SELECT session_version FROM users')) return [{ session_version: 1 }];
    if (sql.includes('SELECT COUNT(*)')) return [{ count: '0' }];
    if (sql.includes('INSERT INTO mobile_devices')) return [{ id: 'dev-1', user_id: 'user-b', name: 'Android', created_at: '', last_used_at: null }];
    return [];
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}/api/mobile/devices`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Origin: 'https://brain.example.org',
      'X-Brain-Core-Device': 'android',
      'Content-Type': 'application/json',
    };

    // 1. Mismatched expected_user_id fails with 403
    const mismatch = await fetch(origin, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expected_user_id: 'user-a' }),
    });
    assert.equal(mismatch.status, 403);

    // 2. Mismatched previous_user_id without confirm_switch fails with 409
    const silentSwitch = await fetch(origin, {
      method: 'POST',
      headers,
      body: JSON.stringify({ previous_user_id: 'user-a', confirm_switch: false }),
    });
    assert.equal(silentSwitch.status, 409);

    // 3. Matched expected_user_id and confirmed switch succeeds
    const success = await fetch(origin, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expected_user_id: 'user-b', previous_user_id: 'user-a', confirm_switch: true }),
    });
    assert.equal(success.status, 201);
    const data = await success.json();
    assert.equal(data.user_id, 'user-b');
    assert.ok(data.token.startsWith('bcmd_'));
  } finally {
    config.CORS_ORIGINS = originalOrigins;
    database.query = originalQuery;
    await new Promise((resolve) => server.close(resolve));
  }
});

