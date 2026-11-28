import { Point } from 'fabric';
import type { Canvas } from 'fabric';

type PanMode = { current: boolean };

/** Pans the viewport only; document shapes and revisions remain untouched. */
export function attachDesignPan(canvas: Canvas, mode: PanMode) {
  const surface = canvas.upperCanvasEl;
  let spaceHeld = false;
  let drag: { pointerId: number; x: number; y: number } | null = null;

  const sync = () => {
    const active = mode.current || spaceHeld;
    canvas.selection = !active;
    canvas.skipTargetFind = active;
    canvas.defaultCursor = active ? 'grab' : 'default';
    canvas.hoverCursor = active ? 'grab' : 'move';
    surface.style.cursor = drag ? 'grabbing' : active ? 'grab' : 'default';
  };

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 1 && !(event.button === 0 && (mode.current || spaceHeld))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    surface.setPointerCapture?.(event.pointerId);
    sync();
  };

  const pointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (dx || dy) {
      canvas.relativePan(new Point(dx, dy));
      canvas.requestRenderAll();
    }
  };

  const pointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    drag = null;
    sync();
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.repeat) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    event.preventDefault();
    spaceHeld = true;
    sync();
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || !spaceHeld) return;
    event.preventDefault();
    spaceHeld = false;
    sync();
  };
  const blur = () => { drag = null; spaceHeld = false; sync(); };
  const auxClick = (event: MouseEvent) => { if (event.button === 1) event.preventDefault(); };

  surface.addEventListener('pointerdown', pointerDown, true);
  surface.addEventListener('pointermove', pointerMove, true);
  surface.addEventListener('pointerup', pointerUp, true);
  surface.addEventListener('pointercancel', pointerUp, true);
  surface.addEventListener('auxclick', auxClick);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  sync();

  return { sync, dispose: () => {
    surface.removeEventListener('pointerdown', pointerDown, true);
    surface.removeEventListener('pointermove', pointerMove, true);
    surface.removeEventListener('pointerup', pointerUp, true);
    surface.removeEventListener('pointercancel', pointerUp, true);
    surface.removeEventListener('auxclick', auxClick);
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
  } };
}
