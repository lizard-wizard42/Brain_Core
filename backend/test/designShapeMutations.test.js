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
  const edited = mutateDesignShapes(moved, 'update_shape', { shape_id: first.shapeId, patch: { x: 42, opacity: 0.7, props: { text: 'Edited', body: 'Second style', fontWeight: 700, bodyFontSize: 18 } } });
  assert.equal(edited.data.document.store[first.shapeId].x, 42);
  assert.equal(edited.data.document.store[first.shapeId].props.text, 'Edited');
  assert.equal(edited.data.document.store[first.shapeId].props.body, 'Second style');
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

test('groups and ungroups sibling shapes without changing their coordinates', () => {
  const frame = addDesignShape({ tldraw: true, version: 1, data: null }, 'add_frame', { name: 'Board', width: 1080, height: 1080 });
  const first = addDesignShape(frame.content, 'add_card', { frame_id: frame.shapeId, x: 20, y: 30, width: 100, height: 80, text: 'A' });
  const second = addDesignShape(first.content, 'add_card', { frame_id: frame.shapeId, x: 200, y: 150, width: 100, height: 80, text: 'B' });
  const grouped = mutateDesignShapes(second.content, 'group_shapes', { shape_ids: [first.shapeId, second.shapeId] });
  const group = designShapeTree(grouped).find(item => item.type === 'design-group');
  assert.ok(group);
  assert.equal(grouped.data.document.store[first.shapeId].parentId, group.id);
  assert.equal(grouped.data.document.store[first.shapeId].x + group.x, 20);
  assert.equal(grouped.data.document.store[second.shapeId].y + group.y, 150);
  const ungrouped = mutateDesignShapes(grouped, 'ungroup_shape', { shape_id: group.id });
  assert.equal(ungrouped.data.document.store[group.id], undefined);
  assert.equal(ungrouped.data.document.store[first.shapeId].x, 20);
  assert.equal(ungrouped.data.document.store[second.shapeId].y, 150);
  assert.throws(() => mutateDesignShapes(second.content, 'group_shapes', { shape_ids: [frame.shapeId, first.shapeId] }), InvalidDesignMutation);
});
