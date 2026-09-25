import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('loads items and restores one item', async () => {
    vi.mocked(api.getTrash)
      .mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as any)
      .mockResolvedValueOnce([] as any);
    vi.mocked(api.restorePage).mockResolvedValueOnce({} as any);

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<TrashPanel onClose={vi.fn()} onRefresh={onRefresh} />);

    await waitFor(() => expect(screen.getByText('Page 1')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Restaurar'));

    await waitFor(() => expect(api.restorePage).toHaveBeenCalledWith('p1'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('confirms and empties trash', async () => {
    vi.mocked(api.getTrash)
      .mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as any)
      .mockResolvedValueOnce([] as any);
    vi.mocked(api.emptyTrash).mockResolvedValueOnce({ deleted: true } as any);

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
      .mockResolvedValueOnce([{ id: 'p9', title: 'Page 9', icon: '📄' }] as any)
      .mockResolvedValueOnce([] as any);
    vi.mocked(api.permanentDeletePage).mockResolvedValueOnce({ deleted: true } as any);

    render(<TrashPanel onClose={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(screen.getByText('Page 9')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Apagar definitivamente'));

    await waitFor(() => expect(api.permanentDeletePage).toHaveBeenCalledWith('p9'));
  });

  it('closes panel on Escape key', async () => {
    vi.mocked(api.getTrash).mockResolvedValueOnce([] as any);
    const onClose = vi.fn();

    render(<TrashPanel onClose={onClose} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('opens and cancels empty-trash confirmation', async () => {
    vi.mocked(api.getTrash).mockResolvedValueOnce([{ id: 'p1', title: 'Page 1', icon: '📄' }] as any);

    render(<TrashPanel onClose={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(screen.getByText('Esvaziar lixeira')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Esvaziar lixeira'));
    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText('Confirmar')).not.toBeInTheDocument();
    expect(api.emptyTrash).not.toHaveBeenCalled();
  });
});
