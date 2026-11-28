const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyInfiniteDocument, validInfiniteDocument } = require('../dist/services/infiniteDocument');
const seed = require('../dist/services/designSnapshotSeed.json');

test('creates an Excalidraw document and keeps valid legacy snapshots readable', () => {
  const empty = emptyInfiniteDocument();
  assert.equal(validInfiniteDocument(empty), true);
  assert.deepEqual(empty.data.elements, []);
  assert.equal(validInfiniteDocument({ tldraw: true, version: 1, data: { document: seed.document, session: seed.session } }), true);
});

test('rejects malformed and oversized Infinite documents before saving', () => {
  const element = { id: 'synthetic-rect', type: 'rectangle', version: 1 };
  const valid = { excalidraw: true, version: 1, data: { elements: [element], appState: { viewBackgroundColor: '#ffffff' }, files: {} } };
  assert.equal(validInfiniteDocument(valid), true);
  assert.equal(validInfiniteDocument({ ...valid, extra: true }), false);
  assert.equal(validInfiniteDocument({ ...valid, data: { ...valid.data, elements: [{ type: 'rectangle' }] } }), false);
  assert.equal(validInfiniteDocument({ ...valid, data: { ...valid.data, elements: [] , appState: { viewBackgroundColor: 'javascript:bad' } } }), false);
  assert.equal(validInfiniteDocument({ ...valid, data: { ...valid.data, elements: [], files: { bad: { id: 'bad' } } } }), false);
  assert.equal(validInfiniteDocument({ ...valid, data: { ...valid.data, elements: [], files: {}, extra: 'discard me' } }), false);
  assert.equal(validInfiniteDocument({ ...valid, data: { ...valid.data, elements: [{ ...element, text: 'x'.repeat(32 * 1024 * 1024) }] } }), false);
});
