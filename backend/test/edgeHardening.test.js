const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { apiSecurityHeaders } = require('../dist/middleware/securityHeaders');
const { createApiRateLimit } = require('../dist/middleware/apiRateLimit');
const { getClientIp } = require('../dist/middleware/clientIp');

async function withServer(app, fn) {
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(r => server.close(r)); }
}

test('api security headers are set', async () => {
  const app = express();
  app.use(apiSecurityHeaders);
  app.get('/x', (_req, res) => res.json({}));
  await withServer(app, async base => {
    const res = await fetch(`${base}/x`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });
});

test('rate limit returns 429 after max and resets after the window', async () => {
  let t = 1000;
  const app = express();
  app.use(createApiRateLimit({ windowMs: 60000, max: 2, now: () => t }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  await withServer(app, async base => {
    assert.equal((await fetch(`${base}/x`)).status, 200);
    assert.equal((await fetch(`${base}/x`)).status, 200);
    const blocked = await fetch(`${base}/x`);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    t += 61000;
    assert.equal((await fetch(`${base}/x`)).status, 200);
  });
});

test('client ip ignores a spoofed X-Forwarded-For when no proxy is trusted', async () => {
  const app = express();
  app.get('/ip', (req, res) => res.json({ ip: getClientIp(req) }));
  await withServer(app, async base => {
    const body = await (await fetch(`${base}/ip`, { headers: { 'x-forwarded-for': '6.6.6.6' } })).json();
    assert.notEqual(body.ip, '6.6.6.6');
  });
});

test('client ip honors exactly one trusted proxy hop', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/ip', (req, res) => res.json({ ip: getClientIp(req) }));
  await withServer(app, async base => {
    // Proxy appends the real peer last; a client-injected leftmost value must not win.
    const body = await (await fetch(`${base}/ip`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } })).json();
    assert.equal(body.ip, '203.0.113.9');
  });
});

test('slow request logger warns only at or above the threshold', async () => {
  const { slowRequestLogger } = require('../dist/middleware/slowRequestLogger');
  const warnings = [];
  const origWarn = console.warn; console.warn = line => warnings.push(JSON.parse(line));
  let t = 0;
  try {
    const app = express();
    app.use(slowRequestLogger(100, () => t));
    app.get('/fast', (_req, res) => { t += 10; res.json({}); });
    app.get('/slow', (_req, res) => { t += 250; res.json({}); });
    await withServer(app, async base => {
      await fetch(`${base}/fast`); await fetch(`${base}/slow`);
    });
  } finally { console.warn = origWarn; }
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].event, 'http.slow_request');
  assert.equal(warnings[0].path, '/slow');
});
