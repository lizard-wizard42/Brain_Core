import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareManagerModal } from './ShareManagerModal';
import { api } from '../../api/client';
import type { PageGrant } from '../../types';

vi.mock('../../api/client', () => ({
  api: {
    getPageGrants: vi.fn(),
    setPageGrant: vi.fn(),
    removePageGrant: vi.fn(),
    listContacts: vi.fn(),
    getSubPages: vi.fn(),
  },
}));

const grants: PageGrant[] = [
  { user_id: '11111111-1111-1111-1111-111111111111', name: 'Pessoa Leitora', role: 'viewer', granted_at: '2026-09-25T12:00:00.000Z' },
  { user_id: '22222222-2222-2222-2222-222222222222', email: 'editor@example.test', role: 'editor' },
];

const contactLists = {
  contacts: [
    { id: '33333333-3333-3333-3333-333333333333', name: 'Ana Contato', email: 'ana@example.test' },
    { id: '44444444-4444-4444-4444-444444444444', name: null, email: 'bruno@example.test' },
    // Já tem acesso concedido: não deve voltar a aparecer no seletor.
    { id: '11111111-1111-1111-1111-111111111111', name: 'Pessoa Leitora', email: 'leitora@example.test' },
  ],
  incoming: [],
  outgoing: [],
};

describe('ShareManagerModal', () => {
  const onClose = vi.fn();
  const onChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPageGrants).mockResolvedValue(grants);
    vi.mocked(api.setPageGrant).mockResolvedValue({ user_id: grants[0].user_id, role: 'editor' });
    vi.mocked(api.removePageGrant).mockResolvedValue({ revoked: true });
    vi.mocked(api.listContacts).mockResolvedValue(contactLists);
    vi.mocked(api.getSubPages).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  function renderModal() {
    return render(
      <ShareManagerModal pageId="page-1" pageTitle="Página fictícia" onClose={onClose} onChanged={onChanged} />,
    );
  }

  it('lists people and their access levels', async () => {
    renderModal();
    expect(await screen.findByText('Pessoa Leitora')).toBeInTheDocument();
    expect(screen.getByText('editor@example.test')).toBeInTheDocument();
    expect(screen.getAllByText('Pode ler').length).toBeGreaterThan(0);
  });

  it('changes the role of an existing person', async () => {
    renderModal();
    const select = await screen.findByLabelText('Nível de acesso de Pessoa Leitora');
    fireEvent.change(select, { target: { value: 'editor' } });

    await waitFor(() => expect(api.setPageGrant).toHaveBeenCalledWith('page-1', grants[0].user_id, 'editor'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('revokes access from a person', async () => {
    renderModal();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remover' }))[0]);

    await waitFor(() => expect(api.removePageGrant).toHaveBeenCalledWith('page-1', grants[0].user_id));
  });

  it('offers accepted contacts as share targets, excluding people who already have access', async () => {
    renderModal();
    expect(await screen.findByText('Ana Contato')).toBeInTheDocument();
    // Bruno não tem nome: e-mail aparece como nome e subtítulo.
    expect(screen.getAllByText('bruno@example.test').length).toBeGreaterThan(0);
    // Quem já tem acesso aparece só na lista de acessos, não no seletor de contatos.
    expect(screen.queryByText('leitora@example.test')).not.toBeInTheDocument();
  });

  it('searches contacts by name or e-mail before sharing', async () => {
    renderModal();
    await screen.findByText('Ana Contato');
    fireEvent.change(screen.getByLabelText('Buscar contato por nome ou e-mail'), { target: { value: 'bruno' } });

    expect(screen.queryByText('Ana Contato')).not.toBeInTheDocument();
    expect(screen.getAllByText('bruno@example.test').length).toBeGreaterThan(0);
  });

  it('shares the page with a contact using the selected access level', async () => {
    renderModal();
    await screen.findByText('Ana Contato');
    fireEvent.change(screen.getByLabelText('Nível de acesso a conceder'), { target: { value: 'editor' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Compartilhar' })[0]);

    await waitFor(() => expect(api.setPageGrant).toHaveBeenCalledWith('page-1', contactLists.contacts[0].id, 'editor'));
  });

  it('explains how to add contacts when none are accepted yet', async () => {
    vi.mocked(api.listContacts).mockResolvedValue({ contacts: [], incoming: [], outgoing: [] });
    renderModal();
    expect(await screen.findByText(/Nenhum contato disponível/)).toBeInTheDocument();
  });

  it('mentions subpages when sharing a folder', async () => {
    vi.mocked(api.getSubPages).mockResolvedValue([
      { id: 'sub-1' },
      { id: 'sub-2' },
    ] as never);
    renderModal();
    expect(await screen.findByText(/2 subpágina/)).toBeInTheDocument();
  });

  it('shows an empty state when nobody has access yet', async () => {
    vi.mocked(api.getPageGrants).mockResolvedValue([]);
    renderModal();
    expect(await screen.findByText('Esta página ainda não está compartilhada com ninguém.')).toBeInTheDocument();
  });
});