import { describe, expect, it } from 'vitest';
import { Group, Rect } from 'fabric';
import { addDesignCard, addDesignFrame, designShapes, openDesignSnapshot } from './designSnapshotAdapter';
import { dimensionsAfterTransform } from './designFabricGeometry';

describe('Fabric Design geometry', () => {
  it('preserves a bordered card size when moved or rotated and changes size only when scaled', () => {
    const frame = addDesignFrame(openDesignSnapshot({ tldraw: true, version: 1, data: null }), 'Synthetic', 1080, 1350);
    const card = addDesignCard(frame.snapshot, frame.id);
    const shape = designShapes(card.snapshot).find(item => item.id === card.id)!;
    const object = new Group([new Rect({ width: 320, height: 240, strokeWidth: 1 })]);
    expect(object.getScaledWidth()).toBeGreaterThan(320);
    expect(dimensionsAfterTransform(shape, object, 'drag')).toBeNull();
    expect(dimensionsAfterTransform(shape, object, 'rotate')).toBeNull();
    object.set({ scaleX: 1.5, scaleY: 1.25 });
    expect(dimensionsAfterTransform(shape, object, 'scale')).toEqual({ w: 480, h: 300 });
  });
});
