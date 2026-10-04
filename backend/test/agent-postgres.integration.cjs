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
  app.use('/api/pages', authMiddleware, require('../dist/routes/pages').default);
  app.post('/api/auth/login-2fa', require('../dist/controllers/authController').verifyLoginTwoFactor);
  app.use('/uploads', authMiddleware, require('../dist/services/uploadOwnership').requireUploadedAssetOwner, (_req, res) => res.send('synthetic asset'));
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
  assert.deepEqual(Object.keys(page.data).sort(), ['id','parent_page_id','title','content','revision','created_at','updated_at'].sort());
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
      if (kind === 'pages') {
        assert.deepEqual(restored.content, doc);
        const childInput = { ...operation(), title: 'MCP child', parent_page_id: created.id };
        const child = await invoke('pages', 'create', childInput);
        assert.equal(child.parent_page_id, created.id);
        assert.deepEqual(await invoke('pages', 'create', childInput), child);
        const children = await invoke('pages', 'list', { parent_page_id: created.id });
        assert.deepEqual(children.items.map(p => p.id), [child.id]);
        assert.equal((await invoke('pages', 'get', { id: created.id })).revision, 2);
      }
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


test('a shared editor cannot create access to a private owner attachment', async () => {
  const page = (await call('pages', 'create', { ...operation(), title: 'Shared fixture' })).data;
  const file = `synthetic-private-${randomUUID()}.png`;
  await query('INSERT INTO uploaded_assets (relative_path,owner_user_id) VALUES ($1,$2)', [file, owner]);
  await query("INSERT INTO page_grants (page_id,user_id,role) VALUES ($1,$2,'editor')", [page.id, other]);
  const login = user => jwt.sign({ sub: user, type: 'access', sv: 1 }, process.env.JWT_SECRET, { expiresIn: 60 });
  const headers = user => ({ authorization: `Bearer ${login(user)}`, 'content-type': 'application/json' });
  const ref = `/uploads/${file}`;
  assert.equal((await fetch(`${origin}${ref}`, { headers: headers(other) })).status, 404);
  const doc = { type: 'doc', content: [{ type: 'image', attrs: { src: ref } }] };
  let response = await fetch(`${origin}/api/pages/${page.id}`, { method: 'PUT', headers: headers(other), body: JSON.stringify({ content: doc, revision: 0 }) });
  assert.equal(response.status, 404);
  assert.equal((await fetch(`${origin}${ref}`, { headers: headers(other) })).status, 404);
  assert.equal((await query('SELECT revision FROM pages WHERE id=$1', [page.id]))[0].revision, 0);
  response = await fetch(`${origin}/api/pages/${page.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ content: doc, revision: 0 }) });
  assert.equal(response.status, 200);
  assert.equal((await fetch(`${origin}${ref}`, { headers: headers(other) })).status, 200);
  response = await fetch(`${origin}/api/pages/${page.id}`, { method: 'PUT', headers: headers(other), body: JSON.stringify({ content: doc, revision: 1 }) });
  assert.equal(response.status, 200, 'an editor may preserve an owner-shared attachment');
  await query('DELETE FROM page_grants WHERE page_id=$1 AND user_id=$2', [page.id, other]);
  assert.equal((await fetch(`${origin}${ref}`, { headers: headers(other) })).status, 404);
});

test('2FA account lockout serializes concurrent failures and rejects even a valid code while locked', async () => {
  const totp = require('../dist/services/totpService');
  const original = totp.verifyTotp;
  let checked = 0;
  totp.verifyTotp = (_secret, code) => { checked++; return code === '123456'; };
  await query("UPDATE users SET two_factor_enabled=TRUE,two_factor_secret='synthetic',failed_login_attempts=0,login_locked_until=NULL WHERE id=$1", [other]);
  const pending = jwt.sign({ sub: other, sv: 1, type: '2fa-pending' }, process.env.JWT_SECRET, { expiresIn: 300 });
  const verify = code => fetch(`${origin}/api/auth/login-2fa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pendingToken: pending, code, rememberDevice: false }) });
  try {
    assert.equal((await verify('123456')).status, 200);
    checked = 0;
    const failures = await Promise.all(Array.from({ length: 7 }, () => verify('000000')));
    assert.equal(checked, 5);
    assert.ok(failures.some(r => r.status === 429));
    const locked = await verify('123456');
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('Retry-After')) > 0);
    assert.equal(checked, 5, 'lockout must precede code verification');
    const row = (await query('SELECT failed_login_attempts, login_locked_until FROM users WHERE id=$1', [other]))[0];
    assert.equal(row.failed_login_attempts, 5);
    assert.ok(row.login_locked_until);
    await query("UPDATE users SET login_locked_until=NOW()-interval '1 second' WHERE id=$1", [other]);
    assert.equal((await verify('123456')).status, 200);
  } finally { totp.verifyTotp = original; }
});

test('failed reminders from one account do not monopolize Telegram batches', async () => {
  const { config } = require('../dist/config');
  const { dispatchDueReminders } = require('../dist/services/rememberReminderService');
  const originalFetch = global.fetch, originalToken = config.TELEGRAM_BOT_TOKEN;
  const sent = [];
  config.TELEGRAM_BOT_TOKEN = 'synthetic-test-token';
  await query("UPDATE users SET telegram_notifications_enabled=TRUE,telegram_chat_id=CASE WHEN id=$1 THEN 'good' ELSE 'bad' END", [owner]);
  for (let n = 0; n < 25; n++) {
    await query("INSERT INTO remember_notes (user_id,title,body,reminder_date) VALUES ($1,'synthetic failing','', '2000-01-01')", [other]);
  }
  await query("INSERT INTO remember_notes (user_id,title,body,reminder_date) VALUES ($1,'synthetic good','', '2001-01-01')", [owner]);
  global.fetch = async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body); sent.push(body.chat_id);
    return new Response('', { status: body.chat_id === 'good' ? 200 : 400 });
  };
  try {
    await dispatchDueReminders();
    assert.ok(sent.includes('good'));
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM remember_notes WHERE user_id=$1 AND reminder_sent_at IS NOT NULL", [owner]))[0].count, 1);
    assert.ok((await query('SELECT telegram_reminder_attempted_at FROM users WHERE id=$1', [other]))[0].telegram_reminder_attempted_at);
  } finally { global.fetch = originalFetch; config.TELEGRAM_BOT_TOKEN = originalToken; }
});

test('current page saves apply the configured history retention and keep the latest revision', async () => {
  const { config } = require('../dist/config');
  const { savePageRevision } = require('../dist/services/pageAccess');
  const old = config.PAGE_VERSION_RETENTION; config.PAGE_VERSION_RETENTION = 3;
  try {
    const page = (await call('pages', 'create', { ...operation(), title: 'Retention' })).data;
    for (let revision = 0; revision < 5; revision++) await savePageRevision(page.id, owner, revision, { title: `Revision ${revision + 1}` }, 'synthetic');
    const versions = await query('SELECT page_revision FROM page_versions WHERE page_id=$1 ORDER BY page_revision DESC', [page.id]);
    assert.deepEqual(versions.map(v => v.page_revision), [5, 4, 3]);
  } finally { config.PAGE_VERSION_RETENTION = old; }
});


test('unified search reads note text, handles accents, paths and pagination without crossing accounts or trash', async () => {
  const parent = randomUUID(), child = randomUUID(), hidden = randomUUID(), trashed = randomUUID();
  const doc = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Pesquisa sintética: investigação lunar.'}]},{type:'image',attrs:{src:'https://example.invalid/not-searchable-secret'}}]};
  await query(`INSERT INTO pages(id,owner_user_id,title,slug,content) VALUES ($1,$2,'Pasta fictícia',$1::uuid::text,'{}')`,[parent,owner]);
  for (const [id,user,deleted] of [[child,owner,null],[hidden,other,null],[trashed,owner,new Date()]]) {
    await query(`INSERT INTO pages(id,owner_user_id,title,slug,content,parent_page_id,deleted_at) VALUES ($1,$2,'Caderno',$1::uuid::text,$3,$4,$5)`,[id,user,JSON.stringify(doc),user===owner?parent:null,deleted]);
  }
  await query(`INSERT INTO remember_notes(user_id,title,body) VALUES ($1,'Nota fictícia','investigação lunar')`,[owner]);
  const access=jwt.sign({sub:owner,sv:1,type:'access'},process.env.JWT_SECRET);
  const search=async (params,auth=true)=>{const r=await fetch(`${origin}/api/pages/search?${new URLSearchParams(params)}`,{headers:auth?{authorization:`Bearer ${access}`}:{}});return {status:r.status,data:await r.json()}};
  assert.equal((await search({q:'investigacao'},false)).status,401);
  const result=await search({q:'INVESTIGACAO'});
  assert.equal(result.status,200);assert.equal(result.data.items.length,2);
  const page=result.data.items.find(r=>r.kind==='page');assert.equal(page.id,child);
  assert.deepEqual(page.path.map(p=>p.id),[parent,child]);assert.match(page.snippet,/investigação/);
  assert.ok(!JSON.stringify(result).includes('not-searchable-secret'));
  assert.equal((await search({q:'not-searchable-secret'})).data.items.length,0);
  assert.equal((await search({q:'investigacao',kind:'notes'})).data.items.length,1);
  assert.equal((await search({q:'investigacao',kind:'pages'})).data.items.length,1);
  for(const params of [{q:''},{q:'a',kind:'audio'},{q:'a',offset:'-1'},{q:'a',offset:'1.5'}]) assert.equal((await search(params)).status,400);
  await query(`INSERT INTO remember_notes(user_id,title,body) SELECT $1,'Batch '||n,'paginationfixture' FROM generate_series(1,25) n`,[owner]);
  const first=(await search({q:'paginationfixture'})).data;assert.equal(first.items.length,20);assert.equal(first.next_offset,20);
  const second=(await search({q:'paginationfixture',offset:'20'})).data;assert.equal(second.items.length,5);assert.equal(second.next_offset,null);
  assert.equal(new Set([...first.items,...second.items].map(p=>p.id)).size,25);
});

test('page navigation paths and incoming references respect ownership, sharing and trash', async () => {
  const parent = randomUUID(), page = randomUUID(), source = randomUUID(), foreign = randomUUID(), deleted = randomUUID();
  for (const [id, user, parentId, trashed] of [[parent,owner,null,null],[page,owner,parent,null],[source,owner,null,null],[foreign,other,null,null],[deleted,owner,null,new Date()]]) {
    const content = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Link fictício',marks:[{type:'link',attrs:{href:`/page/${page}`}}]}]}]};
    await query(`INSERT INTO pages(id,owner_user_id,title,slug,content,parent_page_id,deleted_at) VALUES ($1,$2,'Página fictícia',$1::uuid::text,$3,$4,$5)`,[id,user,JSON.stringify(content),parentId,trashed]);
  }
  const get=async(id,route,user=owner)=>{const response=await fetch(`${origin}/api/pages/${id}/${route}`,{headers:{authorization:`Bearer ${jwt.sign({sub:user,sv:1,type:'access'},process.env.JWT_SECRET)}`}});return {status:response.status,data:await response.json()}};
  assert.deepEqual((await get(page,'path')).data.map(p=>p.id),[parent,page]);
  assert.equal((await get(foreign,'path')).status,404);
  assert.equal((await get(deleted,'path')).status,404);
  assert.deepEqual(new Set((await get(page,'references')).data.incoming.map(p=>p.id)),new Set([parent,source]));
  await query(`INSERT INTO page_grants(page_id,user_id,role) VALUES ($1,$2,'viewer')`,[page,other]);
  assert.deepEqual((await get(page,'path',other)).data,[]);
  assert.deepEqual((await get(page,'references',other)).data,{incoming:[],outgoing:[]});
  // Old malformed hierarchies must not make breadcrumb queries recurse forever.
  await query('UPDATE pages SET parent_page_id=$1 WHERE id=$2',[page,parent]);
  assert.equal((await get(page,'path')).data.length,2);
});

test('MCP subpages validate parents, preserve hierarchy on restore and remain idempotent', async () => {
  const parent = (await call('pages','create',{...operation(),title:'Parent fictício'})).data;
  const input = {...operation(),title:'Child fictício',parent_page_id:parent.id};
  const child = await call('pages','create',input);
  assert.equal(child.status,200); assert.equal(child.data.parent_page_id,parent.id);
  assert.deepEqual((await call('pages','create',input)).data,child.data);
  assert.equal((await call('pages','create',{...input,parent_page_id:null})).status,409);
  const edit = await call('pages','update',{...operation(),id:child.data.id,expected_revision:0,title:'Editado'});
  assert.equal(edit.status,200);
  const restored = await call('pages','restore',{...operation(),id:child.data.id,expected_revision:1,saved_revision:0});
  assert.equal(restored.data.parent_page_id,parent.id);
  assert.equal((await call('pages','get',{id:parent.id})).data.revision,0);
  const roots = (await call('pages','list',{query:'fictício',parent_page_id:null,limit:50})).data.items;
  assert.ok(roots.some(p=>p.id===parent.id)); assert.ok(!roots.some(p=>p.id===child.data.id));
  for(const [user,type,section,deleted] of [[other,'note',false,null],[owner,'infinite',false,null],[owner,'note',true,null],[owner,'note',false,new Date()]]) {
    const id = randomUUID();
    await query(`INSERT INTO pages(id,owner_user_id,title,slug,type,is_section,deleted_at) VALUES ($1,$2,'Invalid destination',$1::uuid::text,$3,$4,$5)`,[id,user,type,section,deleted]);
    const attempt={...operation(),title:'Must not exist',parent_page_id:id};
    assert.equal((await call('pages','create',attempt)).status,404);
    assert.equal((await call('pages','list',{parent_page_id:id})).status,404);
    assert.equal((await query('SELECT operation_id FROM integration_operations WHERE operation_id=$1',[attempt.operation_id])).length,0);
  }
  assert.equal((await call('pages','create',{...operation(),title:'Invalid',parent_page_id:'nope'})).status,400);
  assert.equal((await call('notes','create',{...operation(),title:'Invalid',parent_page_id:parent.id})).status,400);
  assert.equal((await call('pages','update',{...operation(),id:child.data.id,expected_revision:2,parent_page_id:null})).status,400);
});
