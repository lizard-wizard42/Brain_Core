import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Canvas } from 'fabric';
import { attachDesignPan } from './designPan';

function setup() {
  const surface = document.createElement('canvas');
  document.body.append(surface);
  const canvas = {
    upperCanvasEl: surface, selection: true, skipTargetFind: false,
    defaultCursor: 'default', hoverCursor: 'move',
    relativePan: vi.fn(), requestRenderAll: vi.fn(),
  } as unknown as Canvas;
  const mode = { current: false };
  const controls = attachDesignPan(canvas, mode);
  const pointer = (type: string, button: number, x: number, y: number) => {
    const event = new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    surface.dispatchEvent(event);
  };
  return { canvas, controls, mode, pointer, surface };
}

afterEach(() => { document.body.replaceChildren(); });

describe('Design Pan', () => {
  it('drags the viewport in Pan mode and restores selection when disabled', () => {
    const { canvas, controls, mode, pointer, surface } = setup();
    mode.current = true; controls.sync();
    expect(canvas.selection).toBe(false);
    expect(canvas.skipTargetFind).toBe(true);
    expect(surface.style.cursor).toBe('grab');
    pointer('pointerdown', 0, 10, 20);
    pointer('pointermove', 0, 35, 50);
    expect(canvas.relativePan).toHaveBeenCalledWith(expect.objectContaining({ x: 25, y: 30 }));
    pointer('pointerup', 0, 35, 50);
    pointer('pointermove', 0, 90, 90);
    expect(canvas.relativePan).toHaveBeenCalledTimes(1);
    mode.current = false; controls.sync();
    expect(canvas.selection).toBe(true);
    expect(canvas.skipTargetFind).toBe(false);
    controls.dispose();
  });

  it('pans with the middle button while selection mode stays active', () => {
    const { canvas, controls, pointer } = setup();
    pointer('pointerdown', 0, 0, 0);
    pointer('pointermove', 0, 20, 20);
    expect(canvas.relativePan).not.toHaveBeenCalled();
    pointer('pointerdown', 1, 0, 0);
    pointer('pointermove', 1, 20, 20);
    expect(canvas.relativePan).toHaveBeenCalledOnce();
    controls.dispose();
  });

  it('uses Space temporarily but leaves text input keys alone', () => {
    const { canvas, controls } = setup();
    const field = document.createElement('textarea'); document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
    expect(canvas.selection).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
    expect(canvas.selection).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true, cancelable: true }));
    expect(canvas.selection).toBe(true);
    controls.dispose();
  });
});
