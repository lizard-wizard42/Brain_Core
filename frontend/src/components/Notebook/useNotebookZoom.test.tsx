import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotebookZoom } from './useNotebookZoom';

type Api = ReturnType<typeof useNotebookZoom>;
let api: Api;
// The paper sits 100 px from the left of a 500x700 workspace at the origin and scales with the zoom.
function Harness({ pageId = 'page-a' }: { pageId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const current = useNotebookZoom(ref, pageId);
  useEffect(() => { api = current; });
  return <div ref={ref} data-testid="workspace"><div className="notebook-paper-wrap" style={{ width: `${current.zoom * 800}px` }} /></div>;
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('notebook-paper-wrap')) {
      const width = parseFloat(this.style.width), parent = this.parentElement!;
      return { left: 100 - parent.scrollLeft, top: 50 - parent.scrollTop, width, height: width * 1.4, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    }
    return { left: 0, top: 0, width: 500, height: 700, right: 500, bottom: 700, x: 0, y: 0, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth; delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight; });

describe('useNotebookZoom', () => {
  it('opens fitted to the workspace width and keeps fitting until the user zooms', () => {
    render(<Harness />);
    expect(api.zoom).toBeCloseTo(460 / 800, 5);
  });
  it('clamps the zoom to the limits and uses multiplicative steps', () => {
    render(<Harness />);
    act(() => api.zoomTo(50)); expect(api.zoom).toBe(3);
    act(() => api.zoomTo(0.001)); expect(api.zoom).toBe(.25);
    act(() => api.zoomTo(1)); act(() => api.zoomBy(1.2)); expect(api.zoom).toBeCloseTo(1.2, 5);
  });
  it('remembers a manual zoom per notebook and forgets it when fitting', () => {
    const first = render(<Harness />);
    act(() => api.zoomTo(1.5));
    expect(localStorage.getItem('nb-zoom:page-a')).toBe('1.5');
    first.unmount();
    render(<Harness />);
    expect(api.zoom).toBe(1.5);
    act(() => api.fit());
    expect(localStorage.getItem('nb-zoom:page-a')).toBeNull();
    expect(api.zoom).toBeCloseTo(460 / 800, 5);
  });
  it('ignores a damaged stored value and survives a storage that throws', () => {
    localStorage.setItem('nb-zoom:page-a', 'abc');
    const first = render(<Harness />);
    expect(api.zoom).toBeCloseTo(460 / 800, 5);
    first.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<Harness />);
    expect(() => act(() => api.zoomTo(2))).not.toThrow();
    expect(api.zoom).toBe(2);
  });
  it('keeps the content point under the focal fixed by compensating the scroll', () => {
    const { getByTestId } = render(<Harness />);
    const workspace = getByTestId('workspace');
    act(() => api.zoomTo(1));
    workspace.scrollLeft = 0; workspace.scrollTop = 0;
    // Content point under the focal: u=(300-100)/800=.25 of the sheet width, v=(250-50)/1120=.1786 of its height.
    act(() => api.zoomTo(2, { clientX: 300, clientY: 250 }));
    // New rect: left=100-scrollLeft, width=1600 -> point at 100+.25*1600-scrollLeft must equal 300.
    expect(workspace.scrollLeft).toBeCloseTo(200, 3);
    expect(workspace.scrollTop).toBeCloseTo(0.1786 * 2240 - 200, 0);
  });
  it('moves the content point from where it was to where the fingers ended', () => {
    const { getByTestId } = render(<Harness />);
    const workspace = getByTestId('workspace');
    act(() => api.zoomTo(1));
    workspace.scrollLeft = 0;
    act(() => api.zoomTo(2, { clientX: 260, clientY: 250, fromX: 300, fromY: 250 }));
    expect(100 - workspace.scrollLeft + .25 * 1600).toBeCloseTo(260, 3);
  });
  it('zooms with Ctrl+wheel around the cursor and blocks the browser page zoom', () => {
    const { getByTestId } = render(<Harness />);
    act(() => api.zoomTo(1));
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: 200, clientY: 200, cancelable: true, bubbles: true });
    act(() => { getByTestId('workspace').dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(api.zoom).toBeCloseTo(Math.exp(.15), 4);
    const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    act(() => { getByTestId('workspace').dispatchEvent(plain); });
    expect(plain.defaultPrevented).toBe(false);
  });
  it('handles Ctrl +, - and 0 but not while typing in a field', () => {
    render(<><Harness /><input aria-label="campo" /></>);
    act(() => api.zoomTo(1));
    fireEvent.keyDown(window, { key: '=', ctrlKey: true }); expect(api.zoom).toBeCloseTo(1.2, 5);
    fireEvent.keyDown(window, { key: '-', ctrlKey: true }); expect(api.zoom).toBeCloseTo(1, 5);
    fireEvent.keyDown(window, { key: '0', ctrlKey: true }); expect(api.zoom).toBeCloseTo(460 / 800, 5);
    const typed = fireEvent.keyDown(document.querySelector('input')!, { key: '=', ctrlKey: true });
    expect(typed).toBe(true); expect(api.zoom).toBeCloseTo(460 / 800, 5);
  });
  it('toggles between fit and 100% for the double tap', () => {
    render(<Harness />);
    act(() => api.toggleFit()); expect(api.zoom).toBe(1);
    act(() => api.toggleFit()); expect(api.zoom).toBeCloseTo(460 / 800, 5);
  });
});
