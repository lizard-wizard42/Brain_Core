const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const pagesRouter = require('../dist/routes/pages').default;
const pageId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const roles = { A: 'owner', B: 'editor', C: 'viewer', D: null };

async function serve() {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-test-user']; next(); });
  app.use(pagesRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('A/B/C/D access matrix hides page and history from unauthorized accounts', async () => {
  const original = database.query;
  database.query = async (sql, params = []) => {
    if (sql.includes('CASE WHEN p.owner_user_id')) return roles[params[1]] ? [{ role: roles[params[1]] }] : [];
    if (sql.includes('SELECT id FROM pages WHERE id = $1 AND owner_user_id')) return params[1] === 'A' ? [{ id: pageId }] : [];
    if (sql.includes('SELECT * FROM pages')) return [{ id: pageId, type: 'note', title: 'secret', content: { type: 'doc', content: [] }, revision: 0 }];
    if (sql.includes('FROM page_versions v')) return [{ id: 'version-1', title: 'secret', content: { type: 'doc', content: [] } }];
    return [];
  };
  const { server, origin } = await serve();
  try {
    for (const [user, expected] of Object.entries({ A: [200, 200], B: [200, 200], C: [200, 404], D: [404, 404] })) {
      const headers = { 'x-test-user': user };
      assert.equal((await fetch(`${origin}/${pageId}`, { headers })).status, expected[0], user);
      assert.equal((await fetch(`${origin}/${pageId}/versions`, { headers })).status, expected[1], user);
    }
    for (const user of ['B', 'C', 'D']) {
      assert.equal((await fetch(`${origin}/${pageId}/grants`, { headers: { 'x-test-user': user } })).status, 404);
    }
  } finally { database.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('revocation and two concurrent revisions reject stale saves', async () => {
  const { pool } = database;
  const originalConnect = pool.connect;
  const { savePageRevision, PageConflict, PageMissing } = require('../dist/services/pageAccess');
  let revision = 0;
  let role = 'editor';
  let chain = Promise.resolve();
  pool.connect = async () => {
    let unlock;
    return {
      query: async (sql, params = []) => {
        if (sql === 'BEGIN') {
          const previous = chain;
          chain = new Promise(resolve => { unlock = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock(); return { rows: [] }; }
        if (sql.includes('SELECT * FROM pages')) return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision, owner_user_id: 'A' }] };
        if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: role ? [{ role }] : [] };
        if (sql.includes('UPDATE pages SET')) { revision++; return { rows: [{ title: 't', content: { type: 'doc', content: [] }, revision }] }; }
        return { rows: [] };
      },
      release: () => {},
    };
  };
  try {
    const changes = { content: { type: 'doc', content: [] } };
    const results = await Promise.allSettled([
      savePageRevision(pageId, 'B', 0, changes, 'content'),
      savePageRevision(pageId, 'B', 0, changes, 'content'),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(results.some(result => result.status === 'rejected' && result.reason instanceof PageConflict));
    role = null;
    await assert.rejects(savePageRevision(pageId, 'B', 1, changes, 'content'), PageMissing);
  } finally { pool.connect = originalConnect; }
});

test('grants contract is owner-only and /shared lists both directions', async () => {
  const original = database.query;
  const editorId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const grantRow = { user_id: editorId, email: 'editor@test.local', name: 'Editor', role: 'editor', granted_at: '2026-01-01T00:00:00Z' };
  database.query = async (sql, params = []) => {
    if (sql.includes('SELECT id FROM pages WHERE id = $1 AND owner_user_id')) return params[1] === 'A' ? [{ id: pageId }] : [];
    if (sql.includes('FROM page_grants g JOIN users u')) return [grantRow];
    if (sql.includes('INSERT INTO page_grants')) return params[1] === editorId ? [{ user_id: params[1], role: params[2] }] : [];
    if (sql.includes('DELETE FROM page_grants')) return [];
    if (sql.includes('JOIN pages p')) return params[0] === 'B' ? [{ id: pageId, title: 'secret', revision: 3, role: 'editor', last_editor: 'A', last_edited_at: '2026-01-02T00:00:00Z' }] : [];
    if (sql.includes('EXISTS (SELECT 1 FROM page_grants')) return params[0] === 'A' ? [{ id: pageId, title: 'secret', revision: 3, role: 'owner' }] : [];
    return [];
  };
  const { server, origin } = await serve();
  try {
    const put = (user, grantee, role) => fetch(`${origin}/${pageId}/grants/${grantee}`, {
      method: 'PUT', headers: { 'x-test-user': user, 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    assert.equal((await put('A', editorId, 'viewer')).status, 200);
    assert.equal((await put('B', editorId, 'editor')).status, 404);
    assert.equal((await put('D', editorId, 'editor')).status, 404);
    assert.equal((await put('A', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'editor')).status, 400);
    assert.equal((await put('A', editorId, 'owner')).status, 400);
    assert.equal((await put('A', 'not-a-uuid', 'editor')).status, 400);
    assert.equal((await fetch(`${origin}/${pageId}/grants/${editorId}`, { method: 'DELETE', headers: { 'x-test-user': 'A' } })).status, 200);
    assert.equal((await fetch(`${origin}/${pageId}/grants/${editorId}`, { method: 'DELETE', headers: { 'x-test-user': 'B' } })).status, 404);
    const received = await (await fetch(`${origin}/shared?direction=received`, { headers: { 'x-test-user': 'B' } })).json();
    assert.equal(received.length, 1);
    assert.equal(received[0].role, 'editor');
    assert.equal(received[0].last_editor, 'A');
    const sent = await (await fetch(`${origin}/shared?direction=sent`, { headers: { 'x-test-user': 'A' } })).json();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].role, 'owner');
    assert.equal((await fetch(`${origin}/shared`, { headers: { 'x-test-user': 'D' } })).status, 200);
  } finally { database.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('REST optimistic save: 409 on stale revision, viewers and editors restricted', async () => {
  const originalQuery = database.query;
  const { pool } = database;
  const originalConnect = pool.connect;
  let revision = 1;
  const roles = { A: 'owner', B: 'editor', C: 'viewer', D: null };
  let chain = Promise.resolve();
  let unlock = () => {};
  database.query = async (sql, params = []) => {
    if (sql.includes('CASE WHEN p.owner_user_id')) return roles[params[1]] ? [{ role: roles[params[1]] }] : [];
    if (sql.includes('SELECT id FROM pages WHERE id = $1 AND owner_user_id')) return params[1] === 'A' ? [{ id: pageId }] : [];
    if (sql.includes('SELECT owner_user_id, title, icon')) return [];
    return [];
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (sql === 'BEGIN') {
        const previous = chain;
        chain = new Promise(resolve => { unlock = resolve; });
        await previous;
        return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock(); return { rows: [] }; }
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision, owner_user_id: 'A' }] };
      if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: roles[params[1]] ? [{ role: roles[params[1]] }] : [] };
      if (sql.includes('UPDATE pages SET')) { revision++; return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision }] }; }
      if (sql.includes('INSERT INTO page_versions')) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  });
  const { server, origin } = await serve();
  const put = (user, body) => fetch(`${origin}/${pageId}`, {
    method: 'PUT', headers: { 'x-test-user': user, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const patch = (user, body) => fetch(`${origin}/${pageId}`, {
    method: 'PATCH', headers: { 'x-test-user': user, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    const changes = { content: { type: 'doc', content: [] } };
    const raced = await Promise.all([put('B', { ...changes, revision: 1 }), put('B', { ...changes, revision: 1 })]);
    const statuses = raced.map(r => r.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal((await put('C', { ...changes, revision: revision })).status, 404);
    assert.equal((await patch('B', { tags: ['x'], revision })).status, 404);
    assert.equal((await patch('D', { title: 'x', revision })).status, 404);
    const ownerPatch = await patch('A', { title: 'novo', revision });
    assert.equal(ownerPatch.status, 200);
    const ownerBody = await ownerPatch.json();
    assert.equal(ownerBody.revision, revision);
    assert.equal(typeof ownerBody.revision, 'number');
  } finally {
    await new Promise(resolve => setImmediate(resolve));
    pool.connect = originalConnect;
    database.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  }
});

test('version history exposes author/date/revision to owner and editor, never to viewer', async () => {
  const original = database.query;
  const roles2 = { A: 'owner', B: 'editor', C: 'viewer', D: null };
  let currentUser = 'A';
  const secretContent = { type: 'doc', content: [{ type: 'subPageBlock', attrs: { pageId: 'child', title: 'Segredo', icon: '🔒' } }] };
  database.query = async (sql) => {
    if (sql.includes('CASE WHEN p.owner_user_id')) return roles2[currentUser] ? [{ role: roles2[currentUser] }] : [];
    if (sql.includes('FROM page_versions v')) return [{ id: 'v1', title: 'secret', content: secretContent, author_user_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', author_name: 'Bob', page_revision: 7, created_at: '2026-01-03T10:00:00Z' }];
    return [];
  };
  const { server, origin } = await serve();
  try {
    const asUser = async (user) => {
      currentUser = user;
      const response = await fetch(`${origin}/${pageId}/versions`, { headers: { 'x-test-user': user } });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    };
    const owner = await asUser('A');
    assert.equal(owner.status, 200);
    assert.equal(owner.body.versions[0].author_name, 'Bob');
    assert.equal(owner.body.versions[0].page_revision, 7);
    assert.equal(owner.body.versions[0].created_at, '2026-01-03T10:00:00Z');
    assert.equal(owner.body.versions[0].content.content[0].attrs.title, 'Segredo');
    const editor = await asUser('B');
    assert.equal(editor.status, 200);
    assert.equal(editor.body.versions[0].content.content[0].attrs.title, 'Página privada');
    assert.equal(editor.body.versions[0].author_name, 'Bob');
    assert.equal((await asUser('C')).status, 404);
    assert.equal((await asUser('D')).status, 404);
  } finally { database.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('socket contract: join needs access, save enforces role+revision, revoke evicts from room', async () => {
  const originalQuery = database.query;
  const { pool } = database;
  const originalConnect = pool.connect;
  const auth = require('../dist/middleware/auth');
  const originalExtract = auth.extractAccessToken;
  const originalAuthenticate = auth.authenticateAccessToken;
  const { registerSocketHandlers, notifyPageGrantChanged } = require('../dist/services/socketService');
  const rolesByUser = { B: 'editor', C: 'viewer', D: null };
  let revision = 5;
  try {
    database.query = async (sql, params = []) => {
      if (sql.includes('SELECT role FROM users')) return [{ role: 'owner' }];
      if (sql.includes('CASE WHEN p.owner_user_id')) {
        const role = rolesByUser[params[1]];
        return role ? [{ role }] : [];
      }
      return [];
    };
    auth.extractAccessToken = (headers) => headers['x-test-token'] || null;
    auth.authenticateAccessToken = async (token) => ({ sub: String(token).replace('token-', '') });
    pool.connect = async () => ({
      query: async (sql, params = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision, owner_user_id: 'A' }] };
        if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: rolesByUser[params[1]] ? [{ role: rolesByUser[params[1]] }] : [] };
        if (sql.includes('UPDATE pages SET')) { revision++; return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision }] }; }
        if (sql.includes('INSERT INTO page_versions')) return { rows: [] };
        return { rows: [] };
      },
      release: () => {},
    });

    const middleware = [];
    const onConnection = [];
    const io = {
      use: fn => middleware.push(fn),
      on: (event, fn) => { if (event === 'connection') onConnection.push(fn); },
      sockets: { sockets: new Map() },
    };
    registerSocketHandlers(io);
    assert.equal(middleware.length, 1);
    assert.equal(onConnection.length, 1);

    function makeSocket(user) {
      const socket = {
        id: `socket-${user}`,
        data: {},
        rooms: new Set(),
        emitted: [],
        handlers: {},
        handshake: { headers: { 'x-test-token': `token-${user}` } },
        join(room) { socket.rooms.add(room); },
        leave(room) { socket.rooms.delete(room); },
        emit(event, payload) { socket.emitted.push({ event, payload }); },
        to(room) { return { emit: (event, payload) => socket.emitted.push({ event, payload, room }) }; },
        on(event, fn) { socket.handlers[event] = fn; },
        use() {}, disconnect() {},
      };
      return socket;
    }
    async function connect(user) {
      const socket = makeSocket(user);
      const outcomes = [];
      await middleware[0](socket, error => { if (error) outcomes.push(error); });
      assert.equal(outcomes.length, 0, user);
      onConnection[0](socket);
      return socket;
    }

    const anonymous = makeSocket('X');
    anonymous.handshake.headers = {};
    const denied = [];
    await middleware[0](anonymous, error => { if (error) denied.push(error); });
    assert.equal(denied[0]?.message, 'Unauthorized');

    const editor = await connect('B');
    const viewer = await connect('C');
    const outsider = await connect('D');

    await outsider.handlers['page:join']({ pageId });
    assert.deepEqual(outsider.emitted, [{ event: 'page:error', payload: { pageId, message: 'Page not found' } }]);
    assert.ok(!outsider.rooms.has(`page:${pageId}`));
    await viewer.handlers['page:join']({ pageId });
    assert.ok(viewer.rooms.has(`page:${pageId}`));
    await editor.handlers['page:join']({ pageId });
    assert.ok(editor.rooms.has(`page:${pageId}`));

    const changes = { type: 'doc', content: [] };
    await viewer.handlers['page:save']({ pageId, content: changes, revision });
    assert.equal(viewer.emitted.at(-1).event, 'page:error');
    assert.equal(viewer.emitted.at(-1).payload.message, 'Page not found');
    assert.equal(revision, 5);

    await editor.handlers['page:save']({ pageId, content: changes, revision });
    assert.equal(editor.emitted.at(-2).event, 'page:saved');
    assert.equal(editor.emitted.at(-2).payload.revision, 6);
    assert.equal(editor.emitted.at(-1).event, 'page:updated');
    assert.equal(editor.emitted.at(-1).payload.revision, 6);
    assert.equal(editor.emitted.at(-1).room, `page:${pageId}`);

    await editor.handlers['page:save']({ pageId, content: changes, revision: 5 });
    assert.equal(editor.emitted.at(-1).event, 'page:error');
    assert.equal(editor.emitted.at(-1).payload.message, 'Conflict');

    io.sockets.sockets.set(editor.id, editor);
    io.sockets.sockets.set(viewer.id, viewer);
    notifyPageGrantChanged(pageId, 'B');
    assert.ok(!editor.rooms.has(`page:${pageId}`));
    assert.deepEqual(editor.emitted.at(-1), { event: 'share:changed', payload: { pageId } });
    assert.ok(viewer.rooms.has(`page:${pageId}`));
  } finally {
    auth.extractAccessToken = originalExtract;
    auth.authenticateAccessToken = originalAuthenticate;
    pool.connect = originalConnect;
    database.query = originalQuery;
  }
});

test('save transaction rolls back and keeps revision when version insert fails', async () => {
  const { pool } = database;
  const originalConnect = pool.connect;
  const { savePageRevision } = require('../dist/services/pageAccess');
  const calls = [];
  let revision = 7;
  let beginRevision = 7;
  let failInsert = true;
  pool.connect = async () => ({
    query: async (sql) => {
      calls.push(sql);
      if (sql === 'BEGIN') { beginRevision = revision; return { rows: [] }; }
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') { revision = beginRevision; return { rows: [] }; }
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision, owner_user_id: 'A' }] };
      if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: [{ role: 'owner' }] };
      if (sql.includes('UPDATE pages SET')) { revision++; return { rows: [{ id: pageId, title: 't2', content: { type: 'doc', content: [] }, revision }] }; }
      if (sql.includes('INSERT INTO page_versions')) {
        if (failInsert) throw new Error('version insert failed');
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    await assert.rejects(savePageRevision(pageId, 'A', 7, { title: 't2' }, 'metadata'), /version insert failed/);
    assert.equal(calls.filter(sql => sql === 'ROLLBACK').length, 1);
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(revision, 7);
    calls.length = 0;
    failInsert = false;
    const saved = await savePageRevision(pageId, 'A', 7, { title: 't2' }, 'metadata');
    assert.equal(saved.revision, 8);
    assert.ok(calls.includes('COMMIT'));
    assert.ok(!calls.includes('ROLLBACK'));
  } finally { pool.connect = originalConnect; }
});

test('parent changes are owner-only and reject self and cycle references', async () => {
  const { pool } = database;
  const originalConnect = pool.connect;
  const { savePageRevision, PageMissing } = require('../dist/services/pageAccess');
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision: 1, owner_user_id: 'A' }] };
      if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: params[1] === 'A' ? [{ role: 'owner' }] : [{ role: 'editor' }] };
      if (sql.includes('owner_user_id = $2') && sql.includes('SELECT id FROM pages')) {
        return params[1] === 'A' && params[0] === 'cccccccc-cccc-4ccc-cccc-cccccccccccc' ? { rows: [{ id: params[0] }] } : { rows: [] };
      }
      if (sql.includes('WITH RECURSIVE ancestors')) {
        return params[0] === 'dddddddd-dddd-4ddd-dddd-dddddddddddd' ? { rows: [{ id: 1 }] } : { rows: [] };
      }
      if (sql.startsWith('UPDATE pages SET')) return { rows: [{ id: pageId, title: 't', content: { type: 'doc', content: [] }, revision: 2 }] };
      return { rows: [] };
    },
    release: () => {},
  });
  try {
    await assert.rejects(savePageRevision(pageId, 'B', 1, { parent_page_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' }, 'metadata'), PageMissing);
    await assert.rejects(savePageRevision(pageId, 'A', 1, { parent_page_id: pageId }, 'metadata'), PageMissing);
    await assert.rejects(savePageRevision(pageId, 'A', 1, { parent_page_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd' }, 'metadata'), PageMissing);
    const moved = await savePageRevision(pageId, 'A', 1, { parent_page_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' }, 'metadata');
    assert.ok(moved);
  } finally { pool.connect = originalConnect; }
});

test('folder share cascades grants to subpages and revoke strips them', async () => {
  const original = database.query;
  const editorId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const descendants = [{ page_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd' }, { page_id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee' }];
  const calls = [];
  database.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM pages WHERE id = $1 AND owner_user_id')) return params[1] === 'A' ? [{ id: pageId }] : [];
    if (sql.includes('WITH RECURSIVE') && sql.includes('INSERT INTO page_grants')) return descendants;
    if (sql.includes('WITH RECURSIVE') && sql.includes('DELETE FROM page_grants')) return descendants;
    if (sql.includes('INSERT INTO page_grants')) return params[1] === editorId ? [{ user_id: editorId, role: params[2] }] : [];
    return [];
  };
  const { server, origin } = await serve();
  try {
    const put = await fetch(`${origin}/${pageId}/grants/${editorId}`, {
      method: 'PUT', headers: { 'x-test-user': 'A', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    assert.equal(put.status, 200);
    const cascade = calls.find(call => call.sql.includes('WITH RECURSIVE') && call.sql.includes('INSERT INTO page_grants'));
    assert.ok(cascade, 'cascade insert must run');
    assert.deepEqual(cascade.params, [pageId, 'A', editorId, 'viewer']);
    const del = await fetch(`${origin}/${pageId}/grants/${editorId}`, { method: 'DELETE', headers: { 'x-test-user': 'A' } });
    assert.equal(del.status, 200);
    const deleted = calls.find(call => call.sql.includes('WITH RECURSIVE') && call.sql.includes('DELETE FROM page_grants'));
    assert.ok(deleted, 'cascade delete must run');
    assert.deepEqual(deleted.params, [pageId, 'A', editorId]);
  } finally { database.query = original; await new Promise(resolve => server.close(resolve)); }
});

test('PUT/PATCH responses for an editor redact owner-only fields like GET', async () => {
  const originalQuery = database.query;
  const { pool } = database;
  const originalConnect = pool.connect;
  const full = {
    id: pageId, type: 'note', title: 't', revision: 0, owner_user_id: 'A',
    working_directory: '/workspace/secret', markdown_source: '/workspace/x.md',
    content: { type: 'doc', content: [{ type: 'subPageBlock', attrs: { pageId: 'p2', title: 'private child', icon: 'x' } }] },
  };
  database.query = async (sql, params = []) => {
    if (sql.includes('CASE WHEN p.owner_user_id')) return [{ role: params[1] === 'A' ? 'owner' : 'editor' }];
    return [];
  };
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      if (sql.includes('SELECT * FROM pages')) return { rows: [full] };
      if (sql.includes('CASE WHEN p.owner_user_id')) return { rows: [{ role: params[1] === 'A' ? 'owner' : 'editor' }] };
      if (sql.includes('UPDATE pages SET')) return { rows: [{ ...full, revision: 1 }] };
      return { rows: [] };
    },
    release: () => {},
  });
  const { server, origin } = await serve();
  try {
    const send = (method, user, body) => fetch(`${origin}/${pageId}`, {
      method, headers: { 'x-test-user': user, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const content = { type: 'doc', content: [] };
    for (const [method, body] of [['PUT', { content, revision: 0 }], ['PATCH', { title: 'n', revision: 0 }]]) {
      const editor = await (await send(method, 'B', body)).json();
      assert.equal(editor.owner_user_id, undefined, method);
      assert.equal(editor.working_directory, undefined, method);
      assert.equal(editor.markdown_source, undefined, method);
      assert.equal(editor.content.content[0].attrs.title, 'Página privada', method);
      const owner = await (await send(method, 'A', body)).json();
      assert.equal(owner.working_directory, '/workspace/secret', method);
    }
  } finally { database.query = originalQuery; pool.connect = originalConnect; await new Promise(resolve => server.close(resolve)); }
});
