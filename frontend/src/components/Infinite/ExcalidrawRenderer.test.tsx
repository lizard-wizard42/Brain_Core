import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '../../types';

const scene = vi.hoisted(() => ({ change: undefined as undefined | ((elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void) }));
vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: ({ onChange }: { onChange: typeof scene.change }) => {
  scene.change = onChange;
  return <div data-testid="excalidraw" />;
} }));
vi.mock('@excalidraw/excalidraw/index.css', () => ({}));
vi.mock('../../api/client', () => ({ api: { patchPage: vi.fn() } }));

import { api } from '../../api/client';
import { ExcalidrawRenderer } from './ExcalidrawRenderer';

const page = { id: 'synthetic-page', title: 'Fictional canvas', type: 'infinite', revision: 1,
  content: { excalidraw: true, version: 1, data: { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} } } } as unknown as Page;

beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.patchPage).mockReset().mockResolvedValue({ ...page, revision: 2 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Excalidraw Infinite', () => {
  it('keeps legacy and unknown content intact in read-only mode', () => {
    const legacy = { ...page, content: { tldraw: true, version: 1, data: { document: {} } } } as Page;
    render(<ExcalidrawRenderer page={legacy} />);
    expect(screen.getByRole('alert')).toHaveTextContent('conteúdo original foi preservado');
    expect(screen.queryByTestId('excalidraw')).not.toBeInTheDocument();
    expect(api.patchPage).not.toHaveBeenCalled();
  });

  it('ignores camera changes but saves shape edits with a page revision', async () => {
    render(<ExcalidrawRenderer page={page} />);
    act(() => scene.change?.([], { viewBackgroundColor: '#ffffff', scrollX: 42, zoom: { value: 2 } }, {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(api.patchPage).not.toHaveBeenCalled();

    act(() => scene.change?.([{ id: 'fake-rect', type: 'rectangle', version: 1 }], { viewBackgroundColor: '#ffffff' }, {}));
    expect(screen.getByRole('status')).toHaveTextContent('pendentes');
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(api.patchPage).toHaveBeenCalledExactlyOnceWith('synthetic-page', {
      revision: 1,
      content: { excalidraw: true, version: 1, data: {
        elements: [{ id: 'fake-rect', type: 'rectangle', version: 1 }],
        appState: { viewBackgroundColor: '#ffffff' }, files: {},
      } },
    }, { keepalive: false });
    expect(screen.getByRole('status')).toHaveTextContent('Salvo');
  });

  it('preserves unsaved work after a revision conflict and offers an export', async () => {
    vi.mocked(api.patchPage).mockRejectedValueOnce(new Error('API 409'));
    const originalCreateUrl = URL.createObjectURL, originalRevokeUrl = URL.revokeObjectURL;
    const createUrl = vi.fn().mockReturnValue('blob:fictional-draft');
    const revokeUrl = vi.fn();
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    render(<ExcalidrawRenderer page={page} />);
    act(() => scene.change?.([{ id: 'fake-rect', type: 'rectangle', version: 1 }], { viewBackgroundColor: '#ffffff' }, {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(screen.getByRole('status')).toHaveTextContent('Outra versão foi salva');
    fireEvent.click(screen.getByRole('button', { name: 'Baixar rascunho' }));
    expect(createUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledOnce();
    expect(api.patchPage).toHaveBeenCalledTimes(1);
    URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl;
  });
});
