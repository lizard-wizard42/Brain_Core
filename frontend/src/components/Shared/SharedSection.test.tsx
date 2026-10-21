import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedSection } from './SharedSection';
import { SharedPagesProvider } from './SharedPagesProvider';
import { api } from '../../api/client';
import type { PageGrant, SharedPageSummary } from '../../types';

vi.mock('../../api/client', () => ({
  api: {
    getSharedPages: vi.fn(),
    getPageGrants: vi.fn(),
    setPageGrant: vi.fn(),
    removePageGrant: vi.fn(),
    listContacts: vi.fn().mockResolvedValue({ contacts: [], incoming: [], outgoing: [] }),
    getSubPages: vi.fn().mockResolvedValue([]),
  },
}));

function shared(id: string, title: string, role: SharedPageSummary['role']): SharedPageSummary {
  return {
    id,
    title,
    slug: title.toLowerCase(),
    type: 'note',
    updated_at: '2026-09-25T12:00:00.000Z',
    role,
    last_editor: 'Pessoa Fictícia',
    last_edited_at: '2026-09-25T12:30:00.000Z',
  };
}

const received = [shared('r1', 'Planta da casa', 'viewer')];
const sent = [shared('s1', 'Orçamento da reforma', 'owner'), shared('r1', 'Duplicada', 'owner')];

function renderSection(props: React.ComponentProps<typeof SharedSection> = {}) {
  return render(
    <SharedPagesProvider>
      <SharedSection {...props} />
    </SharedPagesProvider>,
  );
}

describe('SharedSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSharedPages).mockImplementation(async (scope) => (scope === 'sent' ? sent : received));
    vi.mocked(api.getPageGrants).mockResolvedValue([] as PageGrant[]);
  });

  afterEach(() => {
    cleanup();
  });

  it('lists received and sent without duplication', async () => {
    renderSection();

    expect(await screen.findByText('Planta da casa')).toBeInTheDocument();
    expect(screen.getByText('Orçamento da reforma')).toBeInTheDocument();
    expect(screen.queryByText('Duplicada')).not.toBeInTheDocument();
    expect(screen.getByText('Compartilhadas comigo')).toBeInTheDocument();
    expect(screen.getByText('Compartilhadas por mim')).toBeInTheDocument();
  });

  it('filters shared pages by search and shows a clear empty result', async () => {
    renderSection();
    await screen.findByText('Planta da casa');

    fireEvent.change(screen.getByLabelText('Buscar páginas compartilhadas'), { target: { value: 'orçamento' } });
    expect(screen.getByText('Orçamento da reforma')).toBeInTheDocument();
    expect(screen.queryByText('Planta da casa')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Buscar páginas compartilhadas'), { target: { value: 'inexistente' } });
    expect(screen.getByText('Nada encontrado em Compartilhados.')).toBeInTheDocument();
  });

  it('clears search without leaving the field and keeps the shared section collapsible', async () => {
    renderSection();
    await screen.findByText('Planta da casa');
    const search = screen.getByLabelText('Buscar páginas compartilhadas');
    fireEvent.change(search, { target: { value: 'orçamento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca de compartilhados' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.getByText('Planta da casa')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Compartilhados/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Buscar páginas compartilhadas')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Planta da casa')).toBeInTheDocument();
  });

  it('opens the selected page and exposes management only for its owner', async () => {
    const onOpenPage = vi.fn();
    renderSection({ activePage: 'r1', onOpenPage });
    await screen.findByText('Planta da casa');
    const open = screen.getByRole('button', { name: /Planta da casa/ });
    expect(open).toHaveAttribute('aria-current', 'page');
    expect(open).toHaveAttribute('title', 'Planta da casa');
    fireEvent.click(open);
    expect(onOpenPage).toHaveBeenCalledWith(received[0]);
    expect(screen.queryByRole('button', { name: 'Gerenciar acesso a Planta da casa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerenciar acesso a Orçamento da reforma' })).toBeVisible();
    expect(api.setPageGrant).not.toHaveBeenCalled();
    expect(api.removePageGrant).not.toHaveBeenCalled();
  });

  it('keeps a received-scope failure visible when sent pages load', async () => {
    vi.mocked(api.getSharedPages).mockImplementation(async (scope) => {
      if (scope === 'received') throw new Error('offline');
      return [sent[0]];
    });
    renderSection();
    expect(await screen.findByText('Orçamento da reforma')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar os compartilhados')).toBeInTheDocument();
  });

  it('shows understandable empty states when nothing is shared', async () => {
    vi.mocked(api.getSharedPages).mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText('Nada compartilhado com você ainda.')).toBeInTheDocument();
    expect(screen.getByText('Você ainda não compartilhou nenhuma página.')).toBeInTheDocument();
  });

  it('opens the access manager for a page shared by me', async () => {
    renderSection();
    await screen.findByText('Orçamento da reforma');

    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar acesso a Orçamento da reforma' }));

    expect(await screen.findByRole('dialog', { name: /Gerenciar acesso a Orçamento da reforma/ })).toBeInTheDocument();
    await waitFor(() => expect(api.getPageGrants).toHaveBeenCalledWith('s1'));
  });
});
