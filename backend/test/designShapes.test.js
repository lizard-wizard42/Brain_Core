const test = require('node:test');
const assert = require('node:assert/strict');
const { addDesignShape, InvalidDesignShape } = require('../dist/services/designShapes');
const { validDesignDocument } = require('../dist/services/designDocument');
const { validateIndexKey } = require('@tldraw/utils');

const blank = () => ({ tldraw: true, version: 1, data: null });
const records = doc => Object.values(doc.data.document.store).filter(record => record.typeName === 'shape');

test('builds editable artboards, text, rectangles and images without changing previous shapes', () => {
  const original = blank();
  const frame = addDesignShape(original, 'add_frame', { name: 'Fictional post', width: 1080, height: 1080 });
  const text = addDesignShape(frame.content, 'add_text', { frame_id: frame.shapeId, text: 'Synthetic title', x: 80, y: 70 });
  const rectangle = addDesignShape(text.content, 'add_rectangle', { frame_id: frame.shapeId, width: 300, height: 160, x: 80, y: 180, color: 'blue' });
  const image = addDesignShape(rectangle.content, 'add_image', { frame_id: frame.shapeId, src: '/uploads/synthetic.png', width: 240, height: 180, alt_text: 'Synthetic image' });
  const card = addDesignShape(image.content, 'add_card', { frame_id: frame.shapeId, width: 500, height: 300, text: 'Preview', appearance: { fill: '#071D31', radius: 24, borderWidth: 2, borderColor: '#176FA8', shadowBlur: 16 } });
  assert.deepEqual(original, blank());
  assert.equal(validDesignDocument(card.content), true);
  assert.deepEqual(records(card.content).map(shape => shape.type).sort(), ['design-card', 'frame', 'geo', 'image', 'text']);
  assert.equal(records(card.content).find(shape => shape.id === text.shapeId).parentId, frame.shapeId);
  assert.ok(card.content.data.document.store[text.shapeId].props.w >= 160);
  assert.equal(card.content.data.document.store[text.shapeId].props.autoSize, false);
  assert.ok(card.content.data.document.store[rectangle.shapeId]);
  assert.equal(card.content.data.document.store[image.shapeId].props.assetId.startsWith('asset:'), true);
  assert.equal(card.content.data.document.store[card.shapeId].props.fill, '#071D31');
  assert.equal(Object.values(card.content.data.document.store).filter(record => record.typeName === 'asset').length, 1);
  const children = records(card.content).filter(shape => shape.parentId === frame.shapeId);
  assert.equal(new Set(children.map(shape => shape.index)).size, children.length);
});

test('rejects bad frame, dimensions, colors and unowned URL syntax', () => {
  const frame = addDesignShape(blank(), 'add_frame', { name: 'Fictional', width: 1080, height: 1080 });
  assert.throws(() => addDesignShape(frame.content, 'add_text', { frame_id: 'shape:missing', text: 'Synthetic' }), InvalidDesignShape);
  assert.throws(() => addDesignShape(blank(), 'add_frame', { name: 'Fictional', width: 0, height: 1080 }), InvalidDesignShape);
  assert.throws(() => addDesignShape(frame.content, 'add_rectangle', { width: 100, height: 100, color: '#ff0000' }), InvalidDesignShape);
  assert.throws(() => addDesignShape(frame.content, 'add_image', { src: 'https://example.invalid/picture.png', width: 100, height: 100 }), InvalidDesignShape);
  assert.throws(() => addDesignShape(frame.content, 'add_card', { width: 100, height: 100, appearance: { fill: 'red' } }), InvalidDesignShape);
});

test('accepts the full MCP card appearance contract and rejects invalid values', () => {
  const appearance = {
    fontFamily: 'Inter', fontWeight: 700, textAlign: 'center', verticalAlign: 'middle',
    padding: 24, lineHeight: 1.4, letterSpacing: 2, gradientTo: '#176FA8',
  };
  const result = addDesignShape(blank(), 'add_card', { width: 300, height: 180, text: 'Synthetic', appearance });
  const props = result.content.data.document.store[result.shapeId].props;
  for (const [key, value] of Object.entries(appearance)) assert.equal(props[key], value);
  for (const bad of [{ fontWeight: 1000 }, { fontFamily: 'Unknown' }, { textAlign: 'justify' },
    { verticalAlign: 'baseline' }, { padding: -1 }, { lineHeight: 0.1 },
    { letterSpacing: 50 }, { gradientTo: 'red' }]) {
    assert.throws(() => addDesignShape(blank(), 'add_card', { width: 300, height: 180, appearance: bad }), InvalidDesignShape);
  }
});

test('places consecutive frames beside each other unless coordinates are supplied', () => {
  const first = addDesignShape(blank(), 'add_frame', { name: 'First', width: 1080, height: 1080 });
  const second = addDesignShape(first.content, 'add_frame', { name: 'Second', width: 1080, height: 1080 });
  assert.equal(second.content.data.document.store[second.shapeId].x, 1160);
  assert.equal(second.content.data.document.store[first.shapeId].x, 0);
});

test('supports hundreds of siblings without growing index keys per insertion', () => {
  let result = addDesignShape(blank(), 'add_frame', { name: 'Large board', width: 1080, height: 1080 });
  const frameId = result.shapeId;
  for (let i = 0; i < 320; i++) {
    result = addDesignShape(result.content, 'add_card', { frame_id: frameId, width: 20, height: 20, text: String(i) });
  }
  const children = records(result.content).filter(shape => shape.parentId === frameId);
  assert.equal(children.length, 320);
  assert.equal(new Set(children.map(shape => shape.index)).size, 320);
  assert.ok(Math.max(...children.map(shape => shape.index.length)) < 16);
  for (const shape of children) assert.doesNotThrow(() => validateIndexKey(shape.index));
});

test('adds after a UI-created b index and rejects malformed persisted indices', () => {
  const initial = addDesignShape(blank(), 'add_frame', { name: 'Mixed board', width: 1080, height: 1080 });
  const frameId = initial.shapeId;
  const existing = addDesignShape(initial.content, 'add_card', { frame_id: frameId, width: 20, height: 20 });
  existing.content.data.document.store[existing.shapeId].index = 'b00BAICDV';
  const result = addDesignShape(existing.content, 'add_card', { frame_id: frameId, width: 20, height: 20 });
  const next = result.content.data.document.store[result.shapeId].index;
  assert.ok(next > 'b00BAICDV');
  assert.doesNotThrow(() => validateIndexKey(next));
  existing.content.data.document.store[existing.shapeId].index = 'az0';
  assert.throws(() => addDesignShape(existing.content, 'add_card', { frame_id: frameId, width: 20, height: 20 }), /invalid shape index/);
});

test('gives long native text a bounded width and accepts an explicit width', () => {
  const initial = addDesignShape(blank(), 'add_frame', { name: 'Text board', width: 1080, height: 1080 });
  const long = addDesignShape(initial.content, 'add_text', { frame_id: initial.shapeId, text: 'Synthetic sentence '.repeat(12) });
  assert.equal(long.content.data.document.store[long.shapeId].props.w, 960);
  const narrow = addDesignShape(long.content, 'add_text', { frame_id: initial.shapeId, text: 'Synthetic title', width: 280 });
  assert.equal(narrow.content.data.document.store[narrow.shapeId].props.w, 280);
});
