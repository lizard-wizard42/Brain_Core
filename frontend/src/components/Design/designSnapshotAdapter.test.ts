import { describe, expect, it } from 'vitest';
import { getIndexAbove } from '@tldraw/utils';
import { absolutePosition, addDesignCard, addDesignFrame, addDesignImage, addDesignVector, changeDesignShape, designShapes, duplicateDesignShape, groupDesignShapes, openDesignSnapshot, removeDesignShape, replaceDesignImage, ungroupDesignShape } from './designSnapshotAdapter';

describe('Design snapshot adapter', () => {
  it('preserves a board with 23 cards, text and archived annotations', () => {
    const empty = openDesignSnapshot({ tldraw: true, version: 1, data: null });
    const frame = addDesignFrame(empty, 'Example board', 1080, 1350);
    let current = frame.snapshot;
    for (let index = 0; index < 23; index++) {
      const added = addDesignCard(current, frame.id);
      current = changeDesignShape(added.snapshot, added.id, { props: { text: `Fictional card ${index + 1}` } });
    }
    const page = current.data.document.store['page:page'];
    page.meta = { brainCoreArchivedAnnotations: [{ shapeId: 'shape:legacy', text: 'Fictional preserved note' }] };
    const before = JSON.stringify(current);
    const restored = openDesignSnapshot(current);
    expect(designShapes(restored)).toHaveLength(24);
    expect(designShapes(restored).filter(shape => shape.type === 'design-card').map(shape => shape.props.text))
      .toEqual(Array.from({ length: 23 }, (_, index) => `Fictional card ${index + 1}`));
    expect(restored.data.document.store['page:page'].meta).toEqual(page.meta);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('generates valid distinct order keys beyond 62 sibling cards', () => {
    const frame = addDesignFrame(openDesignSnapshot({ tldraw: true, version: 1, data: null }), 'Many cards', 1080, 1080);
    let current = frame.snapshot;
    for (let index = 0; index < 70; index++) current = addDesignCard(current, frame.id).snapshot;
    const keys = designShapes(current).filter(shape => shape.parentId === frame.id).map(shape => shape.index);
    expect(new Set(keys).size).toBe(70);
    expect(keys).toEqual([...keys].sort());
    for (const key of keys) expect(() => getIndexAbove(key as Parameters<typeof getIndexAbove>[0])).not.toThrow();
  });

  it('keeps unrecognized shape records instead of removing them', () => {
    const doc = openDesignSnapshot({ tldraw: true, version: 1, data: null });
    doc.data.document.store['shape:legacy'] = { id: 'shape:legacy', typeName: 'shape', type: 'image', parentId: 'page:page',
      index: 'a1', x: 0, y: 0, props: { w: 100, h: 100, assetId: 'asset:legacy' }, meta: { imported: true } };
    const roundtrip = openDesignSnapshot(doc);
    expect(roundtrip.data.document.store['shape:legacy']).toEqual(doc.data.document.store['shape:legacy']);
  });

  it('adds, replaces, duplicates and removes owned images without losing unrelated shapes', () => {
    const frame = addDesignFrame(openDesignSnapshot({ tldraw: true, version: 1, data: null }), 'Synthetic board', 1080, 1350);
    const card = addDesignCard(frame.snapshot, frame.id);
    const image = addDesignImage(card.snapshot, frame.id, '/uploads/design/synthetic.png', 400, 500);
    const copy = duplicateDesignShape(image.snapshot, image.id);
    const replaced = replaceDesignImage(copy.snapshot, copy.id, '/uploads/design/other.png');
    const kept = removeDesignShape(replaced, image.id);
    expect(designShapes(kept).map(shape => shape.id)).toContain(card.id);
    expect(designShapes(kept).map(shape => shape.id)).toContain(copy.id);
    expect(kept.data.document.store[String(designShapes(kept).find(shape => shape.id === copy.id)?.props.assetId)]).toBeTruthy();
    expect(() => addDesignImage(kept, frame.id, 'https://external.test/private.png', 10, 10)).toThrow();
  });

  it('duplicates a frame with its children and removes only that subtree', () => {
    const frame = addDesignFrame(openDesignSnapshot({ tldraw: true, version: 1, data: null }), 'Original', 1080, 1350);
    const card = addDesignCard(frame.snapshot, frame.id);
    const duplicated = duplicateDesignShape(card.snapshot, frame.id);
    expect(designShapes(duplicated.snapshot).filter(shape => shape.parentId === duplicated.id)).toHaveLength(1);
    const removed = removeDesignShape(duplicated.snapshot, duplicated.id);
    expect(designShapes(removed).map(shape => shape.id)).toContain(frame.id);
    expect(designShapes(removed).map(shape => shape.id)).toContain(card.id);
    expect(designShapes(removed).map(shape => shape.id)).not.toContain(duplicated.id);
  });

  it('keeps vector kinds and hex colors editable alongside cards', () => {
    const frame = addDesignFrame(openDesignSnapshot({ tldraw: true, version: 1, data: null }), 'Synthetic', 1080, 1350);
    const ellipse = addDesignVector(frame.snapshot, frame.id, 'ellipse');
    const changed = changeDesignShape(ellipse.snapshot, ellipse.id, { props: { fill: '#123456', stroke: '#abcdef' } });
    const shape = designShapes(changed).find(item => item.id === ellipse.id);
    expect(shape?.type).toBe('design-vector');
    expect(shape?.props).toMatchObject({ kind: 'ellipse', fill: '#123456', stroke: '#abcdef' });
  });

  it('groups and ungroups sibling cards without changing absolute positions or text', () => {
    const frame = addDesignFrame(openDesignSnapshot({ tldraw: true, version: 1, data: null }), 'Synthetic', 1080, 1350);
    const first = addDesignCard(frame.snapshot, frame.id);
    const second = addDesignCard(first.snapshot, frame.id);
    const before = designShapes(second.snapshot).filter(item => [first.id, second.id].includes(item.id));
    const group = groupDesignShapes(second.snapshot, [first.id, second.id]);
    const grouped = designShapes(group.snapshot).filter(item => [first.id, second.id].includes(item.id));
    expect(grouped.map(item => absolutePosition(item, group.snapshot))).toEqual(before.map(item => absolutePosition(item, second.snapshot)));
    expect(grouped.every(item => item.parentId === group.id)).toBe(true);
    const restored = ungroupDesignShape(group.snapshot, group.id);
    expect(designShapes(restored).filter(item => [first.id, second.id].includes(item.id)).map(item => absolutePosition(item, restored)))
      .toEqual(before.map(item => absolutePosition(item, second.snapshot)));
    expect(designShapes(restored).find(item => item.id === group.id)).toBeUndefined();
  });
});
