import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { api } from '../../api/client';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock('../../api/client', () => ({
  api: {
    createPage: vi.fn(),
    patchPage: vi.fn(),
    renamePage: vi.fn(),
    deletePage: vi.fn(),
    getTrash: vi.fn(),
    restorePage: vi.fn(),
    permanentDeletePage: vi.fn(),
    emptyTrash: vi.fn(),
  },
}));

describe('Sidebar', () => {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const baseTree = [
    {
      id: 'page-1',
      title: 'Página Original',
      slug: 'pagina-original',
      type: 'note',
      sort_order: 0,
      updated_at: '2026-05-01T00:00:00.000Z',
      children: [],
    },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('cria página tipo nota a partir do rodapé', async () => {
    vi.mocked(api.createPage).mockResolvedValueOnce({ id: 'p-note', title: 'Minha Nota', icon: null } as any);
    const onPageClick = vi.fn();

    render(
      <Sidebar
        tree={[]}
        activePage={null}
        onRefresh={onRefresh}
        onPageClick={onPageClick}
      />,
    );

    fireEvent.click(screen.getByText('+ Nova página'));
    fireEvent.change(screen.getByPlaceholderText('Título da página…'), { target: { value: 'Minha Nota' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nota' }));

    await waitFor(() => expect(api.createPage).toHaveBeenCalled());
    expect(api.createPage).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Minha Nota', type: 'note' }),
    );
    expect(onPageClick).toHaveBeenCalled();
  });

  it('cria página tipo infinite', async () => {
    vi.mocked(api.createPage).mockResolvedValueOnce({ id: 'p-inf', title: 'Tela Infinita', icon: null } as any);
    const onPageClick = vi.fn();

    render(
      <Sidebar
        tree={[]}
        activePage={null}
        onRefresh={onRefresh}
        onPageClick={onPageClick}
      />,
    );

    fireEvent.click(screen.getByText('+ Nova página'));
    fireEvent.change(screen.getByPlaceholderText('Título da página…'), { target: { value: 'Tela Infinita' } });
    fireEvent.click(screen.getByRole('button', { name: 'Infinite' }));

    await waitFor(() => expect(api.createPage).toHaveBeenCalled());
    expect(api.createPage).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tela Infinita', type: 'infinite' }),
    );
  });

  it('renomeia página existente', async () => {
    vi.mocked(api.renamePage).mockResolvedValueOnce({} as any);

    render(
      <Sidebar
        tree={baseTree}
        activePage={null}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTitle('Renomear'));
    const input = screen.getByDisplayValue('Página Original');
    fireEvent.change(input, { target: { value: 'Página Renomeada' } });
    fireEvent.blur(input);

    await waitFor(() => expect(api.renamePage).toHaveBeenCalledWith('page-1', 'Página Renomeada'));
  });

  it('apaga página com confirmação', async () => {
    vi.mocked(api.deletePage).mockResolvedValueOnce({ deleted: true } as any);

    render(
      <Sidebar
        tree={baseTree}
        activePage={null}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTitle('Apagar'));
    const confirmButton = screen.getByRole('button', { name: 'Apagar' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(api.deletePage).toHaveBeenCalledWith('page-1'));
  });
});
