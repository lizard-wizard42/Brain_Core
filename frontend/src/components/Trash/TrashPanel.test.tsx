import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashPanel } from './TrashPanel';
import { api } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: {
    getTrash: vi.fn(),
    restorePage: vi.fn(),
    permanentDeletePage: vi.fn(),
    emptyTrash: vi.fn(),
  },
}));

describe('TrashPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads items and restores one item', async () => {
    vi.mocked(api.getTrash)
      .mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(api.restorePage).mockResolvedValueOnce({} as never);

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<TrashPanel onClose={vi.fn()} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByText('Page 1')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Restaurar'));

    await waitFor(() => expect(api.restorePage).toHaveBeenCalledWith('p1'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('confirms and empties trash', async () => {
    vi.mocked(api.getTrash)
      .mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(api.emptyTrash).mockResolvedValueOnce({ deleted: true } as never);

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<TrashPanel onClose={vi.fn()} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByText('Esvaziar lixeira')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Esvaziar lixeira'));
    fireEvent.click(screen.getByText('Confirmar'));

    await waitFor(() => expect(api.emptyTrash).toHaveBeenCalled());
    expect(onRefresh).toHaveBeenCalled();
  });

  it('deletes one item permanently', async () => {
    vi.mocked(api.getTrash)
      .mockResolvedValueOnce([{ id: 'p9', title: 'Page 9', icon: '📄' }] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(api.permanentDeletePage).mockResolvedValueOnce({ deleted: true } as never);

    render(<TrashPanel onClose={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(screen.getByText('Page 9')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Apagar definitivamente'));

    await waitFor(() => expect(api.permanentDeletePage).toHaveBeenCalledWith('p9'));
  });

  it('keeps the item and shows an error when restore fails', async () => {
    vi.mocked(api.getTrash).mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as never);
    vi.mocked(api.restorePage).mockRejectedValueOnce(new Error('offline'));

    render(<TrashPanel onClose={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(await screen.findByTitle('Restaurar'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível restaurar');
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('closes panel on Escape key', async () => {
    vi.mocked(api.getTrash).mockResolvedValueOnce([] as never);
    const onClose = vi.fn();

    render(<TrashPanel onClose={onClose} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('opens and cancels empty-trash confirmation', async () => {
    vi.mocked(api.getTrash).mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as never);

    render(<TrashPanel onClose={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(screen.getByText('Esvaziar lixeira')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Esvaziar lixeira'));
    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText('Confirmar')).not.toBeInTheDocument();
    expect(api.emptyTrash).not.toHaveBeenCalled();
  });
});
