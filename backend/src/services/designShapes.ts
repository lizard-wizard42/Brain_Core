import { randomUUID } from 'crypto';
import { getIndexAbove } from '@tldraw/utils';
import seed from './designSnapshotSeed.json';
import { validDesignDocument } from './designDocument';

type ShapeAction = 'add_frame' | 'add_text' | 'add_rectangle' | 'add_vector' | 'add_image' | 'add_card';
type JsonMap = Record<string, unknown>;
type Shape = JsonMap & { id: string; type: string; parentId: string; index: string; x: number; y: number; props: JsonMap };
type DesignDoc = { tldraw: true; version: 1; data: null | { document: { store: Record<string, JsonMap>; schema: JsonMap }; session: JsonMap } };

export class InvalidDesignShape extends Error {}
const colors = new Set(['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white']);
const fills = new Set(['none', 'semi', 'solid', 'pattern', 'fill', 'lined-fill']);
const blendModes = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']);
const cardNumberRanges: Record<string, [number, number]> = {
  fontSize: [8, 160], radius: [0, 500], borderWidth: [0, 40], shadowX: [-200, 200], shadowY: [-200, 200],
  shadowBlur: [0, 200], brightness: [0, 200], contrast: [0, 200], saturation: [0, 200],
  fontWeight: [100, 900], padding: [0, 200], lineHeight: [0.8, 3], letterSpacing: [-5, 20],
  bodyFontSize: [8, 160], bodyFontWeight: [100, 900], bodyGap: [0, 200],
};
const cardHexFields = new Set(['fill', 'textColor', 'borderColor', 'shadowColor', 'gradientTo', 'bodyColor']);
const cardFonts = new Set(['Inter', 'Arial', 'Georgia', 'monospace']);
const textAlignments = new Set(['left', 'center', 'right']);
const verticalAlignments = new Set(['top', 'middle', 'bottom']);
const map = (value: unknown): value is JsonMap => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown, name: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new InvalidDesignShape(`Invalid ${name}`);
  return value;
};
const text = (value: unknown, name: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InvalidDesignShape(`Invalid ${name}`);
  return value.trim();
};
const color = (value: unknown): string => {
  const chosen = value ?? 'black';
  if (typeof chosen !== 'string' || !colors.has(chosen)) throw new InvalidDesignShape('Unsupported color');
  return chosen;
};
function cardAppearance(value: unknown): JsonMap {
  if (value === undefined) return {};
  if (!map(value)) throw new InvalidDesignShape('Invalid card appearance');
  const result: JsonMap = {};
  for (const [key, item] of Object.entries(value)) {
    if (key in cardNumberRanges) {
      const [min, max] = cardNumberRanges[key]; result[key] = number(item, key, min, max);
    } else if (cardHexFields.has(key)) {
      if (typeof item !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(item)) throw new InvalidDesignShape(`Invalid ${key}`);
      result[key] = item;
    } else if (key === 'blendMode') {
      if (typeof item !== 'string' || !blendModes.has(item)) throw new InvalidDesignShape('Invalid blendMode');
      result[key] = item;
    } else if (key === 'fontFamily') {
      if (typeof item !== 'string' || !cardFonts.has(item)) throw new InvalidDesignShape('Invalid fontFamily');
      result[key] = item;
    } else if (key === 'textAlign') {
      if (typeof item !== 'string' || !textAlignments.has(item)) throw new InvalidDesignShape('Invalid textAlign');
      result[key] = item;
    } else if (key === 'verticalAlign') {
      if (typeof item !== 'string' || !verticalAlignments.has(item)) throw new InvalidDesignShape('Invalid verticalAlign');
      result[key] = item;
    } else throw new InvalidDesignShape(`Unsupported card property: ${key}`);
  }
  return result;
}
function snapshot(content: unknown): DesignDoc {
  if (!validDesignDocument(content)) throw new InvalidDesignShape('Invalid Design document');
  const copy = JSON.parse(JSON.stringify(content)) as DesignDoc;
  if (copy.data === null) copy.data = { document: JSON.parse(JSON.stringify(seed.document)), session: JSON.parse(JSON.stringify(seed.session)) };
  return copy;
}
function currentPage(store: Record<string, JsonMap>, session: JsonMap): string {
  const requested = session.currentPageId;
  if (typeof requested === 'string' && store[requested]?.typeName === 'page') return requested;
  const first = Object.values(store).find(record => record.typeName === 'page');
  if (!first || typeof first.id !== 'string') throw new InvalidDesignShape('Design has no page');
  return first.id;
}
function parentFor(store: Record<string, JsonMap>, pageId: string, frameId: unknown): string {
  if (frameId === undefined) return pageId;
  if (typeof frameId !== 'string' || !/^shape:[A-Za-z0-9_-]{1,128}$/.test(frameId) ||
      store[frameId]?.typeName !== 'shape' || store[frameId]?.type !== 'frame') throw new InvalidDesignShape('Frame not found');
  let ancestor = store[frameId].parentId;
  for (let depth = 0; depth < 64 && typeof ancestor === 'string'; depth++) {
    if (ancestor === pageId) return frameId;
    ancestor = store[ancestor]?.parentId;
  }
  throw new InvalidDesignShape('Frame belongs to a different page');
}
function nextIndex(store: Record<string, JsonMap>, parentId: string): string {
  const last = Object.values(store).filter(record => record.typeName === 'shape' && record.parentId === parentId && typeof record.index === 'string')
    .map(record => record.index as string).sort().slice(-1)[0];
  if (!last) return 'a1';
  try {
    return getIndexAbove(last as ReturnType<typeof getIndexAbove>);
  } catch {
    throw new InvalidDesignShape('Design contains an invalid shape index');
  }
}
function baseShape(type: string, parentId: string, index: string, x: number, y: number, props: JsonMap): Shape {
  return { x, y, rotation: 0, isLocked: false, opacity: 1, meta: {}, id: `shape:${randomUUID()}`,
    type, parentId, index, props, typeName: 'shape' };
}

export function addDesignShape(content: unknown, action: ShapeAction, input: JsonMap): { content: DesignDoc; shapeId: string } {
  const doc = snapshot(content);
  const data = doc.data!;
  const store = data.document.store;
  if (!map(store) || !map(data.document.schema)) throw new InvalidDesignShape('Invalid tldraw snapshot');
  const pageId = currentPage(store, data.session);
  const existingFrames = Object.values(store).filter(record => record.typeName === 'shape' && record.type === 'frame' && record.parentId === pageId);
  const defaultFrameX = existingFrames.length ? Math.max(...existingFrames.map(record => Number(record.x) + Number((record.props as JsonMap).w))) + 80 : 0;
  const x = input.x === undefined ? action === 'add_frame' ? defaultFrameX : 0 : number(input.x, 'x', -1_000_000, 1_000_000);
  const y = input.y === undefined ? 0 : number(input.y, 'y', -1_000_000, 1_000_000);
  let shape: Shape;
  if (action === 'add_frame') {
    const width = number(input.width, 'width', 1, 10000), height = number(input.height, 'height', 1, 10000);
    shape = baseShape('frame', pageId, nextIndex(store, pageId), x, y,
      { ...seed.templates.frame, w: width, h: height, name: text(input.name, 'name', 160) });
  } else if (action === 'add_text') {
    const parentId = parentFor(store, pageId, input.frame_id);
    const value = text(input.text, 'text', 5000);
    const width = input.width === undefined ? Math.min(960, Math.max(160, value.length * 15)) : number(input.width, 'width', 1, 10000);
    shape = baseShape('text', parentId, nextIndex(store, parentId), x, y,
      { ...seed.templates.text, w: width, autoSize: false, color: color(input.color), richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] } });
  } else if (action === 'add_card') {
    const parentId = parentFor(store, pageId, input.frame_id);
    const width = number(input.width, 'width', 1, 10000), height = number(input.height, 'height', 1, 10000);
    const label = input.text === undefined ? '' : typeof input.text === 'string' && input.text.length <= 5000 ? input.text : null;
    const body = input.body === undefined ? '' : typeof input.body === 'string' && input.body.length <= 5000 ? input.body : null;
    if (label === null) throw new InvalidDesignShape('Invalid card text');
    if (body === null) throw new InvalidDesignShape('Invalid card body');
    shape = baseShape('design-card', parentId, nextIndex(store, parentId), x, y,
      { ...seed.templates['design-card'], w: width, h: height, text: label, body, ...cardAppearance(input.appearance) });
  } else if (action === 'add_image') {
    const parentId = parentFor(store, pageId, input.frame_id);
    const width = number(input.width, 'width', 1, 10000), height = number(input.height, 'height', 1, 10000);
    const src = text(input.src, 'src', 500);
    const match = /^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/i.exec(src);
    if (!match) throw new InvalidDesignShape('Image must be an owned raster upload');
    const assetId = `asset:${randomUUID()}`;
    store[assetId] = { meta: {}, id: assetId, type: 'image', typeName: 'asset', props: {
      w: width, h: height, name: src.slice(src.lastIndexOf('/') + 1), isAnimated: match[1].toLowerCase() === 'gif',
      mimeType: match[1].toLowerCase() === 'png' ? 'image/png' : match[1].toLowerCase() === 'webp' ? 'image/webp' : match[1].toLowerCase() === 'gif' ? 'image/gif' : 'image/jpeg', src,
    } };
    const altText = input.alt_text === undefined ? '' : text(input.alt_text, 'alt_text', 500);
    shape = baseShape('image', parentId, nextIndex(store, parentId), x, y,
      { w: width, h: height, assetId, playing: true, url: '', crop: null, flipX: false, flipY: false, altText });
  } else if (action === 'add_vector') {
    const parentId = parentFor(store, pageId, input.frame_id);
    const width = number(input.width, 'width', 1, 10000), height = number(input.height, 'height', 1, 10000);
    const kind = input.kind;
    if (kind !== 'rectangle' && kind !== 'ellipse' && kind !== 'line') throw new InvalidDesignShape('Unsupported vector kind');
    const fill = input.fill ?? '#ffffff', stroke = input.stroke ?? '#111827';
    if (typeof fill !== 'string' || typeof stroke !== 'string' ||
        !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(fill) || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(stroke)) throw new InvalidDesignShape('Invalid vector color');
    const strokeWidth = input.stroke_width === undefined ? 1 : number(input.stroke_width, 'stroke_width', 0, 40);
    const radius = input.radius === undefined ? 0 : number(input.radius, 'radius', 0, 500);
    shape = baseShape('design-vector', parentId, nextIndex(store, parentId), x, y,
      { w: width, h: height, kind, fill, stroke, strokeWidth, radius });
  } else {
    const parentId = parentFor(store, pageId, input.frame_id);
    const width = number(input.width, 'width', 1, 10000), height = number(input.height, 'height', 1, 10000);
    const fill = input.fill ?? 'solid';
    if (typeof fill !== 'string' || !fills.has(fill)) throw new InvalidDesignShape('Unsupported fill');
    shape = baseShape('geo', parentId, nextIndex(store, parentId), x, y,
      { ...seed.templates.geo, w: width, h: height, geo: 'rectangle', color: color(input.color), fill });
  }
  store[shape.id] = shape;
  if (!validDesignDocument(doc)) throw new InvalidDesignShape('Design size limit exceeded');
  return { content: doc, shapeId: shape.id };
}
