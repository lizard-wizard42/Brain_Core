import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotebookCanvas, type NotebookTool } from './NotebookCanvas';
import { newNotebook } from './notebookModel';
import type { NotebookSheet } from '../../types';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => {
  class Pointer extends MouseEvent {
    pointerId: number; pointerType: string; pressure: number; width: number; height: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'pen'; this.pressure = init.pressure ?? .6; this.width = init.width ?? 1; this.height = init.height ?? 1; }
  }
  vi.stubGlobal('PointerEvent', Pointer);
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 1120, right: 800, bottom: 1120, x: 0, y: 0, toJSON: () => ({}) });
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.hasPointerCapture = vi.fn(() => true);
  SVGElement.prototype.releasePointerCapture = vi.fn();
});
function setup(options: { tool?: NotebookTool; sheet?: NotebookSheet; locked?: boolean; finger?: boolean } = {}) {
  const onChange = vi.fn<(sheet: NotebookSheet) => boolean>(() => true);
  const onInput = vi.fn();
  render(<NotebookCanvas sheet={options.sheet ?? newNotebook().sheets[0]} tool={options.tool ?? 'pen'} color="#24344b" width={2} fingerDrawing={options.finger ?? false} zoom={1} locked={options.locked ?? false} onChange={onChange} onLimit={vi.fn()} onInput={onInput} />);
  return { svg: screen.getByRole('img'), onChange, onInput };
}
const pen = { pointerId: 1, pointerType: 'pen', clientX: 20, clientY: 30, pressure: .7, button: 0 };
it('preserves received ink when pointer is cancelled and ignores duplicate capture loss', () => {
  const { svg, onChange } = setup();
  fireEvent.pointerDown(svg, pen);
  fireEvent.pointerMove(svg, { ...pen, clientX: 80, clientY: 90 });
  fireEvent.pointerCancel(svg, pen);
  fireEvent.lostPointerCapture(svg, pen);
  expect(onChange).toHaveBeenCalledTimes(1);
  const next = onChange.mock.calls[0][0] as NotebookSheet;
  expect(next.strokes[0].points).toHaveLength(2);
  expect(next.strokes[0].points[1]).toMatchObject({ x: 80, y: 90, pressure: .7 });
});
it('does not draw with a finger by default or mutate a read-only sheet', () => {
  const first = setup();
  fireEvent.pointerDown(first.svg, { ...pen, pointerType: 'touch' });
  fireEvent.pointerUp(first.svg, { ...pen, pointerType: 'touch' });
  expect(first.onChange).not.toHaveBeenCalled();
  cleanup();
  const locked = setup({ locked: true });
  fireEvent.pointerDown(locked.svg, pen); fireEvent.pointerUp(locked.svg, pen);
  expect(locked.onChange).not.toHaveBeenCalled();
});
it('erases crossing ink along a fast gesture without deleting unrelated ink', () => {
  const base = newNotebook().sheets[0];
  const ink = { id: 'crossing', tool: 'pen' as const, color: '#24344b', width: 2, points: [{ x: 100, y: 10, pressure: .5 }, { x: 100, y: 200, pressure: .5 }] };
  const { svg, onChange } = setup({ tool: 'eraser', sheet: { ...base, strokes: [ink, { ...ink, id: 'keep', points: [{ x: 500, y: 500, pressure: .5 }] }] } });
  fireEvent.pointerDown(svg, { ...pen, clientX: 20, clientY: 100 });
  fireEvent.pointerMove(svg, { ...pen, clientX: 200, clientY: 100 });
  fireEvent.pointerUp(svg, pen);
  expect((onChange.mock.calls[0][0] as NotebookSheet).strokes.map(s => s.id)).toEqual(['keep']);
});
it('creates a bounded text box at the bottom-right without replacing ink', () => {
  const { svg, onChange } = setup({ tool: 'text' });
  fireEvent.pointerDown(svg, { ...pen, clientX: 799, clientY: 1119 });
  expect((onChange.mock.calls[0][0] as NotebookSheet).texts[0]).toMatchObject({ x: 680, y: 1030, width: 104, text: '' });
});
it('selects a long stroke crossing the selection rectangle even when samples lie outside', () => {
  const sheet = newNotebook().sheets[0];
  const { svg, onChange } = setup({ tool: 'select', sheet: { ...sheet, strokes: [{ id: 'cross', tool: 'pen', width: 2, color: '#24344b', points: [{ x: 20, y: 100, pressure: .5 }, { x: 500, y: 100, pressure: .5 }] }] } });
  fireEvent.pointerDown(svg, { ...pen, clientX: 200, clientY: 80 });
  fireEvent.pointerMove(svg, { ...pen, clientX: 250, clientY: 120 });
  fireEvent.pointerUp(svg, { ...pen, clientX: 250, clientY: 120 });
  fireEvent.click(screen.getByRole('button', { name: 'Apagar seleção' }));
  expect(onChange.mock.calls[0][0].strokes).toEqual([]);
});

it('lets the pen draw even when an earlier touch gesture never received its pointerup', () => {
  const { svg, onChange } = setup();
  fireEvent.pointerDown(svg, { ...pen, pointerId: 7, pointerType: 'touch' }); // pans, and the release is lost
  fireEvent.pointerDown(svg, pen);
  fireEvent.pointerMove(svg, { ...pen, clientX: 90, clientY: 100 });
  fireEvent.pointerUp(svg, pen);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect((onChange.mock.calls[0][0] as NotebookSheet).strokes[0].points.length).toBeGreaterThan(1);
});

it('keeps the ink of a pen stroke whose end was lost when the next pen stroke starts', () => {
  const { svg, onChange } = setup();
  fireEvent.pointerDown(svg, pen);
  fireEvent.pointerMove(svg, { ...pen, clientX: 90, clientY: 100 });
  fireEvent.pointerDown(svg, { ...pen, pointerId: 2, clientX: 300, clientY: 300 }); // no up/cancel for pointer 1
  fireEvent.pointerMove(svg, { ...pen, pointerId: 2, clientX: 340, clientY: 340 });
  fireEvent.pointerUp(svg, { ...pen, pointerId: 2 });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect((onChange.mock.calls[0][0] as NotebookSheet).strokes[0].points[1]).toMatchObject({ x: 90, y: 100 });
});

it('reports the kind of pointer it receives so the editor can show whether the pen is recognized', () => {
  const { svg, onInput } = setup();
  fireEvent.pointerMove(svg, { ...pen, buttons: 0 });
  fireEvent.pointerMove(svg, { ...pen, clientX: 50 });
  expect(onInput).toHaveBeenCalledTimes(1);
  expect(onInput.mock.calls[0][0]).toMatchObject({ kind: 'pen', smallTouch: false });
  fireEvent.pointerDown(svg, { ...pen, pointerId: 5, pointerType: 'touch', width: 2, height: 2 });
  expect(onInput.mock.calls[1][0]).toMatchObject({ kind: 'touch', smallTouch: true });
  fireEvent.pointerDown(svg, { ...pen, pointerId: 6, pointerType: 'mouse', pressure: 0 });
  expect(onInput.mock.calls[2][0]).toMatchObject({ kind: 'mouse' });
});

it('shows a hover ring only while a pen hovers without touching the sheet', () => {
  const { svg } = setup();
  const ring = svg.querySelector('circle') as SVGCircleElement;
  expect(ring.style.visibility).toBe('hidden');
  fireEvent.pointerMove(svg, { ...pen, buttons: 0, clientX: 120, clientY: 140 });
  expect(ring.style.visibility).toBe('visible');
  expect(ring.getAttribute('cx')).toBe('120');
  fireEvent.pointerDown(svg, pen);
  fireEvent.pointerMove(svg, { ...pen, buttons: 1, clientX: 130, clientY: 150 });
  expect(ring.style.visibility).toBe('hidden');
});

// --- zoom gestures, touch text and the pen side button ---
const finger = (id: number, x: number, y: number, extra: Record<string, unknown> = {}) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, width: 20, height: 20, button: 0, ...extra });
function setupZoom(options: { tool?: NotebookTool; finger?: boolean } = {}) {
  const onZoom = vi.fn(), onDoubleTap = vi.fn(), onChange = vi.fn<(sheet: NotebookSheet, o?: unknown) => boolean>(() => true);
  render(<NotebookCanvas sheet={newNotebook().sheets[0]} tool={options.tool ?? 'pen'} color="#24344b" width={2} fingerDrawing={options.finger ?? false}
    zoom={1} locked={false} onChange={onChange} onLimit={vi.fn()} onZoom={onZoom} onDoubleTap={onDoubleTap} />);
  return { svg: screen.getByRole('img'), onZoom, onDoubleTap, onChange };
}
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1; }); vi.stubGlobal('cancelAnimationFrame', vi.fn()); });

it('pinches with two fingers: one onZoom call with the distance ratio, focused on the midpoint', () => {
  const { svg, onZoom, onChange } = setupZoom();
  fireEvent.pointerDown(svg, finger(1, 100, 300)); fireEvent.pointerDown(svg, finger(2, 200, 300));
  fireEvent.pointerMove(svg, finger(2, 300, 300));
  expect(onZoom).not.toHaveBeenCalled();
  const wrap = svg.closest('.notebook-paper-wrap') as HTMLElement;
  expect(wrap.style.transform).toContain('scale(2)');
  fireEvent.pointerUp(svg, finger(2, 300, 300));
  expect(onZoom).toHaveBeenCalledTimes(1);
  expect(onZoom.mock.calls[0][0]).toBeCloseTo(2, 5);
  expect(onZoom.mock.calls[0][1]).toMatchObject({ clientX: 200, clientY: 300, fromX: 150, fromY: 300 });
  expect(wrap.style.transform).toBe('');
  fireEvent.pointerUp(svg, finger(1, 100, 300));
  expect(onZoom).toHaveBeenCalledTimes(1); expect(onChange).not.toHaveBeenCalled();
});
it('clamps the pinch result to the zoom limits', () => {
  const { svg, onZoom } = setupZoom();
  fireEvent.pointerDown(svg, finger(1, 100, 300)); fireEvent.pointerDown(svg, finger(2, 110, 300));
  fireEvent.pointerMove(svg, finger(2, 700, 300)); fireEvent.pointerUp(svg, finger(2, 700, 300));
  expect(onZoom.mock.calls[0][0]).toBe(3);
});
it('cancels the pinch without zooming when the pen shows up, and lets the pen write', () => {
  const { svg, onZoom, onChange } = setupZoom();
  fireEvent.pointerDown(svg, finger(1, 100, 300)); fireEvent.pointerDown(svg, finger(2, 200, 300));
  fireEvent.pointerMove(svg, finger(2, 300, 300));
  fireEvent.pointerDown(svg, pen);
  expect((svg.closest('.notebook-paper-wrap') as HTMLElement).style.transform).toBe('');
  fireEvent.pointerMove(svg, { ...pen, clientX: 90, clientY: 100 }); fireEvent.pointerUp(svg, pen);
  fireEvent.pointerUp(svg, finger(2, 300, 300));
  expect(onZoom).not.toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledTimes(1);
});
it('does not pinch when a finger lands right after the pen, nor with a palm contact', () => {
  const first = setupZoom();
  fireEvent.pointerDown(first.svg, pen); fireEvent.pointerUp(first.svg, pen);
  fireEvent.pointerDown(first.svg, finger(1, 100, 300)); fireEvent.pointerDown(first.svg, finger(2, 200, 300));
  fireEvent.pointerMove(first.svg, finger(2, 300, 300)); fireEvent.pointerUp(first.svg, finger(2, 300, 300));
  expect(first.onZoom).not.toHaveBeenCalled();
  cleanup();
  const palm = setupZoom();
  fireEvent.pointerDown(palm.svg, finger(1, 100, 300, { width: 80, height: 80 })); fireEvent.pointerDown(palm.svg, finger(2, 200, 300));
  fireEvent.pointerMove(palm.svg, finger(2, 300, 300)); fireEvent.pointerUp(palm.svg, finger(2, 300, 300));
  expect(palm.onZoom).not.toHaveBeenCalled();
});
it('does not start a pinch during an active pen stroke', () => {
  const { svg, onZoom } = setupZoom();
  fireEvent.pointerDown(svg, pen); fireEvent.pointerMove(svg, { ...pen, clientX: 60, clientY: 60 });
  fireEvent.pointerDown(svg, finger(1, 100, 300)); fireEvent.pointerDown(svg, finger(2, 200, 300));
  fireEvent.pointerMove(svg, finger(2, 300, 300)); fireEvent.pointerUp(svg, finger(2, 300, 300));
  expect(onZoom).not.toHaveBeenCalled();
});
it('keeps real finger ink when the second finger arrives but drops a tiny touch', () => {
  const { svg, onChange } = setupZoom({ finger: true });
  fireEvent.pointerDown(svg, finger(1, 50, 50));
  for (let i = 1; i <= 4; i++) fireEvent.pointerMove(svg, finger(1, 50 + i * 10, 50));
  fireEvent.pointerDown(svg, finger(2, 300, 300));
  expect(onChange).toHaveBeenCalledTimes(1);
  cleanup();
  const tiny = setupZoom({ finger: true });
  fireEvent.pointerDown(tiny.svg, finger(1, 50, 50)); fireEvent.pointerDown(tiny.svg, finger(2, 300, 300));
  expect(tiny.onChange).not.toHaveBeenCalled();
});
it('toggles with a double tap and ignores a slow or distant second tap', () => {
  vi.useFakeTimers();
  try {
    const { svg, onDoubleTap } = setupZoom();
    const tap = (id: number, x: number, y: number) => { fireEvent.pointerDown(svg, finger(id, x, y)); vi.advanceTimersByTime(80); fireEvent.pointerUp(svg, finger(id, x, y)); };
    tap(1, 100, 100); vi.advanceTimersByTime(100); tap(2, 105, 102);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onDoubleTap.mock.calls[0][0]).toMatchObject({ clientX: 105, clientY: 102 });
    tap(3, 100, 100); vi.advanceTimersByTime(500); tap(4, 100, 100); vi.advanceTimersByTime(1000);
    tap(5, 100, 100); vi.advanceTimersByTime(100); tap(6, 300, 300);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it('does not treat a double tap as zoom in the text tool', () => {
  const { svg, onDoubleTap } = setupZoom({ tool: 'text' });
  fireEvent.pointerDown(svg, finger(1, 100, 100)); fireEvent.pointerUp(svg, finger(1, 100, 100));
  fireEvent.pointerDown(svg, finger(2, 102, 100)); fireEvent.pointerUp(svg, finger(2, 102, 100));
  expect(onDoubleTap).not.toHaveBeenCalled();
});
it('creates a text box by touch even when finger drawing is off', () => {
  const { svg, onChange } = setupZoom({ tool: 'text' });
  fireEvent.pointerDown(svg, finger(1, 120, 140));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect((onChange.mock.calls[0][0] as NotebookSheet).texts[0]).toMatchObject({ x: 120, y: 140, text: '' });
  expect(onChange.mock.calls[0][1]).toEqual({ track: false });
});
it('removes a text box that is still empty when it loses focus, but keeps one with text', () => {
  const base = newNotebook().sheets[0];
  const box = { id: 't1', x: 10, y: 10, width: 200, text: '', color: '#24344b', fontSize: 20 };
  const { onChange } = (() => {
    const onChange = vi.fn<(sheet: NotebookSheet, o?: unknown) => boolean>(() => true);
    render(<NotebookCanvas sheet={{ ...base, texts: [box, { ...box, id: 't2', text: 'oi' }] }} tool="text" color="#24344b" width={2} fingerDrawing={false} zoom={1} locked={false} onChange={onChange} onLimit={vi.fn()} />);
    return { onChange };
  })();
  const [empty, filled] = screen.getAllByLabelText('Texto na folha');
  fireEvent.blur(filled); expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(empty);
  expect((onChange.mock.calls[0][0] as NotebookSheet).texts.map(t => t.id)).toEqual(['t2']);
  expect(onChange.mock.calls[0][1]).toEqual({ track: false });
});
it('erases while the S Pen side button is held, then goes back to the selected tool', () => {
  const ink = { id: 'a', tool: 'pen' as const, color: '#24344b', width: 2, points: [{ x: 100, y: 10, pressure: .5 }, { x: 100, y: 200, pressure: .5 }] };
  const sheet = { ...newNotebook().sheets[0], strokes: [ink] };
  const onChange = vi.fn<(sheet: NotebookSheet) => boolean>(() => true);
  render(<NotebookCanvas sheet={sheet} tool="pen" color="#24344b" width={2} fingerDrawing={false} zoom={1} locked={false} onChange={onChange} onLimit={vi.fn()} />);
  const svg = screen.getByRole('img');
  fireEvent.pointerDown(svg, { ...pen, buttons: 3, clientX: 100, clientY: 100 }); fireEvent.pointerUp(svg, pen);
  expect((onChange.mock.calls[0][0] as NotebookSheet).strokes).toEqual([]);
  fireEvent.pointerDown(svg, { ...pen, buttons: 1, clientX: 300, clientY: 300 });
  fireEvent.pointerMove(svg, { ...pen, buttons: 1, clientX: 340, clientY: 340 }); fireEvent.pointerUp(svg, pen);
  expect((onChange.mock.calls[1][0] as NotebookSheet).strokes).toHaveLength(2);
});
