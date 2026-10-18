const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const router = require('../dist/routes/mobile').default;
test('reminders require valid device and only select its account metadata', async () => {
  const saved = database.query;
  let valid = true, read = false;
  database.query = async (sql, params) => {
    if (sql.includes('SELECT d.id, d.user_id')) return valid ? [{ id: 'device', user_id: 'owner-a' }] : [];
    if (sql.includes('FROM remember_notes')) {
      read = true; assert.deepEqual(params, ['owner-a']); assert.match(sql, /WHERE user_id = \$1/);
      assert.doesNotMatch(sql, /\bbody\b|\btitle\b|\bchecklist\b/);
      return [{ id: 'note-a', reminder_date: '2026-12-01', reminder_time: '09:00:00', reminder_repeat_daily: false }];
    }
    return [];
  };
  const app = express(); app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/reminders?user_id=other-owner`;
  const headers = { Authorization: `Bearer bcmd_${'a'.repeat(43)}` };
  try {
    assert.equal((await fetch(url)).status, 401); assert.equal(read, false);
    const response = await fetch(url, { headers }); assert.equal(response.status, 200);
    assert.equal((await response.json()).reminders.length, 1); assert.equal(read, true);
    valid = false; read = false;
    assert.equal((await fetch(url, { headers })).status, 401); assert.equal(read, false);
  } finally { database.query = saved; await new Promise(resolve => server.close(resolve)); }
});
