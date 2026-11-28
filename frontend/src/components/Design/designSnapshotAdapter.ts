import { getIndexAbove } from '@tldraw/utils';
import seed from './designSnapshotSeed.json';
import { cardDefaults } from './designCardModel';
import type { InfiniteDoc } from '../../types';

type Json = Record<string, unknown>;
export type DesignShape = Json & {
  id: string; typeName: 'shape'; type: string; parentId: string;
  index: string; x: number; y: number; rotation: number; opacity: number;
  isLocked: boolean; props: Json;
};
export type DesignSnapshot = Extract<InfiniteDoc, { tldraw: true }> & {
  version: 1;
  data: { document: { store: Record<string, Json>; schema: Json }; session: Json };
};

const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Opens the legacy snapshot without dropping any records or metadata. */
export function openDesignSnapshot(content: unknown): DesignSnapshot {
  if (!record(content) || content.tldraw !== true || content.version !== 1) throw new Error('Formato Design desconhecido');
  const snapshot = clone(content) as DesignSnapshot;
  if (snapshot.data === null) snapshot.data = { document: clone(seed.document), session: clone(seed.session) };
  if (!record(snapshot.data) || !record(snapshot.data.document) || !record(snapshot.data.document.store)
    || !record(snapshot.data.document.schema) || !record(snapshot.data.session)) throw new Error('Documento Design inválido');
  const store = snapshot.data.document.store;
  if (!Object.values(store).some(item => record(item) && item.typeName === 'page')) throw new Error('Documento Design sem página');
  // Keep every shape record, including types the new canvas cannot yet edit.
  // The renderer shows a placeholder for an unknown type instead of dropping it.
  return snapshot;
}

export function designShapes(snapshot: DesignSnapshot): DesignShape[] {
  return Object.values(snapshot.data.document.store)
    .filter((item): item is DesignShape => record(item) && item.typeName === 'shape'
      && typeof item.id === 'string' && typeof item.type === 'string' && typeof item.parentId === 'string'
      && typeof item.index === 'string' && record(item.props) && typeof item.x === 'number' && typeof item.y === 'number')
    .sort((a, b) => a.parentId < b.parentId ? -1 : a.parentId > b.parentId ? 1
      : a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
}

export function designFrames(snapshot: DesignSnapshot): DesignShape[] {
  const pages = new Set(Object.values(snapshot.data.document.store).filter(item => record(item) && item.typeName === 'page').map(item => String(item.id)));
  return designShapes(snapshot).filter(shape => shape.type === 'frame' && pages.has(shape.parentId));
}

export function absolutePosition(shape: DesignShape, snapshot: DesignSnapshot): { x: number; y: number } {
  let x = shape.x, y = shape.y, parentId = shape.parentId;
  for (let depth = 0; depth < 32; depth++) {
    const parent = snapshot.data.document.store[parentId];
    if (!record(parent) || parent.typeName !== 'shape') break;
    x += Number(parent.x) || 0;
    y += Number(parent.y) || 0;
    parentId = String(parent.parentId);
  }
  return { x, y };
}

export function changeDesignShape(snapshot: DesignSnapshot, id: string, patch: { x?: number; y?: number; rotation?: number; opacity?: number; props?: Json }): DesignSnapshot {
  const next = clone(snapshot);
  const shape = next.data.document.store[id];
  if (!record(shape) || shape.typeName !== 'shape') throw new Error('Elemento não encontrado');
  for (const key of ['x', 'y', 'rotation'] as const) if (patch[key] !== undefined) {
    if (!Number.isFinite(patch[key])) throw new Error('Coordenada inválida');
    shape[key] = patch[key];
  }
  if (patch.opacity !== undefined) {
    if (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1) throw new Error('Opacidade inválida');
    shape.opacity = patch.opacity;
  }
  if (patch.props) shape.props = { ...(record(shape.props) ? shape.props : {}), ...patch.props };
  return next;
}

function appendShape(snapshot: DesignSnapshot, type: 'frame' | 'design-card' | 'design-vector' | 'image', parentId: string, x: number, y: number, props: Json): { snapshot: DesignSnapshot; id: string } {
  const next = clone(snapshot);
  const store = next.data.document.store;
  const siblings = Object.values(store).filter(item => record(item) && item.typeName === 'shape' && item.parentId === parentId)
    .map(item => String(item.index)).sort();
  const index = siblings.length ? getIndexAbove(siblings.at(-1) as ReturnType<typeof getIndexAbove>) : 'a1';
  const id = `shape:${crypto.randomUUID()}`;
  store[id] = { id, typeName: 'shape', type, parentId, index, x, y, rotation: 0, opacity: 1, isLocked: false, meta: {}, props };
  return { snapshot: next, id };
}

export function addDesignFrame(snapshot: DesignSnapshot, name: string, width: number, height: number): { snapshot: DesignSnapshot; id: string } {
  const pageId = String(snapshot.data.session.currentPageId || 'page:page');
  if (snapshot.data.document.store[pageId]?.typeName !== 'page') throw new Error('Página Design não encontrada');
  const frames = designFrames(snapshot);
  const x = frames.length ? Math.max(...frames.map(frame => frame.x + Number(frame.props.w))) + 80 : 0;
  return appendShape(snapshot, 'frame', pageId, x, 0, { ...seed.templates.frame, w: width, h: height, name });
}

export function addDesignCard(snapshot: DesignSnapshot, frameId: string): { snapshot: DesignSnapshot; id: string } {
  const frame = snapshot.data.document.store[frameId];
  if (!record(frame) || frame.type !== 'frame') throw new Error('Quadro não encontrado');
  return appendShape(snapshot, 'design-card', frameId, 40, 40, { ...cardDefaults });
}

export function addDesignVector(snapshot: DesignSnapshot, frameId: string, kind: 'rectangle' | 'ellipse' | 'line'): { snapshot: DesignSnapshot; id: string } {
  const frame = snapshot.data.document.store[frameId];
  if (!record(frame) || frame.type !== 'frame') throw new Error('Quadro não encontrado');
  return appendShape(snapshot, 'design-vector', frameId, 80, 80, {
    w: kind === 'line' ? 300 : 240, h: kind === 'line' ? 2 : 160,
    kind, fill: '#ffffff', stroke: '#176fa8', strokeWidth: 2, radius: 16,
  });
}

const ownedImage = /^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i;

export function addDesignImage(snapshot: DesignSnapshot, frameId: string, src: string, width: number, height: number): { snapshot: DesignSnapshot; id: string } {
  if (!ownedImage.test(src) || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 10000 || height > 10000) throw new Error('Imagem inválida');
  const frame = snapshot.data.document.store[frameId];
  if (!record(frame) || frame.type !== 'frame') throw new Error('Quadro não encontrado');
  const assetId = `asset:${crypto.randomUUID()}`;
  const next = clone(snapshot);
  next.data.document.store[assetId] = { id: assetId, typeName: 'asset', type: 'image', meta: {}, props: {
    w: width, h: height, name: src.slice(src.lastIndexOf('/') + 1), isAnimated: /\.gif$/i.test(src),
    mimeType: /\.png$/i.test(src) ? 'image/png' : /\.webp$/i.test(src) ? 'image/webp' : /\.gif$/i.test(src) ? 'image/gif' : 'image/jpeg', src,
  } };
  return appendShape(next, 'image', frameId, 40, 40, { w: width, h: height, assetId, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' });
}

export function replaceDesignImage(snapshot: DesignSnapshot, id: string, src: string): DesignSnapshot {
  if (!ownedImage.test(src)) throw new Error('Imagem inválida');
  const next = clone(snapshot), store = next.data.document.store;
  const shape = store[id];
  if (!record(shape) || shape.type !== 'image' || !record(shape.props)) throw new Error('Imagem não encontrada');
  const oldAssetId = String(shape.props.assetId);
  const assetId = `asset:${crypto.randomUUID()}`;
  store[assetId] = { id: assetId, typeName: 'asset', type: 'image', meta: {}, props: {
    w: shape.props.w, h: shape.props.h, name: src.slice(src.lastIndexOf('/') + 1), isAnimated: /\.gif$/i.test(src),
    mimeType: /\.png$/i.test(src) ? 'image/png' : /\.webp$/i.test(src) ? 'image/webp' : /\.gif$/i.test(src) ? 'image/gif' : 'image/jpeg', src,
  } };
  shape.props.assetId = assetId;
  if (!Object.values(store).some(item => record(item) && item.typeName === 'shape' && item.type === 'image' &&
    record(item.props) && item.props.assetId === oldAssetId)) delete store[oldAssetId];
  return next;
}

export function removeDesignShape(snapshot: DesignSnapshot, id: string): DesignSnapshot {
  const next = clone(snapshot);
  const store = next.data.document.store;
  if (!record(store[id]) || store[id].typeName !== 'shape') throw new Error('Elemento não encontrado');
  const removed = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of Object.values(store)) if (record(item) && item.typeName === 'shape' &&
      typeof item.parentId === 'string' && removed.has(item.parentId) && !removed.has(String(item.id))) {
      removed.add(String(item.id)); changed = true;
    }
  }
  const assets = new Set([...removed].map(shapeId => store[shapeId]).filter(item => record(item) && item.type === 'image')
    .map(item => String((item.props as Json).assetId)));
  for (const shapeId of removed) delete store[shapeId];
  const used = new Set(Object.values(store).filter(item => record(item) && item.typeName === 'shape' && item.type === 'image')
    .map(item => String((item.props as Json).assetId)));
  for (const assetId of assets) if (!used.has(assetId) && record(store[assetId]) && store[assetId].typeName === 'asset') delete store[assetId];
  return next;
}

export function duplicateDesignShape(snapshot: DesignSnapshot, id: string): { snapshot: DesignSnapshot; id: string } {
  const next = clone(snapshot);
  const store = next.data.document.store;
  const original = store[id];
  if (!record(original) || original.typeName !== 'shape') throw new Error('Elemento não encontrado');
  const siblings = Object.values(store).filter(item => record(item) && item.typeName === 'shape' && item.parentId === original.parentId)
    .map(item => String(item.index)).sort();
  const newId = `shape:${crypto.randomUUID()}`;
  const copies = new Map<string, string>([[id, newId]]);
  store[newId] = { ...clone(original), id: newId, index: getIndexAbove(siblings.at(-1) as ReturnType<typeof getIndexAbove>),
    x: Number(original.x) + 32, y: Number(original.y) + 32 };
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of Object.values(snapshot.data.document.store)) if (record(item) && item.typeName === 'shape' &&
      typeof item.parentId === 'string' && copies.has(item.parentId) && !copies.has(String(item.id))) {
      const childId = `shape:${crypto.randomUUID()}`;
      copies.set(String(item.id), childId);
      store[childId] = { ...clone(item), id: childId, parentId: copies.get(item.parentId) };
      changed = true;
    }
  }
  return { snapshot: next, id: newId };
}

export function groupDesignShapes(snapshot: DesignSnapshot, ids: string[]): { snapshot: DesignSnapshot; id: string } {
  if (ids.length < 2 || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('Selecione de 2 a 100 elementos');
  const next = clone(snapshot), store = next.data.document.store;
  const items = ids.map(id => store[id]);
  if (items.some(item => !record(item) || item.typeName !== 'shape' || item.type === 'frame') ||
      items.some(item => item.parentId !== items[0].parentId)) throw new Error('Selecione elementos do mesmo quadro');
  const parentId = String(items[0].parentId);
  const x = Math.min(...items.map(item => Number(item.x))), y = Math.min(...items.map(item => Number(item.y)));
  const right = Math.max(...items.map(item => Number(item.x) + (Number((item.props as Json)?.w) || 80)));
  const bottom = Math.max(...items.map(item => Number(item.y) + (Number((item.props as Json)?.h) || 80)));
  const siblings = Object.values(store).filter(item => record(item) && item.typeName === 'shape' && item.parentId === parentId)
    .map(item => String(item.index)).sort();
  const id = `shape:${crypto.randomUUID()}`;
  store[id] = { id, typeName: 'shape', type: 'design-group', parentId,
    index: getIndexAbove(siblings.at(-1) as ReturnType<typeof getIndexAbove>), x, y, rotation: 0, opacity: 1,
    isLocked: false, meta: {}, props: { w: Math.max(1, right - x), h: Math.max(1, bottom - y), name: 'Grupo' } };
  for (const item of items) { item.parentId = id; item.x = Number(item.x) - x; item.y = Number(item.y) - y; }
  return { snapshot: next, id };
}

export function ungroupDesignShape(snapshot: DesignSnapshot, id: string): DesignSnapshot {
  const next = clone(snapshot), store = next.data.document.store;
  const group = store[id];
  if (!record(group) || group.type !== 'design-group') throw new Error('Grupo não encontrado');
  const siblings = Object.values(store).filter(item => record(item) && item.typeName === 'shape' && item.parentId === group.parentId)
    .map(item => String(item.index)).sort();
  let index = siblings.at(-1) as ReturnType<typeof getIndexAbove>;
  for (const child of Object.values(store).filter(item => record(item) && item.typeName === 'shape' && item.parentId === id)) {
    index = getIndexAbove(index);
    child.parentId = group.parentId; child.x = Number(child.x) + Number(group.x); child.y = Number(child.y) + Number(group.y); child.index = index;
  }
  delete store[id];
  return next;
}
