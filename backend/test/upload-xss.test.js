const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { coverImageFilter, setUploadHeaders, isSafeImageUpload } = require('../dist/services/uploadSafety');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      server, origin: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

test('cover upload rejects script-capable files (synthetic fixtures)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'));
  const upload = multer({ dest: dir, fileFilter: coverImageFilter });
  const app = express();
  app.post('/cover', upload.single('cover'), (req, res) => res.json({ stored: !!req.file }));
  const { server, origin } = await listen(app);
  const send = async (name, type, body) => {
    const form = new FormData();
    form.append('cover', new Blob([body], { type }), name);
    return (await fetch(`${origin}/cover`, { method: 'POST', body: form })).json();
  };
  try {
    assert.equal((await send('x.html', 'text/html', '<script>1</script>')).stored, false);
    assert.equal((await send('x.svg', 'image/svg+xml', '<svg onload="1"/>')).stored, false);
    assert.equal((await send('x.html', 'image/png', '<script>1</script>')).stored, false, 'mime spoof');
    assert.equal((await send('x.png', 'text/html', 'x')).stored, false);
    assert.equal((await send('x.png', 'image/png', 'x')).stored, true);
    assert.equal(isSafeImageUpload({ originalname: 'A.JPG', mimetype: 'image/jpeg' }), true);
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy html/svg in uploads is served as sandboxed attachment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  fs.writeFileSync(path.join(dir, 'evil.html'), '<script>fetch("/api")</script>');
  fs.writeFileSync(path.join(dir, 'evil.svg'), '<svg onload="1"/>');
  fs.writeFileSync(path.join(dir, 'ok.png'), 'png');
  const app = express();
  app.use('/uploads', express.static(dir, { setHeaders: setUploadHeaders }));
  const { server, origin } = await listen(app);
  try {
    for (const name of ['evil.html', 'evil.svg']) {
      const res = await fetch(`${origin}/uploads/${name}`);
      assert.equal(res.headers.get('content-type'), 'application/octet-stream');
      assert.equal(res.headers.get('content-disposition'), 'attachment');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-security-policy'), /sandbox/);
    }
    const ok = await fetch(`${origin}/uploads/ok.png`);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('content-disposition'), null);
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
