import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { clamp, fitZoom, ZOOM_MAX, ZOOM_MIN } from './notebookModel';

/**
 * A point of the screen that must stay put while zooming. `fromX/fromY` is where that content point is now
 * when it differs from where it must end up (two-finger pinch that also moved).
 */
export type ZoomFocal = { clientX: number; clientY: number; fromX?: number; fromY?: number };

export const ZOOM_STEP = 1.2;
const storageKey = (pageId: string) => `nb-zoom:${pageId}`;

function readStoredZoom(pageId: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey(pageId));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX ? value : null;
  } catch { return null; }
}
function writeStoredZoom(pageId: string, value: number | null) {
  try {
    if (value === null) window.localStorage.removeItem(storageKey(pageId));
    else window.localStorage.setItem(storageKey(pageId), String(Math.round(value * 1000) / 1000));
  } catch { /* storage can be blocked or full; the zoom simply is not remembered */ }
}

/**
 * Zoom state of one notebook: automatic fit until the user zooms, then a remembered manual zoom that keeps
 * the point under the pinch, cursor or screen center fixed.
 */
export function useNotebookZoom(workspace: RefObject<HTMLElement | null>, pageId: string) {
  const [stored] = useState(() => readStoredZoom(pageId));
  const [zoom, setZoom] = useState(stored ?? .85);
  const zoomRef = useRef(zoom);
  const manual = useRef(stored !== null);
  const pending = useRef<{ u: number; v: number; x: number; y: number } | null>(null);

  const paperRect = () => workspace.current?.querySelector('.notebook-paper-wrap')?.getBoundingClientRect();
  const autoFit = useCallback(() => {
    const element = workspace.current;
    return element ? fitZoom(element.clientWidth, element.clientHeight) : null;
  }, [workspace]);

  const commit = useCallback((value: number, focal?: ZoomFocal) => {
    const next = clamp(value, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(next - zoomRef.current) < 1e-6) { pending.current = null; return next; }
    const element = workspace.current, rect = paperRect();
    if (element && rect && rect.width > 0 && rect.height > 0) {
      const area = element.getBoundingClientRect();
      const x = focal?.clientX ?? area.left + element.clientWidth / 2, y = focal?.clientY ?? area.top + element.clientHeight / 2;
      pending.current = { x, y, u: ((focal?.fromX ?? x) - rect.left) / rect.width, v: ((focal?.fromY ?? y) - rect.top) / rect.height };
    } else pending.current = null;
    zoomRef.current = next; setZoom(next);
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  const zoomTo = useCallback((value: number, focal?: ZoomFocal) => {
    manual.current = true;
    writeStoredZoom(pageId, commit(value, focal));
  }, [commit, pageId]);
  const zoomBy = useCallback((factor: number, focal?: ZoomFocal) => zoomTo(zoomRef.current * factor, focal), [zoomTo]);
  const fit = useCallback((focal?: ZoomFocal) => {
    manual.current = false; writeStoredZoom(pageId, null);
    const target = autoFit();
    if (target !== null) commit(target, focal);
  }, [autoFit, commit, pageId]);
  /** Double tap: back to fitted when zoomed in/out, otherwise to 100%. */
  const toggleFit = useCallback((focal?: ZoomFocal) => {
    const target = autoFit();
    if (!manual.current || (target !== null && Math.abs(zoomRef.current - target) < .02)) zoomTo(1, focal);
    else fit(focal);
  }, [autoFit, fit, zoomTo]);

  // Keep the content point under the focal fixed once the new size is in the DOM.
  useLayoutEffect(() => {
    const target = pending.current; pending.current = null;
    const element = workspace.current, rect = paperRect();
    if (!target || !element || !rect) return;
    element.scrollLeft += rect.left + target.u * rect.width - target.x;
    element.scrollTop += rect.top + target.v * rect.height - target.y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Automatic fit on open, rotation and resize until the user zooms manually.
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const resize = () => {
      if (manual.current) return;
      const target = autoFit();
      if (target !== null && Math.abs(target - zoomRef.current) > 1e-6) { zoomRef.current = target; pending.current = null; setZoom(target); }
    };
    resize();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [workspace, autoFit]);

  // Ctrl+wheel (also what a laptop trackpad pinch sends) zooms around the cursor. It needs a non-passive listener.
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * .0015), { clientX: event.clientX, clientY: event.clientY });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [workspace, zoomBy]);

  // Ctrl/Cmd + = + - 0, unless the person is typing.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === '=' || event.key === '+') zoomBy(ZOOM_STEP);
      else if (event.key === '-' || event.key === '_') zoomBy(1 / ZOOM_STEP);
      else if (event.key === '0') fit();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [zoomBy, fit]);

  return { zoom, zoomTo, zoomBy, fit, toggleFit };
}
