import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '../../types';

const state = vi.hoisted(() => ({ changed: undefined as undefined | (() => void), mounted: undefined as undefined | ((editor: unknown) => void) }));
vi.mock('tldraw', () => ({
  Tldraw: ({ onMount }: { onMount?: (editor: unknown) => void }) => { state.mounted = onMount; return <div data-testid="tldraw" />; },
  createTLStore: () => ({ clear: vi.fn(), listen: (fn: () => void) => { state.changed = fn; return () => undefined; } }),
  createShapeId: () => 'shape:card',
  defaultShapeUtils: [],
  ShapeUtil: class {}, HTMLContainer: 'div', Rectangle2d: class {}, T: { number: {}, string: {} }, resizeBox: vi.fn(),
  throttle: () => () => undefined,
  getSnapshot: () => ({}),
  loadSnapshot: vi.fn(),
}));
vi.mock('tldraw/tldraw.css', () => ({}));
vi.mock('../../api/client', () => ({ api: { patchPage: vi.fn().mockResolvedValue({}) } }));

import { InfiniteRenderer } from './InfiniteRenderer';
import { api } from '../../api/client';

const page = {
  id: 'p1',
  title: 'Quadro',
  type: 'infinite',
  content: { tldraw: true, version: 1, data: null },
} as unknown as Page;

afterEach(() => cleanup());

describe('InfiniteRenderer status pill', () => {
  it('stays clear of the tldraw watermark (bottom-right) and does not capture pointer events', async () => {
    render(<InfiniteRenderer page={page} />);
    const wrapper = await screen.findByTestId('infinite-save-status');

    // Desktop: left of the watermark. Mobile: above the bottom toolbar.
    expect(wrapper.className).toContain('md:right-32');
    expect(wrapper.className).toContain('bottom-16');
    expect(wrapper.className).toContain('pointer-events-none');
  });

  it('exposes the save state as a polite live status using theme colors', async () => {
    render(<InfiniteRenderer page={page} />);
    const status = await screen.findByRole('status');

    expect(status).toHaveTextContent('Infinite');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.getAttribute('style')).toContain('var(--theme-card)');
    expect(status.getAttribute('style')).toContain('var(--theme-text)');
  });
});


it('flushes a change during debounce with revision-aware keepalive and retains failed work', async () => {
  vi.mocked(api.patchPage).mockClear();
  vi.mocked(api.patchPage).mockRejectedValueOnce(new Error('API 409: conflict'));
  render(<InfiniteRenderer page={page} />);
  await screen.findByRole('status');
  act(() => { state.changed?.(); window.dispatchEvent(new Event('pagehide')); });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Erro ao salvar'));
  expect(api.patchPage).toHaveBeenLastCalledWith('p1', expect.objectContaining({ content: expect.any(Object) }), { keepalive: true });
  vi.mocked(api.patchPage).mockResolvedValueOnce(page);
  act(() => window.dispatchEvent(new Event('pagehide')));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
  expect(api.patchPage).toHaveBeenCalledTimes(2);
});

it('keeps Design separate from Infinite and creates an exportable artboard', async () => {
  const shapes: Array<{ id: string; type: string; x: number; props: { name: string; w: number; h: number } }> = [];
  const editor = {
    getCurrentPageShapes: vi.fn(() => shapes),
    getSelectedShapeIds: vi.fn(() => []),
    getCurrentPageId: vi.fn(() => 'page:one'),
    getPages: vi.fn(() => [{ id: 'page:one', name: 'Página 1' }]),
    store: { listen: vi.fn(() => () => undefined) },
    user: { getUserPreferences: vi.fn(() => ({ isSnapMode: false })), updateUserPreferences: vi.fn() },
    getInstanceState: vi.fn(() => ({ isGridMode: false })),
    updateInstanceState: vi.fn(),
    getShape: vi.fn((id: string) => shapes.find(shape => shape.id === id)),
    createShape: vi.fn((shape: { type: string; x: number; props: { name: string; w: number; h: number } }) => { shapes.push({ ...shape, id: 'shape:post' }); }),
    zoomToFit: vi.fn(), select: vi.fn(), zoomToSelection: vi.fn(),
    toImage: vi.fn().mockResolvedValue({ blob: new Blob(['png'], { type: 'image/png' }) }),
  };
  const oldCreateUrl = URL.createObjectURL, oldRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn().mockReturnValue('blob:preview');
  URL.revokeObjectURL = vi.fn();
  render(<InfiniteRenderer page={{ ...page, type: 'design' }} />);
  await screen.findByRole('status');
  act(() => state.mounted?.(editor));
  fireEvent.click(screen.getByRole('button', { name: '+ Post quadrado' }));
  expect(editor.createShape).toHaveBeenCalledWith(expect.objectContaining({ type: 'frame', props: expect.objectContaining({ w: 1080, h: 1080 }) }));
  fireEvent.click(screen.getByRole('button', { name: '+ Cartão' }));
  expect(editor.createShape).toHaveBeenCalledWith(expect.objectContaining({ id: 'shape:card', type: 'design-card', props: expect.objectContaining({ radius: 16 }) }));
  expect(screen.getByRole('button', { name: /Post quadrado 1/ })).toBeInTheDocument();
  fireEvent.click(within(screen.getByLabelText('Ferramentas de Design')).getByRole('button', { name: 'Prévia' }));
  expect(await screen.findByRole('dialog', { name: 'Prévia do quadro' })).toBeInTheDocument();
  expect(editor.toImage).toHaveBeenCalledWith(['shape:post'], expect.objectContaining({ format: 'png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  URL.createObjectURL = oldCreateUrl; URL.revokeObjectURL = oldRevokeUrl;
});

it('does not replace an invalid Design document with an empty canvas', async () => {
  vi.mocked(api.patchPage).mockClear();
  render(<InfiniteRenderer page={{ ...page, type: 'design', content: { type: 'doc', content: [] } as never }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('conteúdo original foi preservado');
  expect(api.patchPage).not.toHaveBeenCalled();
});
