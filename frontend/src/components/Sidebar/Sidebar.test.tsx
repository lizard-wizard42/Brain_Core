import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { api } from '../../api/client';
import type { Page, TreePage } from '../../types';

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
  ] satisfies TreePage[];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('ordena Notas, Conhecimento, árvore e Compartilhados após Linha do tempo', () => {
    render(<Sidebar tree={baseTree} activePage={null} onRefresh={onRefresh} />);
    const labels = ['Linha do tempo', '📝 Notas', 'Conhecimento', 'Página Original', 'Compartilhados'];
    const nodes = labels.map((label) => screen.getByText(label));
    for (let index = 1; index < nodes.length; index++) {
      expect(nodes[index - 1].compareDocumentPosition(nodes[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('abre o Dashboard pelo cabeçalho e fecha a árvore', () => {
    const onClose = vi.fn();
    render(<Sidebar tree={[]} activePage={null} onRefresh={onRefresh} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Brain Core: abrir Dashboard' }));

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('mostra um único acesso a configurações na árvore do Android', () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${original} BrainCoreAndroid/1` });
    try {
      render(<Sidebar tree={[]} activePage={null} onRefresh={onRefresh} />);
      expect(screen.getByRole('button', { name: 'Abrir configurações' })).toBeInTheDocument();
      expect(screen.queryByText('Ajustes do aparelho')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original });
    }
  });

  it('abre e fecha abas do desktop pela árvore móvel', () => {
    const onTabClick = vi.fn();
    const onTabClose = vi.fn();
    const onCloseAllTabs = vi.fn();
    const onClose = vi.fn();
    render(<Sidebar tree={[]} activePage={null} onRefresh={onRefresh} onClose={onClose}
      tabs={[{ id: 'tab-1', title: 'Minha página', path: '/page/1' }]}
      activeTabId="tab-1" onTabClick={onTabClick} onTabClose={onTabClose} onCloseAllTabs={onCloseAllTabs} />);
    fireEvent.click(screen.getByText('Abas abertas (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Minha página' }));
    expect(onTabClick).toHaveBeenCalledWith('tab-1');
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Minha página' }));
    expect(onTabClose).toHaveBeenCalledWith('tab-1');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar todas' }));
    expect(onCloseAllTabs).toHaveBeenCalledOnce();
  });

  it('cria página tipo nota a partir do rodapé', async () => {
    vi.mocked(api.createPage).mockResolvedValueOnce({ id: 'p-note', title: 'Minha Nota', icon: null } as Page);
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
    vi.mocked(api.createPage).mockResolvedValueOnce({ id: 'p-inf', title: 'Tela Infinita', icon: null } as Page);
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
    vi.mocked(api.renamePage).mockResolvedValueOnce({} as Page);

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
    vi.mocked(api.deletePage).mockResolvedValueOnce({ deleted: true });

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
