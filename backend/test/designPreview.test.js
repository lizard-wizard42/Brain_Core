const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
process.env.JWT_SECRET = 'synthetic-test-only-jwt-secret-for-preview';
const database = require('../dist/config/database');
const { storeDesignPreview, getDesignPreview, DesignPreviewError } = require('../dist/services/designPreview');
const express = require('express');

const pageId = '11111111-1111-4111-8111-111111111111';
const frameId = 'shape:synthetic_frame';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+XG5qAAAAAElFTkSuQmCC', 'base64');
let revision = 7;

test('preview cache binds PNG to owner, frame and current revision', async () => {
  const stub = mock.method(database, 'query', async (_sql, [id, owner]) => id === pageId && owner === 'owner'
    ? [{ revision, content: { data: { document: { store: { [frameId]: { typeName: 'shape', type: 'frame' } } } } } }]
    : []);
  try {
    await storeDesignPreview('owner', pageId, 7, frameId, png);
    const result = await getDesignPreview('owner', pageId, frameId);
    assert.equal(result.revision, 7);
    assert.deepEqual(result.bytes, png);
    await assert.rejects(() => getDesignPreview('other-user', pageId, frameId), error => error instanceof DesignPreviewError && error.status === 404);
    revision = 8;
    await assert.rejects(() => getDesignPreview('owner', pageId, frameId), error => error instanceof DesignPreviewError && error.status === 404);
    await assert.rejects(() => storeDesignPreview('owner', pageId, 7, frameId, png), error => error instanceof DesignPreviewError && error.status === 409);
  } finally { stub.mock.restore(); revision = 7; }
});

test('preview rejects malformed PNG and frame identifiers', async () => {
  await assert.rejects(() => storeDesignPreview('owner', pageId, 7, frameId, Buffer.from('not a png')), error => error instanceof DesignPreviewError && error.status === 400);
  await assert.rejects(() => getDesignPreview('owner', pageId, '../another-frame'), error => error instanceof DesignPreviewError && error.status === 400);
});

test('authenticated HTTP PNG upload uses raw body and enforces owner and revision', async () => {
  const stub = mock.method(database, 'query', async (_sql, [id, owner]) => id === pageId && owner === 'owner'
    ? [{ revision: 7, content: { data: { document: { store: { [frameId]: { typeName: 'shape', type: 'frame' } } } } } }]
    : []);
  const app = express();
  app.use(express.json({ limit: '32mb' }));
  app.use('/api/pages', (req, _res, next) => { req.userId = req.header('x-test-user') || 'owner'; next(); }, require('../dist/routes/designPreview').default);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/pages/${pageId}/design-preview`;
    const send = (user, rev, body = png) => fetch(url, { method: 'POST', headers: {
      'Content-Type': 'image/png', 'x-test-user': user, 'x-design-frame-id': frameId,
      'x-design-revision': String(rev),
    }, body });
    assert.equal((await send('owner', 7)).status, 204);
    assert.equal((await send('owner', 6)).status, 409);
    assert.equal((await send('other', 7)).status, 404);
    assert.equal((await send('owner', 7, Buffer.alloc(3 * 1024 * 1024 + 1))).status, 413);
  } finally { await new Promise(resolve => server.close(resolve)); stub.mock.restore(); }
});
