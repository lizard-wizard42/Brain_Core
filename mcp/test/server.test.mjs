import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadConfiguration } from '../src/server.mjs';

test('credential files are private and HTTP remains loopback-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mcp-test-'));
  const file = path.join(dir, 'token.txt');
  fs.writeFileSync(file, `bc_${randomBytes(32).toString('base64url')}`, { mode: 0o600 });
  try {
    assert.ok(loadConfiguration({ BRAIN_CORE_TOKEN_FILE: file }));
    for (const url of ['http://example.invalid', 'https://127.0.0.1', 'http://127.0.0.1/other', 'http://user@127.0.0.1', 'http://127.0.0.1?secret=yes']) {
      assert.throws(() => loadConfiguration({ BRAIN_CORE_TOKEN_FILE: file, BRAIN_CORE_URL: url }));
    }
    fs.chmodSync(file, 0o644); assert.throws(() => loadConfiguration({ BRAIN_CORE_TOKEN_FILE: file }));
    fs.chmodSync(file, 0o600); fs.symlinkSync(file, path.join(dir, 'link'));
    assert.throws(() => loadConfiguration({ BRAIN_CORE_TOKEN_FILE: path.join(dir, 'link') }));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('official client negotiates stdio, lists 12 tools, forwards exact writes and reports conflicts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mcp-test-'));
  const file = path.join(dir, 'token.txt');
  const secret = `bc_${randomBytes(32).toString('base64url')}`;
  fs.writeFileSync(file, secret, { mode: 0o600 });
  const received = [];
  const api = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ path: req.url, body: JSON.parse(body), authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/update')) { res.statusCode = 409; res.end(JSON.stringify({ error: 'Revision conflict' })); }
    else res.end(JSON.stringify({ items: [{ title: 'Synthetic note', revision: 0 }] }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { BRAIN_CORE_TOKEN_FILE: file, BRAIN_CORE_URL: `http://127.0.0.1:${api.address().port}` }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools(); assert.equal(tools.length, 12);
    assert.ok(tools.every(t => !/terminal|memory|audio|delete/.test(t.name)));
    const listing = await client.callTool({ name: 'brain_pages_list', arguments: { query: 'Synthetic', limit: 5 } });
    assert.equal(listing.isError, false);
    assert.equal(received[0].authorization, `Bearer ${secret}`);
    const input = { id: randomUUID(), operation_id: randomUUID(), expected_revision: 3, body: 'Draft' };
    const conflict = await client.callTool({ name: 'brain_notes_update', arguments: input });
    assert.equal(conflict.isError, true); assert.deepEqual(received[1].body, input);
    assert.match(conflict.content[0].text, /Revision conflict/);
    const count = received.length;
    const invalid = await client.callTool({ name: 'brain_notes_update', arguments: { ...input, expected_revision: -1 } });
    assert.equal(invalid.isError, true); assert.equal(received.length, count);
  } finally {
    await client.close(); await new Promise(resolve => api.close(resolve)); fs.rmSync(dir, { recursive: true });
  }
});
