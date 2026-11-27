const test = require('node:test');
const assert = require('node:assert/strict');
const { addDesignShape, InvalidDesignShape } = require('../dist/services/designShapes');
const { validDesignDocument } = require('../dist/services/designDocument');

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
});
