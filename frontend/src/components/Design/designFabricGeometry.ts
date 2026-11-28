import type { FabricObject } from 'fabric';
import type { DesignShape } from './designSnapshotAdapter';

/** A drag or rotation must never rewrite the dimensions stored in the document. */
export function dimensionsAfterTransform(shape: DesignShape, object: FabricObject, action?: string): { w: number; h: number } | null {
  if (!action || !/^(scale|resize)/.test(action)) return null;
  if (!['frame', 'design-card', 'design-vector', 'image'].includes(shape.type)) return null;
  const baseWidth = shape.type === 'image' ? object.width : Number(shape.props.w);
  const baseHeight = shape.type === 'image' ? object.height : Number(shape.props.h);
  if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight)) return null;
  return {
    w: Math.max(1, Math.min(10000, Math.round(Math.abs(baseWidth * object.scaleX)))),
    h: Math.max(1, Math.min(10000, Math.round(Math.abs(baseHeight * object.scaleY)))),
  };
}
