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

test('official client negotiates stdio, lists Design and asset tools, forwards writes and reports conflicts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mcp-test-'));
  const file = path.join(dir, 'token.txt');
  const secret = `bc_${randomBytes(32).toString('base64url')}`;
  fs.writeFileSync(file, secret, { mode: 0o600 });
  const received = [];
  const api = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ path: req.url, body: JSON.parse(body), authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/preview')) res.end(JSON.stringify({ revision: 4, mime_type: 'image/png', data: Buffer.from('synthetic-png').toString('base64') }));
    else if (req.url.endsWith('/update')) { res.statusCode = 409; res.end(JSON.stringify({ error: 'Revision conflict' })); }
    else res.end(JSON.stringify({ items: [{ title: 'Synthetic note', revision: 0 }] }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { BRAIN_CORE_TOKEN_FILE: file, BRAIN_CORE_URL: `http://127.0.0.1:${api.address().port}` }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.match(client.getInstructions(), /expected_revision/);
    assert.match(client.getInstructions(), /Create subpages with parent_page_id/);
    const { tools } = await client.listTools(); assert.equal(tools.length, 34);
    assert.ok(tools.every(t => !/terminal|memory|audio|brain_pages_delete|brain_notes_delete/.test(t.name)));
    for (const name of ['brain_design_batch','brain_design_get_tree','brain_design_preview','brain_design_add_vector','brain_design_group_shapes','brain_design_ungroup_shape','brain_assets_upload','brain_assets_list']) {
      assert.ok(tools.some(tool => tool.name === name), `${name} missing`);
    }
    const listing = await client.callTool({ name: 'brain_pages_list', arguments: { query: 'Synthetic', limit: 5 } });
    assert.equal(listing.isError, false);
    assert.equal(received[0].authorization, `Bearer ${secret}`);
    const input = { id: randomUUID(), operation_id: randomUUID(), expected_revision: 3, body: 'Draft' };
    const conflict = await client.callTool({ name: 'brain_notes_update', arguments: input });
    assert.equal(conflict.isError, true); assert.deepEqual(received[1].body, input);
    assert.match(conflict.content[0].text, /Revision conflict/);
    const childInput = { operation_id: randomUUID(), parent_page_id: randomUUID(), title: 'Synthetic child' };
    assert.equal((await client.callTool({ name: 'brain_pages_create', arguments: childInput })).isError, false);
    assert.deepEqual(received.at(-1).body, childInput);
    assert.equal((await client.callTool({ name: 'brain_pages_list', arguments: { parent_page_id: null } })).isError, false);
    assert.deepEqual(received.at(-1).body, { parent_page_id: null });
    const designInput = { operation_id: randomUUID(), title: 'Synthetic artboard', content: { tldraw: true, version: 1, data: null } };
    assert.equal((await client.callTool({ name: 'brain_design_create', arguments: designInput })).isError, false);
    assert.equal(received.at(-1).path, '/api/agent/design/create');
    assert.deepEqual(received.at(-1).body, designInput);
    const designUpdate = { id: randomUUID(), operation_id: randomUUID(), expected_revision: 2, content: { tldraw: true, version: 1, data: { document: {}, session: {} } } };
    assert.equal((await client.callTool({ name: 'brain_design_update', arguments: designUpdate })).isError, true);
    assert.deepEqual(received.at(-1).body, designUpdate);
    const artboardInput = { id: randomUUID(), operation_id: randomUUID(), expected_revision: 1, name: 'Synthetic post', width: 1080, height: 1080 };
    assert.equal((await client.callTool({ name: 'brain_design_add_frame', arguments: artboardInput })).isError, false);
    assert.equal(received.at(-1).path, '/api/agent/design/add_frame');
    assert.deepEqual(received.at(-1).body, artboardInput);
    const cardInput = { id: randomUUID(), operation_id: randomUUID(), expected_revision: 2, width: 500, height: 300,
      text: 'Synthetic title', body: 'Synthetic body', appearance: { fontWeight: 700, bodyFontSize: 18, bodyColor: '#123456' } };
    assert.equal((await client.callTool({ name: 'brain_design_add_card', arguments: cardInput })).isError, false);
    assert.deepEqual(received.at(-1).body, cardInput);
    const vectorInput = { id: randomUUID(), operation_id: randomUUID(), expected_revision: 3, kind: 'ellipse', width: 120, height: 120,
      fill: '#123456', stroke: '#ffffff', stroke_width: 2 };
    assert.equal((await client.callTool({ name: 'brain_design_add_vector', arguments: vectorInput })).isError, false);
    assert.deepEqual(received.at(-1).body, vectorInput);
    const count = received.length;
    assert.equal((await client.callTool({ name: 'brain_notes_create', arguments: childInput })).isError, true);
    assert.equal(received.length, count);
    const invalid = await client.callTool({ name: 'brain_notes_update', arguments: { ...input, expected_revision: -1 } });
    assert.equal(invalid.isError, true); assert.equal(received.length, count);
    const preview = await client.callTool({ name: 'brain_design_preview', arguments: { id: randomUUID(), frame_id: 'shape:synthetic' } });
    assert.equal(preview.isError, false);
    assert.equal(preview.content[1].type, 'image');
    assert.equal(preview.content[1].mimeType, 'image/png');
  } finally {
    await client.close(); await new Promise(resolve => api.close(resolve)); fs.rmSync(dir, { recursive: true });
  }
});

test('optional local image tool reads only a regular image in the configured directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mcp-assets-'));
  const tokenFile = path.join(dir, 'token.txt');
  const importDir = path.join(dir, 'imports');
  fs.mkdirSync(importDir);
  const secret = `bc_${randomBytes(32).toString('base64url')}`;
  fs.writeFileSync(tokenFile, secret, { mode: 0o600 });
  fs.writeFileSync(path.join(importDir, 'synthetic.png'), Buffer.from('synthetic-raster'));
  fs.symlinkSync(path.join(importDir, 'synthetic.png'), path.join(importDir, 'link.png'));
  const received = [];
  const api = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ url: '/uploads/design/synthetic.png' }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { BRAIN_CORE_TOKEN_FILE: tokenFile, BRAIN_CORE_URL: `http://127.0.0.1:${api.address().port}`,
      BRAIN_CORE_ASSET_IMPORT_DIR: importDir }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'brain_assets_upload_local'));
    const input = { operation_id: randomUUID(), file_name: 'synthetic.png' };
    const result = await client.callTool({ name: 'brain_assets_upload_local', arguments: input });
    assert.equal(result.isError, false);
    assert.equal(received[0].data_base64, Buffer.from('synthetic-raster').toString('base64'));
    assert.equal(received[0].operation_id, input.operation_id);
    for (const file_name of ['../token.txt', '/etc/passwd', 'link.png']) {
      const denied = await client.callTool({ name: 'brain_assets_upload_local', arguments: { operation_id: randomUUID(), file_name } });
      assert.equal(denied.isError, true);
    }
    assert.equal(received.length, 1);
  } finally {
    await client.close(); await new Promise(resolve => api.close(resolve)); fs.rmSync(dir, { recursive: true });
  }
});
