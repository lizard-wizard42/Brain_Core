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

function renderSection() {
  return render(
    <SharedPagesProvider>
      <SharedSection />
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
