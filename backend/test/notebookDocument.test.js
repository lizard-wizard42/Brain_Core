const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultNotebook, isNotebookDoc } = require('../dist/services/notebookDocument');
test('default notebook is valid and separate calls do not share sheets', () => {
  const a = defaultNotebook(), b = defaultNotebook();
  assert.equal(isNotebookDoc(a), true);
  assert.notEqual(a.sheets[0].id, b.sheets[0].id);
});
test('validator refuses corrupt ink, duplicate item IDs and excessive document size', () => {
  const doc = defaultNotebook();
  const ink = { id: 'ink', tool: 'pen', color: '#24344b', width: 2, points: [{ x: 1, y: 2, pressure: .5 }] };
  const sheet = doc.sheets[0];
  assert.equal(isNotebookDoc({ ...doc, sheets: [{ ...sheet, strokes: [ink] }] }), true);
  for (const point of [{ x: 1, y: 2, pressure: Infinity }, { x: -1, y: 2, pressure: .5 }, { x: 1, y: 1121, pressure: .5 }]) {
    assert.equal(isNotebookDoc({ ...doc, sheets: [{ ...sheet, strokes: [{ ...ink, points: [point] }] }] }), false);
  }
  assert.equal(isNotebookDoc({ ...doc, sheets: [{ ...sheet, strokes: [ink, ink] }] }), false);
  assert.equal(isNotebookDoc({ ...doc, sheets: Array.from({ length: 101 }, (_, n) => ({ ...sheet, id: `sheet-${n}` })) }), false);
  assert.equal(isNotebookDoc({ ...doc, sheets: [{ ...sheet, strokes: Array.from({ length: 11 }, (_, n) => ({ ...ink, id: `ink-${n}`, points: Array(10000).fill(ink.points[0]) })) }] }), false);
});
