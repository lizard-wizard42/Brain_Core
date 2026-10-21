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
