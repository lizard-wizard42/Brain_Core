import { api } from '../../api/client';
import type { PageSummary } from '../../types';

let cachedAllPages: PageSummary[] | null = null;
let cachedAllPagesPromise: Promise<PageSummary[]> | null = null;
let cachedAllPagesGeneration = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('brain-core:session-ended', () => {
    cachedAllPagesGeneration += 1;
    cachedAllPages = null;
    cachedAllPagesPromise = null;
  });
}

export async function loadAllPagesCached(): Promise<PageSummary[]> {
  if (cachedAllPages) return cachedAllPages;
  if (!cachedAllPagesPromise) {
    const generation = cachedAllPagesGeneration;
    cachedAllPagesPromise = api.getTree()
      .then(({ pages }) => {
        if (generation === cachedAllPagesGeneration) cachedAllPages = pages;
        return pages;
      })
      .catch((err) => {
        if (generation === cachedAllPagesGeneration) cachedAllPagesPromise = null;
        throw err;
      });
  }
  return cachedAllPagesPromise;
}

/** Synchronous read of the last loaded page list (empty until loadAllPagesCached resolves). */
export function getCachedAllPages(): PageSummary[] | null {
  return cachedAllPages;
}
