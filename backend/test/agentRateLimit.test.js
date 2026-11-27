const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.JWT_SECRET = 'synthetic-test-only-jwt-secret-for-agent-rate-limit';

test('MCP rejects excessive credential attempts before database access', async () => {
  const router = require('../dist/routes/agent').default;
  const app = express();
  app.use('/agent', router);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/agent/design/list`;
    for (let i = 0; i < 600; i++) {
      const response = await fetch(url, { method: 'POST' });
      assert.equal(response.status, 401);
      await response.arrayBuffer();
    }
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
