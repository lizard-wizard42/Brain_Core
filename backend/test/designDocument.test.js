const test = require('node:test');
const assert = require('node:assert/strict');
const { validDesignDocument } = require('../dist/services/designDocument');
const seed = require('../dist/services/designSnapshotSeed.json');

test('accepts a bounded Design snapshot envelope', () => {
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: null }), true);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: { document: seed.document, session: seed.session } }), true);
});

test('rejects wrong formats and oversized Design snapshots', () => {
  assert.equal(validDesignDocument({ type: 'doc', content: [] }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 2, data: null }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: { document: {} } }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: { document: {}, session: {} } }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: { document: { ...seed.document, store: {} }, session: seed.session } }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: { document: { ...seed.document, store: { 'document:document': seed.document.store['document:document'] } }, session: seed.session } }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: [], extra: true }), false);
  assert.equal(validDesignDocument({ tldraw: true, version: 1, data: { document: seed.document, session: { ...seed.session, text: 'x'.repeat(32 * 1024 * 1024) } } }), false);
});
