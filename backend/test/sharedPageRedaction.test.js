const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const pagesRouter = require('../dist/routes/pages').default;

const pageId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const fullPage = {
  id: pageId, type: 'note', title: 'Shared', revision: 0, owner_user_id: 'owner',
  working_directory: '/synthetic/private/work', markdown_source: '/synthetic/private/note.md',
  content: { type: 'doc', content: [{ type: 'subPageBlock', attrs: {
    pageId: 'child', title: 'Private child title', icon: 'x',
  } }] },
};

async function serve() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-test-user']; next(); });
  app.use('/api/pages', pagesRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/api/pages/${pageId}` };
}

function assertRedacted(page) {
  assert.equal(page.owner_user_id, undefined);
  assert.equal(page.working_directory, undefined);
  assert.equal(page.markdown_source, undefined);
  assert.equal(page.content.content[0].attrs.title, 'Página privada');
  assert.equal(page.content.content[0].attrs.pageId, null);
}

test('shared GET, PUT and PATCH responses redact owner-only fields', async () => {
  const originalQuery = database.query;
  const originalConnect = database.pool.connect;
  database.query = async (sql, params = []) => {
    if (sql.includes('SELECT * FROM pages')) return [fullPage];
    if (sql.includes('CASE WHEN p.owner_user_id')) return [{ role: params[1] === 'owner' ? 'owner' : 'editor' }];
    return [];
  };
  database.pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (sql.includes('SELECT * FROM pages')) return { rows: [fullPage] };
      if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: [{ role: params[1] === 'owner' ? 'owner' : 'editor' }] };
      if (sql.includes('UPDATE pages SET')) return { rows: [{ ...fullPage, revision: 1 }] };
      return { rows: [] };
    }, release: () => {},
  });
  const { server, url } = await serve();
  try {
    const get = async (user) => {
      const response = await fetch(url, { headers: { 'x-test-user': user } });
      assert.equal(response.status, 200);
      return response.json();
    };
    assertRedacted(await get('editor'));
    assert.equal((await get('owner')).working_directory, fullPage.working_directory);
    for (const [method, body] of [
      ['PUT', { content: { type: 'doc', content: [] }, revision: 0 }],
      ['PATCH', { title: 'Shared update', revision: 0 }],
    ]) {
      const send = async (user) => {
        const response = await fetch(url, { method, headers: {
          'x-test-user': user, 'Content-Type': 'application/json',
        }, body: JSON.stringify(body) });
        assert.equal(response.status, 200, `${method} ${user}`);
        return response.json();
      };
      assertRedacted(await send('editor'));
      assert.equal((await send('owner')).working_directory, fullPage.working_directory);
    }
  } finally {
    database.query = originalQuery;
    database.pool.connect = originalConnect;
    await new Promise((resolve) => server.close(resolve));
  }
});
