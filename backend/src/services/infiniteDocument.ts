import { validDesignDocument } from './designDocument';
import type { InfiniteDoc } from '../types';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function emptyInfiniteDocument(): Extract<InfiniteDoc, { excalidraw: true }> {
  return { excalidraw: true, version: 1, data: { elements: [], files: {}, appState: { viewBackgroundColor: '#ffffff' } } };
}

/** Accepts legacy snapshots for recovery, but never silently converts them. */
export function validInfiniteDocument(value: unknown): value is InfiniteDoc {
  if (!object(value)) return false;
  if (value.tldraw === true) return validDesignDocument(value);
  if (value.excalidraw !== true || value.version !== 1 ||
      Object.keys(value).some(key => !['excalidraw', 'version', 'data'].includes(key)) ||
      !object(value.data)) return false;

  const data = value.data;
  if (Object.keys(data).some(key => !['elements', 'appState', 'files'].includes(key)) ||
      !Array.isArray(data.elements) || data.elements.length > 10_000 ||
      !object(data.appState) || !object(data.files) || Object.keys(data.files).length > 2_000) return false;
  if (Object.keys(data.appState).some(key => key !== 'viewBackgroundColor') ||
      (data.appState.viewBackgroundColor !== undefined &&
        (typeof data.appState.viewBackgroundColor !== 'string' ||
         !/^#[0-9a-fA-F]{6}$/.test(data.appState.viewBackgroundColor)))) return false;
  for (const element of data.elements) {
    if (!object(element) || typeof element.id !== 'string' || element.id.length > 128 ||
        typeof element.type !== 'string' || element.type.length > 64) return false;
  }
  for (const file of Object.values(data.files)) {
    if (!object(file) || typeof file.id !== 'string' || typeof file.dataURL !== 'string') return false;
  }
  try { return Buffer.byteLength(JSON.stringify(value)) <= 32 * 1024 * 1024; }
  catch { return false; }
}
