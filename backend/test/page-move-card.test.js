const test = require('node:test');
const assert = require('node:assert/strict');
const { removeMovedChildCard } = require('../dist/services/pageAccess');

test('moving a page removes one child card and preserves explicit references', () => {
  const doc = { type: 'doc', content: [
    { type: 'subPageBlock', attrs: { pageId: 'moved', source: 'reference' } },
    { type: 'subPageBlock', attrs: { pageId: 'moved', source: 'child' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'keep' }] },
  ] };
  const cleaned = removeMovedChildCard(doc, 'moved');
  assert.equal(cleaned.content.length, 2);
  assert.equal(cleaned.content[0].attrs.source, 'reference');
  assert.deepEqual(cleaned.content[1], doc.content[2]);
  assert.equal(removeMovedChildCard(cleaned, 'moved'), null);
});

test('legacy child cards without a source marker are removed once', () => {
  const doc = { type: 'doc', content: [
    { type: 'subPageBlock', attrs: { pageId: 'moved' } },
    { type: 'subPageBlock', attrs: { pageId: 'moved' } },
  ] };
  assert.equal(removeMovedChildCard(doc, 'moved').content.length, 1);
});
