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

export function changeDesignShape(snapshot: DesignSnapshot, id: string, patch: { x?: number; y?: number; rotation?: number; props?: Json }): DesignSnapshot {
  const next = clone(snapshot);
  const shape = next.data.document.store[id];
  if (!record(shape) || shape.typeName !== 'shape') throw new Error('Elemento não encontrado');
  for (const key of ['x', 'y', 'rotation'] as const) if (patch[key] !== undefined) {
    if (!Number.isFinite(patch[key])) throw new Error('Coordenada inválida');
    shape[key] = patch[key];
  }
  if (patch.props) shape.props = { ...(record(shape.props) ? shape.props : {}), ...patch.props };
  return next;
}

function appendShape(snapshot: DesignSnapshot, type: 'frame' | 'design-card', parentId: string, x: number, y: number, props: Json): { snapshot: DesignSnapshot; id: string } {
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
