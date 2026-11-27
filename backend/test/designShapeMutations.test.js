const test = require('node:test');
const assert = require('node:assert/strict');
const { addDesignShape } = require('../dist/services/designShapes');
const { mutateDesignShapes, designShapeTree, InvalidDesignMutation } = require('../dist/services/designShapeMutations');

test('updates, reorders, and deletes only selected shapes in an editable board', () => {
  const blank = { tldraw: true, version: 1, data: null };
  const frame = addDesignShape(blank, 'add_frame', { name: 'Board', width: 1080, height: 1080 });
  const first = addDesignShape(frame.content, 'add_card', { frame_id: frame.shapeId, width: 100, height: 100, text: 'First' });
  const second = addDesignShape(first.content, 'add_card', { frame_id: frame.shapeId, width: 100, height: 100, text: 'Second' });
  const moved = mutateDesignShapes(second.content, 'reorder_shape', { shape_id: second.shapeId, before_shape_id: first.shapeId });
  const ordered = designShapeTree(moved).filter(shape => shape.parent_id === frame.shapeId);
  assert.deepEqual(ordered.map(shape => shape.id), [second.shapeId, first.shapeId]);
  const edited = mutateDesignShapes(moved, 'update_shape', { shape_id: first.shapeId, patch: { x: 42, opacity: 0.7, props: { text: 'Edited', fontWeight: 700 } } });
  assert.equal(edited.data.document.store[first.shapeId].x, 42);
  assert.equal(edited.data.document.store[first.shapeId].props.text, 'Edited');
  assert.equal(second.content.data.document.store[first.shapeId].props.text, 'First');
  assert.throws(() => mutateDesignShapes(edited, 'update_shape', { shape_id: first.shapeId, patch: { props: { fill: 'javascript:bad' } } }), InvalidDesignMutation);
  const deleted = mutateDesignShapes(edited, 'delete_shapes', { shape_ids: [first.shapeId] });
  assert.equal(deleted.data.document.store[first.shapeId], undefined);
  assert.ok(deleted.data.document.store[second.shapeId]);
});

test('deleting a frame also deletes its children', () => {
  const frame = addDesignShape({ tldraw: true, version: 1, data: null }, 'add_frame', { name: 'Board', width: 100, height: 100 });
  const child = addDesignShape(frame.content, 'add_card', { frame_id: frame.shapeId, width: 40, height: 40 });
  const deleted = mutateDesignShapes(child.content, 'delete_shapes', { shape_ids: [frame.shapeId] });
  assert.equal(designShapeTree(deleted).length, 0);
});

test('updates native text as rich text while preserving its wrap width', () => {
  const created = addDesignShape({ tldraw: true, version: 1, data: null }, 'add_text', { text: 'Before', width: 320 });
  const updated = mutateDesignShapes(created.content, 'update_shape', { shape_id: created.shapeId, patch: { props: { text: 'After\nwrap', w: 280 } } });
  const props = updated.data.document.store[created.shapeId].props;
  assert.equal(props.w, 280);
  assert.equal(props.richText.content[0].content[0].text, 'After\nwrap');
  assert.equal(props.autoSize, false);
});
