const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const pagesRouter = require('../dist/routes/pages').default;
const { requireUploadedAssetOwner } = require('../dist/services/uploadOwnership');
const { ownerOnly } = require('../dist/middleware/ownerOnly');

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-test-user']; next(); });
  app.use(router);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      server, origin: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

test('a member cannot read or nest a page belonging to another account', async () => {
  const original = database.query;
  const pageId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const calls = [];
  database.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM pages WHERE id = $1 AND owner_user_id = $2')) {
      return params[1] === 'owner-a' ? [{ id: pageId }] : [];
    }
    return [];
  };
  const { server, origin } = await serve(pagesRouter);
  try {
    const read = await fetch(`${origin}/${pageId}`, { headers: { 'x-test-user': 'member-b' } });
    assert.equal(read.status, 404);
    assert.equal(calls.length, 1, 'foreign page must stop before the controller');

    const nested = await fetch(origin, {
      method: 'POST', headers: { 'x-test-user': 'member-b', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'private', slug: 'private', parent_page_id: pageId }),
    });
    assert.equal(nested.status, 404);
    assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO pages')));
  } finally {
    database.query = original;
    await new Promise(resolve => server.close(resolve));
  }
});

test('uploaded files and host terminal are scoped to their owner', async () => {
  const original = database.query;
  database.query = async (sql, params) => {
    if (sql.includes('FROM uploaded_assets')) return params[1] === 'owner-a' ? [{ relative_path: params[0] }] : [];
    if (sql.includes('SELECT role FROM users')) return [{ role: params[0] === 'owner-a' ? 'owner' : 'member' }];
    return [];
  };
  const router = express.Router();
  router.get('/asset/:name', requireUploadedAssetOwner, (_req, res) => res.send('private'));
  router.get('/terminal', ownerOnly, (_req, res) => res.send('host'));
  const { server, origin } = await serve(router);
  try {
    assert.equal((await fetch(`${origin}/asset/private.png`, { headers: { 'x-test-user': 'member-b' } })).status, 404);
    assert.equal((await fetch(`${origin}/asset/private.png`, { headers: { 'x-test-user': 'owner-a' } })).status, 200);
    assert.equal((await fetch(`${origin}/terminal`, { headers: { 'x-test-user': 'member-b' } })).status, 403);
    assert.equal((await fetch(`${origin}/terminal`, { headers: { 'x-test-user': 'owner-a' } })).status, 200);
  } finally {
    database.query = original;
    await new Promise(resolve => server.close(resolve));
  }
});
