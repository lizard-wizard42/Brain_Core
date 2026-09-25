const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { getClientIp } = require('../dist/middleware/clientIp');
const {
  loginIpRateLimitMiddleware,
  registerFailedIpLoginAttempt,
} = require('../dist/services/loginProtectionService');
const { config, parseTrustedProxies } = require('../dist/config');

function requestIp(trustProxy, forwardedFor) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: '/',
        headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close();
          resolve(JSON.parse(body).ip);
        });
      });
      req.on('error', (error) => { server.close(); reject(error); });
      req.end();
    });
  });
}

test('ignores forwarding headers when the peer is not trusted', async () => {
  assert.equal(await requestIp(false, '198.51.100.10'), '127.0.0.1');
});

test('public configuration trusts no proxy unless explicitly configured', () => {
  assert.equal(parseTrustedProxies(undefined), false);
  assert.equal(parseTrustedProxies(''), false);
  assert.deepEqual(parseTrustedProxies('loopback, 10.0.0.5'), ['loopback', '10.0.0.5']);
});

test('uses the rightmost untrusted address and ignores a spoofed prefix', async () => {
  assert.equal(
    await requestIp(['loopback'], '192.0.2.99, 198.51.100.20'),
    '198.51.100.20',
  );
});

test('client IP helper never reads X-Forwarded-For directly', () => {
  const req = {
    ip: '203.0.113.7',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '192.0.2.1' },
  };
  assert.equal(getClientIp(req), '203.0.113.7');
});

test('forged header changes share the same limiter bucket', () => {
  const req = {
    ip: '203.0.113.88',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  };
  for (let index = 0; index < config.LOGIN_IP_MAX_ATTEMPTS; index += 1) {
    req.headers['x-forwarded-for'] = `192.0.2.${index}`;
    registerFailedIpLoginAttempt(req);
  }

  let status = 0;
  const res = {
    setHeader() {},
    status(code) { status = code; return this; },
    json() {},
  };
  loginIpRateLimitMiddleware(req, res, () => { status = 200; });
  assert.equal(status, 429);
});
