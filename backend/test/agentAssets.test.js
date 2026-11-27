const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.JWT_SECRET = 'synthetic-test-only-jwt-secret-for-agent-assets';
const { uploadAgentAsset, listAgentAssets, InvalidAgentAsset } = require('../dist/services/agentAssets');
const { config } = require('../dist/config');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
const owner = '00000000-0000-4000-8000-000000000001';

test('uploads a valid owned image and lists only rows scoped to the owner', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-agent-image-'));
  const previous = config.UPLOADS_DIR;
  config.UPLOADS_DIR = directory;
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT')) return { rows: [{ relative_path: 'design/synthetic.png', created_at: '2026-01-01T00:00:00Z' }] };
    return { rows: [{ relative_path: params[0] }] };
  } };
  try {
    const result = await uploadAgentAsset(client, owner, { name: 'synthetic.png', mime_type: 'image/png', data_base64: png });
    assert.match(result.url, /^\/uploads\/design\/[0-9a-f]{64}\.png$/);
    assert.equal(result.size_bytes, Buffer.from(png, 'base64').length);
    assert.deepEqual(await fs.readFile(path.join(directory, result.url.slice('/uploads/'.length))), Buffer.from(png, 'base64'));
    assert.equal(queries[0].params[1], owner);
    const listing = await listAgentAssets(client, owner, 20, 0);
    assert.deepEqual(listing.items, [{ url: '/uploads/design/synthetic.png', created_at: '2026-01-01T00:00:00Z' }]);
    assert.equal(queries[1].params[0], owner);
  } finally { config.UPLOADS_DIR = previous; await fs.rm(directory, { recursive: true, force: true }); }
});

test('rejects traversal, wrong type, malformed encoding and forged file signature', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-agent-image-'));
  const previous = config.UPLOADS_DIR;
  config.UPLOADS_DIR = directory;
  const client = { query: async () => { throw new Error('database should not be touched'); } };
  try {
    for (const input of [
      { name: '../outside.png', mime_type: 'image/png', data_base64: png },
      { name: 'wrong.svg', mime_type: 'image/svg+xml', data_base64: png },
      { name: 'broken.png', mime_type: 'image/png', data_base64: 'not-base64' },
      { name: 'fake.png', mime_type: 'image/png', data_base64: Buffer.from('not an image').toString('base64') },
    ]) await assert.rejects(uploadAgentAsset(client, owner, input), InvalidAgentAsset);
    assert.equal((await fs.readdir(directory)).length, 1); // only the empty design directory may be created
    assert.deepEqual(await fs.readdir(path.join(directory, 'design')), []);
  } finally { config.UPLOADS_DIR = previous; await fs.rm(directory, { recursive: true, force: true }); }
});

test('rejects another account claiming an existing content-addressed path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-agent-image-'));
  const previous = config.UPLOADS_DIR;
  config.UPLOADS_DIR = directory;
  const client = { query: async () => ({ rows: [] }) };
  try {
    await assert.rejects(uploadAgentAsset(client, owner, { name: 'synthetic.png', mime_type: 'image/png', data_base64: png }),
      error => error instanceof InvalidAgentAsset && error.status === 403);
  } finally { config.UPLOADS_DIR = previous; await fs.rm(directory, { recursive: true, force: true }); }
});

test('caps image uploads per account while allowing another account', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-agent-image-'));
  const previous = config.UPLOADS_DIR;
  config.UPLOADS_DIR = directory;
  const first = '00000000-0000-4000-8000-000000000011';
  const second = '00000000-0000-4000-8000-000000000012';
  const client = { query: async (_sql, params) => ({ rows: [{ relative_path: params[0] }] }) };
  const input = { name: 'synthetic.png', mime_type: 'image/png', data_base64: png };
  try {
    for (let i = 0; i < 6; i++) await uploadAgentAsset(client, first, input);
    await assert.rejects(uploadAgentAsset(client, first, input),
      error => error instanceof InvalidAgentAsset && error.status === 429);
    assert.match((await uploadAgentAsset(client, second, input)).url, /^\/uploads\/design\//);
  } finally { config.UPLOADS_DIR = previous; await fs.rm(directory, { recursive: true, force: true }); }
});
