import { describe, expect, it } from 'vitest';
import { getIndexAbove } from '@tldraw/utils';
import { addDesignCard, addDesignFrame, changeDesignShape, designShapes, openDesignSnapshot } from './designSnapshotAdapter';

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
});
