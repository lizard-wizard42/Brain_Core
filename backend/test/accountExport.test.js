const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const { exportAccountData } = require('../dist/controllers/accountExportController');

test('account export is scoped to the caller and never includes credentials', async () => {
  const original = database.query;
  const calls = [];
  database.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM users WHERE id')) return [{ id: 'u1', email: 'a@test.local' }];
    return [];
  };
  const app = express();
  app.use((req, _res, next) => { req.userId = 'u1'; next(); });
  app.get('/export', exportAccountData);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const origInfo = console.info; console.info = () => {};
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/export`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const body = await res.json();
    assert.equal(body.profile.id, 'u1');
    assert.deepEqual(Object.keys(body).sort(), ['contacts', 'exported_at', 'format_version', 'pages', 'profile', 'quick_notes', 'shared_with_me']);
    for (const { sql, params } of calls) {
      assert.ok(params.includes('u1'), `query not scoped to user: ${sql.slice(0, 60)}`);
      assert.doesNotMatch(sql, /password_hash|two_factor_secret/);
    }
  } finally { console.info = origInfo; database.query = original; await new Promise(r => server.close(r)); }
});
