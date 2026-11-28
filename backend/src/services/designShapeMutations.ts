import { getIndexAbove, getIndexBelow, getIndexBetween } from '@tldraw/utils';
import { randomUUID } from 'crypto';
import { validDesignDocument } from './designDocument';

type MapValue = Record<string, unknown>;
type Snapshot = { tldraw: true; version: 1; data: null | { document: { store: Record<string, MapValue> }; session: MapValue } };
export class InvalidDesignMutation extends Error {}
const compareIndex = (a: unknown, b: unknown) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const shapeId = /^shape:[A-Za-z0-9_-]{1,128}$/;
const hex = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const colors = new Set(['black','grey','light-violet','violet','blue','light-blue','yellow','orange','green','light-green','light-red','red','white']);
const fills = new Set(['none','semi','solid','pattern','fill','lined-fill']);
const blends = new Set(['normal','multiply','screen','overlay','darken','lighten']);
const map = (value: unknown): value is MapValue => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function copy(content: unknown): Snapshot {
  if (!validDesignDocument(content)) throw new InvalidDesignMutation('Invalid Design document');
  return JSON.parse(JSON.stringify(content)) as Snapshot;
}
function shape(store: Record<string, MapValue>, id: unknown): MapValue {
  if (typeof id !== 'string' || !shapeId.test(id) || store[id]?.typeName !== 'shape') throw new InvalidDesignMutation('Shape not found');
  return store[id];
}
function validatePatch(record: MapValue, patch: unknown): MapValue {
  if (!map(patch) || !Object.keys(patch).length) throw new InvalidDesignMutation('Invalid shape patch');
  const next: MapValue = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'x' || key === 'y') {
      if (!finite(value, -1_000_000, 1_000_000)) throw new InvalidDesignMutation(`Invalid ${key}`);
      next[key] = value;
    } else if (key === 'rotation') {
      if (!finite(value, -360, 360)) throw new InvalidDesignMutation('Invalid rotation');
      next.rotation = value;
    } else if (key === 'opacity') {
      if (!finite(value, 0, 1)) throw new InvalidDesignMutation('Invalid opacity');
      next.opacity = value;
    } else if (key === 'isLocked') {
      if (typeof value !== 'boolean') throw new InvalidDesignMutation('Invalid lock');
      next.isLocked = value;
    } else if (key === 'props') {
      if (!map(value) || !Object.keys(value).length) throw new InvalidDesignMutation('Invalid shape props');
      const type = record.type;
      const allowed = type === 'design-card'
        ? new Set(['w','h','text','body','fill','textColor','bodyColor','borderColor','shadowColor','fontSize','bodyFontSize','bodyFontWeight','bodyGap','radius','borderWidth','shadowX','shadowY','shadowBlur','blendMode','brightness','contrast','saturation','fontFamily','fontWeight','textAlign','verticalAlign','padding','lineHeight','letterSpacing','gradientTo'])
        : type === 'frame' ? new Set(['w','h','name'])
        : type === 'geo' ? new Set(['w','h','color','fill'])
        : type === 'text' ? new Set(['w','text','color'])
        : type === 'image' ? new Set(['w','h','altText']) : new Set<string>();
      if (type === 'design-vector') for (const key of ['w','h','kind','fill','stroke','strokeWidth','radius']) allowed.add(key);
      if (type === 'design-group') allowed.add('name');
      const clean: MapValue = {};
      for (const [prop, item] of Object.entries(value)) {
        if (!allowed.has(prop)) throw new InvalidDesignMutation(`Unsupported ${prop}`);
        if (prop === 'w' || prop === 'h') {
          if (!finite(item, 1, 10000)) throw new InvalidDesignMutation(`Invalid ${prop}`);
        } else if (prop === 'text' || prop === 'body') {
          if (typeof item !== 'string' || item.length > 5000) throw new InvalidDesignMutation('Invalid text');
          if (type === 'text') {
            clean.richText = { type: 'doc', content: [{ type: 'paragraph', content: item ? [{ type: 'text', text: item }] : [] }] };
            continue;
          }
        } else if (prop === 'name' || prop === 'altText') {
          if (typeof item !== 'string' || item.length > 160) throw new InvalidDesignMutation(`Invalid ${prop}`);
        } else if (['fill','textColor','bodyColor','borderColor','shadowColor','gradientTo'].includes(prop) && type === 'design-card') {
          if (typeof item !== 'string' || !hex.test(item)) throw new InvalidDesignMutation(`Invalid ${prop}`);
        } else if ((prop === 'fill' || prop === 'stroke') && type === 'design-vector') {
          if (typeof item !== 'string' || !hex.test(item)) throw new InvalidDesignMutation(`Invalid ${prop}`);
        } else if (prop === 'kind' && type === 'design-vector') {
          if (!['rectangle','ellipse','line'].includes(String(item))) throw new InvalidDesignMutation('Invalid vector kind');
        } else if (prop === 'strokeWidth' && type === 'design-vector') {
          if (!finite(item, 0, 40)) throw new InvalidDesignMutation('Invalid strokeWidth');
        } else if (prop === 'radius' && type === 'design-vector') {
          if (!finite(item, 0, 500)) throw new InvalidDesignMutation('Invalid radius');
        } else if (prop === 'color') {
          if (typeof item !== 'string' || !colors.has(item)) throw new InvalidDesignMutation('Invalid color');
        } else if (prop === 'fill') {
          if (typeof item !== 'string' || !fills.has(item)) throw new InvalidDesignMutation('Invalid fill');
        } else if (prop === 'blendMode') {
          if (typeof item !== 'string' || !blends.has(item)) throw new InvalidDesignMutation('Invalid blendMode');
        } else if (prop === 'fontFamily') {
          if (typeof item !== 'string' || !['Inter','Arial','Georgia','monospace'].includes(item)) throw new InvalidDesignMutation('Invalid fontFamily');
        } else if (prop === 'textAlign') {
          if (typeof item !== 'string' || !['left','center','right'].includes(item)) throw new InvalidDesignMutation('Invalid textAlign');
        } else if (prop === 'verticalAlign') {
          if (typeof item !== 'string' || !['top','middle','bottom'].includes(item)) throw new InvalidDesignMutation('Invalid verticalAlign');
        } else if (prop === 'fontWeight' || prop === 'bodyFontWeight') {
          if (!finite(item, 100, 900)) throw new InvalidDesignMutation('Invalid fontWeight');
        } else if (prop === 'lineHeight') {
          if (!finite(item, 0.8, 3)) throw new InvalidDesignMutation('Invalid lineHeight');
        } else if (prop === 'letterSpacing') {
          if (!finite(item, -5, 20)) throw new InvalidDesignMutation('Invalid letterSpacing');
        } else if (prop === 'padding' || prop === 'bodyGap') {
          if (!finite(item, 0, 200)) throw new InvalidDesignMutation('Invalid padding');
        } else if (prop === 'bodyFontSize') {
          if (!finite(item, 8, 160)) throw new InvalidDesignMutation('Invalid bodyFontSize');
        } else if (!finite(item, -200, 500)) throw new InvalidDesignMutation(`Invalid ${prop}`);
        clean[prop] = item;
      }
      next.props = { ...(record.props as MapValue), ...clean };
    } else throw new InvalidDesignMutation(`Unsupported ${key}`);
  }
  return next;
}

export function designShapeTree(content: unknown) {
  const doc = copy(content);
  const store = doc.data?.document.store ?? {};
  return Object.values(store).filter(item => item.typeName === 'shape').map(item => ({
    id: item.id, type: item.type, parent_id: item.parentId, index: item.index,
    x: item.x, y: item.y, rotation: item.rotation, opacity: item.opacity, is_locked: item.isLocked,
    props: item.props,
  })).sort((a, b) => String(a.parent_id).localeCompare(String(b.parent_id)) || compareIndex(a.index, b.index));
}

export function mutateDesignShapes(content: unknown, action: 'update_shape' | 'delete_shapes' | 'reorder_shape' | 'group_shapes' | 'ungroup_shape', input: MapValue) {
  const doc = copy(content);
  const store = doc.data?.document.store;
  if (!store) throw new InvalidDesignMutation('Design has no shapes');
  if (action === 'group_shapes') {
    const ids = input.shape_ids;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 100 || new Set(ids).size !== ids.length) throw new InvalidDesignMutation('Select 2 to 100 shapes');
    const items = ids.map(id => shape(store, id));
    if (items.some(item => item.type === 'frame' || item.parentId !== items[0].parentId)) throw new InvalidDesignMutation('Shapes must share a parent');
    const parentId = String(items[0].parentId);
    const x = Math.min(...items.map(item => Number(item.x))), y = Math.min(...items.map(item => Number(item.y)));
    const right = Math.max(...items.map(item => Number(item.x) + (Number((item.props as MapValue)?.w) || 80)));
    const bottom = Math.max(...items.map(item => Number(item.y) + (Number((item.props as MapValue)?.h) || 80)));
    const siblings = Object.values(store).filter(item => item.typeName === 'shape' && item.parentId === parentId)
      .map(item => String(item.index)).sort();
    const id = `shape:${randomUUID()}`;
    store[id] = { id, typeName: 'shape', type: 'design-group', parentId,
      index: getIndexAbove(siblings.at(-1) as never), x, y, rotation: 0, opacity: 1, isLocked: false,
      meta: {}, props: { w: Math.max(1, right - x), h: Math.max(1, bottom - y), name: 'Group' } };
    for (const item of items) { item.parentId = id; item.x = Number(item.x) - x; item.y = Number(item.y) - y; }
  } else if (action === 'ungroup_shape') {
    const group = shape(store, input.shape_id);
    if (group.type !== 'design-group') throw new InvalidDesignMutation('Shape is not a group');
    const siblings = Object.values(store).filter(item => item.typeName === 'shape' && item.parentId === group.parentId)
      .map(item => String(item.index)).sort();
    let index = siblings.at(-1) as Parameters<typeof getIndexAbove>[0];
    for (const child of Object.values(store).filter(item => item.typeName === 'shape' && item.parentId === group.id)) {
      index = getIndexAbove(index);
      child.parentId = group.parentId; child.x = Number(child.x) + Number(group.x); child.y = Number(child.y) + Number(group.y); child.index = index;
    }
    delete store[String(group.id)];
  } else if (action === 'update_shape') {
    const target = shape(store, input.shape_id);
    Object.assign(target, validatePatch(target, input.patch));
  } else if (action === 'delete_shapes') {
    const ids = input.shape_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new InvalidDesignMutation('Invalid shape IDs');
    const deleted = new Set<string>();
    for (const id of ids) { shape(store, id); deleted.add(id as string); }
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of Object.values(store)) if (item.typeName === 'shape' && typeof item.parentId === 'string' && deleted.has(item.parentId) && !deleted.has(item.id as string)) {
        deleted.add(item.id as string); changed = true;
      }
    }
    const removedAssetIds = new Set([...deleted].map(id => store[id]).filter(item => item?.type === 'image').map(item => (item.props as MapValue)?.assetId));
    for (const id of deleted) delete store[id];
    // Remove only assets orphaned by this deletion, leaving unrelated records intact.
    const used = new Set(Object.values(store).filter(item => item.typeName === 'shape' && item.type === 'image').map(item => (item.props as MapValue)?.assetId));
    for (const id of removedAssetIds) if (typeof id === 'string' && store[id]?.typeName === 'asset' && !used.has(id)) delete store[id];
  } else {
    const target = shape(store, input.shape_id);
    const parent = target.parentId;
    const siblings = Object.values(store).filter(item => item.typeName === 'shape' && item.parentId === parent && item.id !== target.id)
      .sort((a,b) => compareIndex(a.index, b.index));
    let below: string | undefined, above: string | undefined;
    if (input.before_shape_id !== undefined) {
      const before = shape(store, input.before_shape_id);
      if (before.parentId !== parent || before.id === target.id) throw new InvalidDesignMutation('Target must be a sibling');
      const position = siblings.findIndex(item => item.id === before.id);
      below = position > 0 ? String(siblings[position - 1].index) : undefined;
      above = String(before.index);
    } else below = siblings.length ? String(siblings[siblings.length - 1].index) : undefined;
    target.index = below && above ? getIndexBetween(below as never, above as never)
      : above ? getIndexBelow(above as never) : getIndexAbove(below as never);
  }
  if (!validDesignDocument(doc)) throw new InvalidDesignMutation('Design size limit exceeded');
  return doc;
}
