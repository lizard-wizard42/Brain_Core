const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../dist/config/database');
const contactsRouter = require('../dist/routes/contacts').default;

const meId = '11111111-1111-4111-1111-111111111111';
const otherId = '22222222-2222-4222-2222-222222222222';
const contactRowId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function contactRow(overrides = {}) {
  return { status: 'pending', requested_by: meId, contact_id: otherId, contact_name: 'Outra Pessoa', contact_email: 'other@test.local', ...overrides };
}

async function serve(userId = meId) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.userId = req.headers['x-test-user'] ?? userId; next(); });
  app.use(contactsRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function withDb(rows, calls = []) {
  const original = database.query;
  database.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM contacts c')) return rows.list ?? [];
    if (sql.includes('SELECT id FROM users WHERE lower(email)')) return rows.target ? [{ id: rows.target }] : [];
    if (sql.includes('SELECT status, requester_user_id FROM contacts')) return rows.existing ?? [];
    if (sql.includes('INSERT INTO contacts')) return rows.inserted ? [rows.inserted] : [];
    if (sql.includes('UPDATE contacts SET')) {
      const match = typeof rows.accepted === 'function' ? rows.accepted(params) : rows.accepted;
      return match ? [{ id: contactRowId }] : [];
    }
    if (sql.includes('DELETE FROM contacts')) {
      const match = rows.participant === true
        ? (params[1] === meId || params[1] === otherId)
        : Boolean(rows.removed);
      return match ? [{ id: contactRowId }] : [];
    }
    return [];
  };
  return () => { database.query = original; };
}

test('listContacts splits accepted, incoming and outgoing requests', async () => {
  const restore = withDb({ list: [
    contactRow({ status: 'accepted' }),
    contactRow({ requested_by: otherId, contact_id: '33333333-3333-4333-3333-333333333333', contact_email: 'third@test.local' }),
    contactRow({ contact_id: '44444444-4444-4444-4444-444444444444', contact_email: 'fourth@test.local' }),
  ] });
  const { server, origin } = await serve();
  try {
    const body = await (await fetch(`${origin}/`, { headers: { 'x-test-user': meId } })).json();
    assert.equal(body.contacts.length, 1);
    assert.equal(body.contacts[0].email, 'other@test.local');
    assert.equal(body.incoming.length, 1);
    assert.equal(body.incoming[0].email, 'third@test.local');
    assert.equal(body.outgoing.length, 1);
    assert.equal(body.outgoing[0].email, 'fourth@test.local');
  } finally { restore(); await new Promise(resolve => server.close(resolve)); }
});

test('requestContact validates email, target account and duplicates', async () => {
  const calls = [];
  const restore = withDb({ target: otherId, inserted: { id: otherId, name: 'Outra Pessoa', email: 'other@test.local' } }, calls);
  const { server, origin } = await serve();
  const post = (body) => fetch(`${origin}/`, { method: 'POST', headers: { 'x-test-user': meId, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ email: 'nope' })).status, 400);
    assert.equal((await post({})).status, 400);
    const restoreUnknown = withDb({});
    try {
      assert.equal((await post({ email: 'ghost@test.local' })).status, 404);
    } finally { restoreUnknown(); }
    assert.equal((await post({ email: 'other@test.local' })).status, 201);
    const insertCall = calls.find(call => call.sql.includes('INSERT INTO contacts'));
    assert.equal(insertCall.params[0], meId);
    assert.equal(insertCall.params[1], otherId);
  } finally { restore(); await new Promise(resolve => server.close(resolve)); }
});

test('requestContact reports self, existing pair and lost insert race as conflicts', async () => {
  const restoreSelf = withDb({ target: meId });
  let { server, origin } = await serve();
  const post = (body) => fetch(`${origin}/`, { method: 'POST', headers: { 'x-test-user': meId, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const self = await (await post({ email: 'me@test.local' })).json();
    assert.equal(self.error, 'Você não pode adicionar a si mesmo.');
  } finally { restoreSelf(); await new Promise(resolve => server.close(resolve)); }

  const restoreAccepted = withDb({ target: otherId, existing: [{ status: 'accepted', requester_user_id: otherId }] });
  ({ server, origin } = await serve());
  try {
    const body = await (await post({ email: 'other@test.local' })).json();
    assert.equal(body.error, 'Vocês já são contatos.');
  } finally { restoreAccepted(); await new Promise(resolve => server.close(resolve)); }

  const restoreOutgoing = withDb({ target: otherId, existing: [{ status: 'pending', requester_user_id: meId }] });
  ({ server, origin } = await serve());
  try {
    const body = await (await post({ email: 'other@test.local' })).json();
    assert.equal(body.error, 'Você já enviou um pedido para esta pessoa.');
  } finally { restoreOutgoing(); await new Promise(resolve => server.close(resolve)); }

  const restoreIncoming = withDb({ target: otherId, existing: [{ status: 'pending', requester_user_id: otherId }] });
  ({ server, origin } = await serve());
  try {
    const body = await (await post({ email: 'other@test.local' })).json();
    assert.match(body.error, /pedido/);
  } finally { restoreIncoming(); await new Promise(resolve => server.close(resolve)); }

  const restoreRace = withDb({ target: otherId });
  ({ server, origin } = await serve());
  try {
    const body = await (await post({ email: 'other@test.local' })).json();
    assert.equal(body.error, 'Você já enviou um pedido para esta pessoa.');
  } finally { restoreRace(); await new Promise(resolve => server.close(resolve)); }
});

test('accept only works for the addressee of a pending request', async () => {
  // Mock models the SQL guard: the UPDATE only matches when params[1] is the addressee.
  const restore = withDb({ accepted: params => params[1] === otherId });
  const { server, origin } = await serve();
  try {
    assert.equal((await fetch(`${origin}/${contactRowId}/accept`, { method: 'POST', headers: { 'x-test-user': meId } })).status, 404);
    assert.equal((await fetch(`${origin}/${contactRowId}/accept`, { method: 'POST', headers: { 'x-test-user': otherId } })).status, 200);
  } finally { restore(); await new Promise(resolve => server.close(resolve)); }
});

test('remove works for either participant, 404 for strangers', async () => {
  // Mock models the SQL guard: DELETE matches when params[1] is requester or addressee.
  const restore = withDb({ removed: true, participant: true });
  const { server, origin } = await serve();
  try {
    assert.equal((await fetch(`${origin}/${contactRowId}`, { method: 'DELETE', headers: { 'x-test-user': meId } })).status, 200);
    assert.equal((await fetch(`${origin}/${contactRowId}`, { method: 'DELETE', headers: { 'x-test-user': otherId } })).status, 200);
    const restoreNone = withDb({});
    try {
      assert.equal((await fetch(`${origin}/${contactRowId}`, { method: 'DELETE', headers: { 'x-test-user': otherId } })).status, 404);
    } finally { restoreNone(); }
  } finally { restore(); await new Promise(resolve => server.close(resolve)); }
});