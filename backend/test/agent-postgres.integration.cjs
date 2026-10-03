const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
if (process.env.BRAIN_AGENT_DISPOSABLE !== 'true' || !process.env.DB_HOST?.includes('brain-core-restore-')) {
  throw new Error('Run with scripts/test-agent-postgres.mjs, against a disposable database only');
}
const { pool, query } = require('../dist/config/database');
const router = require('../dist/routes/agent').default;
const integrations = require('../dist/routes/integrations').default;
const { authMiddleware } = require('../dist/middleware/auth');
const jwt = require('jsonwebtoken');
const owner = randomUUID(), other = randomUUID();
let server, origin, writeToken, readToken;
async function token(scopes, changes = {}) {
  const secret = `bc_${randomBytes(32).toString('base64url')}`;
  const id = randomUUID();
  await query('INSERT INTO integration_settings (user_id,enabled) VALUES ($1,TRUE) ON CONFLICT DO NOTHING', [changes.user ?? owner]);
  await query(`INSERT INTO integration_tokens (id,user_id,name,token_hash,session_version,scopes,expires_at,revoked_at)
    VALUES ($1,$2,'synthetic test',$3,$4,$5,$6,$7)`, [id, changes.user ?? owner,
    createHash('sha256').update(secret).digest('hex'), changes.session ?? 1, scopes,
    changes.expires ?? new Date(Date.now() + 60000), changes.revoked ?? null]);
  return { id, secret };
}
async function call(kind, action, body, credential = writeToken) {
  const response = await fetch(`${origin}/api/agent/${kind}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential.secret}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const operation = () => ({ operation_id: randomUUID() });
before(async () => {
  await require('../dist/config/bootstrap').ensureAppSchema();
  await query(`INSERT INTO users (id,email,password_hash,role) VALUES ($1,'owner@example.invalid','not-a-password','owner')`, [owner]);
  await require('../dist/config/accountOwnership').ensureAccountOwnership();
  await query(`INSERT INTO users (id,email,password_hash) VALUES ($1,'member@example.invalid','not-a-password')`, [other]);
  writeToken = await token(['pages:read', 'pages:write', 'notes:read', 'notes:write']);
  readToken = await token(['pages:read', 'notes:read']);
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api/agent', router);
  app.use('/api/integrations', authMiddleware, integrations);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); });

test('credentials expire, revoke and follow password session invalidation; scopes enforced', async () => {
  assert.equal((await call('pages', 'list', {}, null)).status, 401);
  assert.equal((await call('pages', 'list', {}, { secret: 'a-login-jwt' })).status, 401);
  for (const changes of [{ expires: new Date(0) }, { revoked: new Date() }, { session: 0 }]) {
    assert.equal((await call('pages', 'list', {}, await token(['pages:read'], changes))).status, 401);
  }
  assert.equal((await call('pages', 'list', {}, readToken)).status, 200);
  assert.equal((await call('pages', 'create', { ...operation(), title: 'Denied' }, readToken)).status, 403);
});

test('ownership applies to all operations; sections/canvas and internal paths stay outside the API', async () => {
  for (const kind of ['pages', 'notes']) {
    const foreign = await call(kind, 'create', { ...operation(), title: 'Foreign note' }, await token([`${kind}:write`], { user: other }));
    assert.equal(foreign.status, 200);
    for (const action of ['get', 'versions', 'update', 'restore']) {
      const input = action === 'update' ? { ...operation(), title: 'Hidden', expected_revision: 0 }
        : action === 'restore' ? { ...operation(), expected_revision: 0, saved_revision: 0 } : {};
      assert.equal((await call(kind, action, { id: foreign.data.id, ...input })).status, 404);
    }
    assert.ok(!(await call(kind, 'list', {})).data.items.some(item => item.id === foreign.data.id));
  }
  for (const [type, isSection] of [['canvas', false], ['note', true]]) {
    const id = randomUUID();
    await query('INSERT INTO pages (id,owner_user_id,title,slug,type,is_section,working_directory) VALUES ($1::uuid,$2,$3,$1::uuid::text,$4,$5,$6)',
      [id, owner, 'Non-note', type, isSection, '/private/runtime']);
    assert.equal((await call('pages', 'get', { id })).status, 404);
  }
  const page = await call('pages', 'create', { ...operation(), title: 'Visible' });
  assert.deepEqual(Object.keys(page.data).sort(), ['id','title','content','revision','created_at','updated_at'].sort());
  assert.equal((await call('pages', 'update', { ...operation(), id: page.data.id, expected_revision: 0, working_directory: '/arbitrary' })).status, 400);
});

test('concurrent edits, retries and operation IDs do not overwrite or duplicate notes', async () => {
  for (const kind of ['pages', 'notes']) {
    const input = { ...operation(), title: 'Initial' };
    const created = await call(kind, 'create', input);
    assert.equal(created.status, 200);
    assert.deepEqual((await call(kind, 'create', input)).data, created.data);
    assert.equal((await call(kind, 'create', { ...input, title: 'Changed retry' })).status, 409);
    const attempts = [0,1].map(n => ({ ...operation(), id: created.data.id, expected_revision: 0, title: `Edit ${n}` }));
    const results = await Promise.all(attempts.map(input => call(kind, 'update', input)));
    assert.deepEqual(results.map(r => r.status).sort(), [200,409]);
    const winner = results.findIndex(r => r.status === 200);
    assert.deepEqual((await call(kind, 'update', attempts[winner])).data, results[winner].data);
    const current = await call(kind, 'get', { id: created.data.id });
    assert.equal(current.data.revision, 1);
    assert.equal((await call(kind, 'versions', { id: created.data.id })).data.items.length, 2);
    const restored = await call(kind, 'restore', { ...operation(), id: created.data.id, expected_revision: 1, saved_revision: 0 });
    assert.equal(restored.status, 200); assert.equal(restored.data.title, 'Initial'); assert.equal(restored.data.revision, 2);
  }
});

test('existing web writes increment quick-note revision and history while agent preserves metadata', async () => {
  const note = (await call('notes', 'create', { ...operation(), title: 'Start', body: 'First' })).data;
  await query(`UPDATE remember_notes SET body = 'Web edit', checklist = '[{"id":"one","text":"Keep","checked":false}]', tags = '{keep}' WHERE id = $1`, [note.id]);
  assert.equal((await call('notes', 'update', { ...operation(), id: note.id, expected_revision: 0, body: 'Stale' })).status, 409);
  const update = await call('notes', 'update', { ...operation(), id: note.id, expected_revision: 1, title: 'Agent' });
  assert.equal(update.status, 200); assert.equal(update.data.body, 'Web edit');
  const row = (await query('SELECT checklist,tags FROM remember_notes WHERE id = $1', [note.id]))[0];
  assert.equal(row.checklist[0].text, 'Keep'); assert.deepEqual(row.tags, ['keep']);
  assert.equal((await call('notes', 'versions', { id: note.id })).data.items.length, 3);
});

test('audit failure rolls back note, version and idempotency record as one transaction', async () => {
  const note = (await call('pages', 'create', { ...operation(), title: 'Before' })).data;
  await query("ALTER TABLE integration_audit ADD CONSTRAINT synthetic_failure CHECK (operation <> 'update') NOT VALID");
  const input = { ...operation(), id: note.id, expected_revision: 0, title: 'Must rollback' };
  try {
    assert.equal((await call('pages', 'update', input)).status, 500);
    assert.equal((await call('pages', 'get', { id: note.id })).data.title, 'Before');
    assert.equal((await call('pages', 'versions', { id: note.id })).data.items.length, 1);
  } finally { await query('ALTER TABLE integration_audit DROP CONSTRAINT synthetic_failure'); }
  assert.equal((await call('pages', 'update', input)).status, 200);
});

test('validation refuses unsupported fields, oversized bodies and invalid revisions', async () => {
  const note = (await call('notes', 'create', { ...operation(), title: 'Valid' })).data;
  assert.equal((await call('notes', 'update', { ...operation(), id: note.id, expected_revision: -1, title: 'Bad' })).status, 400);
  assert.equal((await call('notes', 'create', { ...operation(), body: 'x'.repeat(5001) })).status, 400);
  assert.equal((await call('pages', 'create', { ...operation(), title: 'Bad', content: { type: 'canvas' } })).status, 400);
  for (const node of [{ type: 'unknown' }, { type: 'text' }, { type: 'image', attrs: { src: 'javascript:alert(1)' } }]) {
    assert.equal((await call('pages', 'create', { ...operation(), title: 'Bad', content: { type: 'doc', content: [node] } })).status, 400);
  }
  assert.equal((await call('notes', 'get', { id: note.id, user_id: other })).status, 400);
  assert.equal((await call('notes', 'list', { limit: 51 })).status, 400);
});

test('a pending revocation prevents a write that has already passed the initial authentication', async () => {
  const credential = await token(['notes:read','notes:write']);
  const note = (await call('notes', 'create', { ...operation(), title: 'Before' }, credential)).data;
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('UPDATE integration_tokens SET revoked_at = NOW() WHERE id = $1', [credential.id]);
    const pending = call('notes', 'update', { ...operation(), id: note.id, expected_revision: 0, title: 'Denied' }, credential);
    await new Promise(resolve => setTimeout(resolve, 50));
    await connection.query('COMMIT');
    assert.equal((await pending).status, 401);
    assert.equal((await call('notes', 'get', { id: note.id })).data.title, 'Before');
  } finally { await connection.query('ROLLBACK'); connection.release(); }
});

test('MCP stdio performs all 12 tools against the real API and PostgreSQL', async () => {
  const mcpRequire = createRequire(path.resolve(__dirname, '../../mcp/package.json'));
  const { Client } = mcpRequire('@modelcontextprotocol/client');
  const { StdioClientTransport } = mcpRequire('@modelcontextprotocol/client/stdio');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mcp-e2e-'));
  const file = path.join(directory, 'credential');
  fs.writeFileSync(file, writeToken.secret, { mode: 0o600 });
  const client = new Client({ name: 'synthetic-e2e', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve(__dirname, '../../mcp/src/server.mjs')],
    env: { BRAIN_CORE_URL: origin, BRAIN_CORE_TOKEN_FILE: file }, stderr: 'pipe' });
  const invoke = async (kind, action, input, expectError = false) => {
    const result = await client.callTool({ name: `brain_${kind}_${action}`, arguments: input });
    assert.equal(result.isError, expectError, `${kind}/${action}: ${result.content[0]?.text}`);
    return JSON.parse(result.content[0].text);
  };
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 12);
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original', marks: [{ type: 'bold' }] }] }] };
    for (const kind of ['pages', 'notes']) {
      const input = { ...operation(), title: `MCP synthetic ${kind}`, ...(kind === 'pages' ? { content: doc } : { body: 'Original' }) };
      const created = await invoke(kind, 'create', input);
      assert.equal(created.revision, 0);
      assert.deepEqual(await invoke(kind, 'create', input), created);
      const listing = await invoke(kind, 'list', { query: `MCP synthetic ${kind}` });
      assert.equal(listing.items.filter(item => item.id === created.id).length, 1);
      assert.deepEqual(await invoke(kind, 'get', { id: created.id }), created);
      const changes = { ...operation(), id: created.id, expected_revision: 0,
        ...(kind === 'pages' ? { title: 'Edited through MCP' } : { body: 'Edited through MCP' }) };
      const edited = await invoke(kind, 'update', changes);
      assert.equal(edited.revision, 1);
      assert.deepEqual(await invoke(kind, 'update', changes), edited);
      await invoke(kind, 'update', { ...changes, ...operation() }, true);
      const history = await invoke(kind, 'versions', { id: created.id });
      assert.deepEqual(history.items.map(item => item.revision), [1, 0]);
      const restored = await invoke(kind, 'restore', { ...operation(), id: created.id, expected_revision: 1, saved_revision: 0 });
      assert.equal(restored.revision, 2);
      assert.equal(restored.title, created.title);
      if (kind === 'pages') assert.deepEqual(restored.content, doc);
      else assert.equal(restored.body, 'Original');
    }
  } finally {
    await client.close(); fs.rmSync(directory, { recursive: true });
  }
});

async function management(method, suffix = '', body, user = owner, originHeader) {
  const access = user ? jwt.sign({ sub: user, sv: 1, type: 'access' }, process.env.JWT_SECRET) : '';
  const response = await fetch(`${origin}/api/integrations/mcp${suffix}`, {
    method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${access}` } : {}),
      ...(originHeader ? { origin: originHeader } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
}

test('settings isolate accounts; token creation validates scope/expiry and returns its secret only once', async () => {
  assert.equal((await management('GET', '', undefined, null)).status, 401);
  assert.equal((await management('PUT', '', { enabled: false }, owner, 'https://untrusted.example.invalid')).status, 403);
  const stranger = randomUUID();
  await query(`INSERT INTO users (id,email,password_hash) VALUES ($1,'settings@example.invalid','not-a-password')`, [stranger]);
  const first = await management('GET', '', undefined, stranger);
  assert.equal(first.data.enabled, false); assert.deepEqual(first.data.tokens, []);
  assert.equal((await management('POST', '/tokens', { name: 'Test', scopes: ['pages:read'], expires_in_days: 7 }, stranger)).status, 409);
  assert.equal((await management('PUT', '', { enabled: true }, stranger)).status, 200);
  for (const body of [
    { name: 'Test', scopes: ['pages:write'], expires_in_days: 7 },
    { name: 'Test', scopes: ['terminal:read'], expires_in_days: 7 },
    { name: 'Test', scopes: ['pages:read'], expires_in_days: 1000 },
    { name: 'Test', scopes: ['pages:read','pages:read'], expires_in_days: 7 },
  ]) assert.equal((await management('POST', '/tokens', body, stranger)).status, 400);
  const result = await management('POST', '/tokens', { name: 'Only pages', scopes: ['pages:read'], expires_in_days: 7 }, stranger);
  assert.equal(result.status, 201); assert.match(result.data.secret, /^bc_[A-Za-z0-9_-]{43}$/);
  assert.equal(result.cache, 'private, no-store');
  const listed = await management('GET', '', undefined, stranger);
  assert.equal(listed.data.tokens.length, 1);
  assert.ok(!JSON.stringify(listed.data).includes(result.data.secret));
  assert.ok(!JSON.stringify(listed.data).includes('token_hash'));
  assert.equal((await call('pages', 'list', {}, { secret: result.data.secret })).status, 200);
  assert.equal((await call('notes', 'list', {}, { secret: result.data.secret })).status, 403);
  assert.equal((await management('DELETE', `/tokens/${writeToken.id}`, undefined, stranger)).status, 404);
  await management('DELETE', '/tokens', undefined, stranger);
  assert.equal((await call('pages', 'list', {}, { secret: result.data.secret })).status, 401);
  assert.equal((await call('pages', 'list', {})).status, 200);
});

test('switch-off blocks reads, writes and idempotent replays; re-enable preserves valid credentials', async () => {
  const input = { ...operation(), title: 'Before switch-off' };
  const created = await call('notes', 'create', input);
  assert.equal((await management('PUT', '', { enabled: false })).status, 200);
  try {
    assert.equal((await call('notes', 'list', {})).status, 401);
    assert.equal((await call('notes', 'get', { id: created.data.id })).status, 401);
    assert.equal((await call('notes', 'create', input)).status, 401);
    const foreign = await token(['pages:read'], { user: other });
    assert.equal((await call('pages', 'list', {}, foreign)).status, 200);
    await require('../dist/config/agentSchema').ensureAgentSchema();
    assert.equal((await call('notes', 'list', {})).status, 401, 'bootstrap must not re-enable an explicit switch-off');
  } finally { await management('PUT', '', { enabled: true }); }
  assert.equal((await call('notes', 'list', {})).status, 200);
  assert.equal((await call('notes', 'create', input)).data.id, created.data.id);
});

test('a pending switch-off blocks a read that passed initial credential authentication', async () => {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('UPDATE integration_settings SET enabled = FALSE WHERE user_id = $1', [owner]);
    const pending = call('notes', 'list', {});
    await new Promise(resolve => setTimeout(resolve, 50));
    await connection.query('COMMIT');
    assert.equal((await pending).status, 401);
  } finally {
    await connection.query('ROLLBACK'); connection.release();
    await management('PUT', '', { enabled: true });
  }
});
