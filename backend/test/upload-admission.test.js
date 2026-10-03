const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { config } = require('../dist/config');
const db = require('../dist/config/database');

test('cover and emoji routes reject full storage before multipart disk writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-admission-'));
  const originalDir = config.UPLOADS_DIR;
  const originalLimit = config.UPLOADS_MAX_BYTES;
  const originalQuery = db.query;
  config.UPLOADS_DIR = dir;
  config.UPLOADS_MAX_BYTES = 1024;
  fs.writeFileSync(path.join(dir, 'occupied'), Buffer.alloc(1024));
  db.query = async () => [{ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' }];
  const app = express();
  app.use((req, _res, next) => { req.userId = 'capacity-owner'; next(); });
  app.use('/pages', require('../dist/routes/pages').default);
  app.use('/emojis', require('../dist/routes/emojis').default);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    for (const [url, field] of [['/pages/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/cover', 'cover'], ['/emojis/custom', 'emoji']]) {
      const form = new FormData();
      form.append(field, new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'synthetic.png');
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: 'POST', body: form })).status, 507);
    }
    assert.deepEqual(fs.readdirSync(dir), ['emojis', 'occupied']);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'emojis')), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.query = originalQuery;
    config.UPLOADS_DIR = originalDir;
    config.UPLOADS_MAX_BYTES = originalLimit;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
