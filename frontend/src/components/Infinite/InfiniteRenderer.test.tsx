import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '../../types';

const state = vi.hoisted(() => ({ changed: undefined as undefined | (() => void) }));
vi.mock('tldraw', () => ({
  Tldraw: () => <div data-testid="tldraw" />,
  createTLStore: () => ({ clear: vi.fn(), listen: (fn: () => void) => { state.changed = fn; return () => undefined; } }),
  defaultShapeUtils: [],
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
