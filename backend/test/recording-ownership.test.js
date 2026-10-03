const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rememberRouter = require('../dist/routes/remember').default;
const mobileRouter = require('../dist/routes/mobile').default;
const database = require('../dist/config/database');
const memoryClient = require('../dist/remember/celtwoClient');

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

test('foreign mobile sessions cannot be claimed or uploaded through browser routes', async () => {
  const originalQuery = database.query;
  const calls = [];
  database.query = async (sql) => {
    calls.push(sql);
    return sql.includes('SELECT user_id FROM mobile_sessions') ? [{ user_id: 'user-a' }] : [];
  };
  const app = express();
  app.use('/api/remember', (req, _res, next) => { req.userId = 'user-b'; next(); }, rememberRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const session = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const base = `http://127.0.0.1:${server.address().port}/api/remember/memory/browser`;
    const query = 'owner_user_id=user-b&started_at=2026-10-03T00%3A00%3A00Z';
    const claim = await fetch(`${base}/sessions/${session}/claim?${query}`, { method: 'POST' });
    assert.equal(claim.status, 409);
    const upload = await fetch(`${base}/chunks?session_id=${session}&chunk_num=1&${query}`, {
      method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('synthetic-audio'),
    });
    assert.equal(upload.status, 409);
    assert.ok(!calls.some(sql => sql.includes('INSERT')));
  } finally {
    database.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test('browser completion forwards authenticated owner and refuses stale foreign claims', async () => {
  const originalQuery = database.query;
  const originalRequest = memoryClient.celtwoRequest;
  const updates = [];
  let foreign = true;
  database.query = async (sql, params) => {
    if (sql.includes('SELECT user_id FROM browser_recording_sessions')) return [{ user_id: 'user-b' }];
    if (sql.includes('UPDATE browser_recording_sessions')) updates.push({ sql, params });
    return [];
  };
  memoryClient.celtwoRequest = async (path, init) => {
    const url = new URL(path, 'http://synthetic-memory');
    assert.equal(url.searchParams.get('owner_user_id'), 'user-b');
    assert.equal(JSON.parse(init.body).status, 'stopped');
    if (foreign) throw new memoryClient.CeltwoUnavailableError('not found', 404);
    return { status: 'stopped' };
  };
  const app = express();
  app.use('/api/remember', (req, _res, next) => { req.userId = 'user-b'; next(); }, rememberRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/remember/memory/browser/sessions/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/complete?owner_user_id=user-b`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    assert.equal(updates.length, 0);
    foreign = false;
    assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    assert.equal(updates.length, 1);
    assert.match(updates[0].sql, /AND user_id = \$2/);
    assert.equal(updates[0].params[1], 'user-b');
  } finally {
    database.query = originalQuery;
    memoryClient.celtwoRequest = originalRequest;
    await new Promise(resolve => server.close(resolve));
  }
});

test('voiceprint proxy preserves duration and busy refusals as client errors', async () => {
  const originalRequest = memoryClient.celtwoRequest;
  const config = require('../dist/config').config;
  const originalMode = config.CELTWO_MEMORY_MODE;
  config.CELTWO_MEMORY_MODE = 'proxy';
  let code = 413;
  memoryClient.celtwoRequest = async () => { throw new memoryClient.CeltwoUnavailableError('synthetic refusal', code); };
  const app = express();
  app.use('/api/remember', (req, _res, next) => { req.userId = 'user-b'; next(); }, rememberRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/remember/memory/voiceprint`;
    for (code of [413, 429]) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('synthetic-audio') });
      assert.equal(response.status, code);
      assert.match((await response.json()).error, code === 413 ? /8 a 60 segundos/ : /cadastro de voz em andamento/);
    }
  } finally {
    memoryClient.celtwoRequest = originalRequest;
    config.CELTWO_MEMORY_MODE = originalMode;
    await new Promise(resolve => server.close(resolve));
  }
});

test('mobile completion sends the device account to Memory, retaining device checks', async () => {
  const originalQuery = database.query;
  const config = require('../dist/config').config;
  const originalUrl = config.CELTWO_MEMORY_URL;
  const originalMode = config.CELTWO_MEMORY_MODE;
  const originalToken = config.CELTWO_MEMORY_TOKEN;
  const originalFetch = global.fetch;
  const upstream = [];
  let missing = false;
  config.CELTWO_MEMORY_URL = 'http://synthetic-memory.invalid';
  config.CELTWO_MEMORY_MODE = 'proxy';
  config.CELTWO_MEMORY_TOKEN = 'synthetic-token';
  database.query = async sql => {
    if (sql.includes('SELECT d.id, d.user_id FROM mobile_devices')) return [{ id: 'device-a', user_id: 'user-b' }];
    if (sql.includes('SELECT session_id FROM mobile_sessions')) return [{ session_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }];
    return [];
  };
  global.fetch = async (url, init) => {
    if (String(url).startsWith(config.CELTWO_MEMORY_URL)) {
      upstream.push(new URL(url));
      return new Response(JSON.stringify({ status: 'stopped' }), { status: missing ? 404 : 200 });
    }
    return originalFetch(url, init);
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/mobile/sessions/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/complete?owner_user_id=user-b`;
    const init = { method: 'POST', headers: { Authorization: `Bearer bcmd_${'a'.repeat(43)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'stopped' }) };
    assert.equal((await fetch(url, init)).status, 200);
    assert.equal(upstream[0].searchParams.get('owner_user_id'), 'user-b');
    missing = true;
    assert.equal((await fetch(url, init)).status, 404);
  } finally {
    database.query = originalQuery;
    config.CELTWO_MEMORY_URL = originalUrl;
    config.CELTWO_MEMORY_MODE = originalMode;
    config.CELTWO_MEMORY_TOKEN = originalToken;
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
  }
});


test('voice enrollment rejects a changed initiating account before contacting Memory', async () => {
  const controller = require('../dist/controllers/rememberController');
  const response = { code: 0, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await controller.rememberVoiceprintPost({ userId: 'current-account', query: { owner_user_id: 'initiating-account' }, body: Buffer.from('fictional'), headers: {} }, response);
  assert.equal(response.code, 409);
});
