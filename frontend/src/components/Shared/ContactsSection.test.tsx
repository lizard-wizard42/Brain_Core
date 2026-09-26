import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsSection } from './ContactsSection';
import { apiErrorMessage, contactDisplayName } from './sharedModel';
import { api } from '../../api/client';
import type { ContactLists } from '../../types';

vi.mock('../../api/client', () => ({
  api: {
    listContacts: vi.fn(),
    requestContact: vi.fn(),
    acceptContact: vi.fn(),
    removeContact: vi.fn(),
  },
}));

const lists: ContactLists = {
  contacts: [{ id: 'contact-1', name: 'Ana', email: 'ana@example.test' }],
  incoming: [{ id: 'incoming-1', name: null, email: 'bruno@example.test' }],
  outgoing: [{ id: 'outgoing-1', name: 'Carla', email: 'carla@example.test' }],
};

describe('ContactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listContacts).mockResolvedValue(lists);
    vi.mocked(api.requestContact).mockResolvedValue(lists.contacts[0]);
    vi.mocked(api.acceptContact).mockResolvedValue({ accepted: true });
    vi.mocked(api.removeContact).mockResolvedValue({ removed: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows accepted contacts, incoming and outgoing requests', async () => {
    render(<ContactsSection />);
    // Bruno não tem nome: e-mail aparece como nome e subtítulo.
    expect((await screen.findAllByText('bruno@example.test')).length).toBeGreaterThan(0);
    expect(screen.getByText('Carla')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('ana@example.test')).toBeInTheDocument();
  });

  it('sends a friend request by e-mail', async () => {
    vi.mocked(api.requestContact).mockResolvedValue({ id: 'x', name: null, email: 'nova@example.test' });
    render(<ContactsSection />);
    await screen.findByText('Ana');
    fireEvent.change(screen.getByLabelText('E-mail da pessoa cadastrada'), { target: { value: 'Nova@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    await waitFor(() => expect(api.requestContact).toHaveBeenCalledWith('nova@example.test'));
    expect(await screen.findByRole('status')).toHaveTextContent('Pedido enviado');
  });

  it('rejects invalid e-mails without calling the backend', async () => {
    render(<ContactsSection />);
    await screen.findByText('Ana');
    fireEvent.change(screen.getByLabelText('E-mail da pessoa cadastrada'), { target: { value: 'invalido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um e-mail válido.');
    expect(api.requestContact).not.toHaveBeenCalled();
  });

  it('surfaces the backend message when the e-mail has no registered account', async () => {
    vi.mocked(api.requestContact).mockRejectedValue(new Error('API 404: {"error":"Não há conta cadastrada com este e-mail no Brain Core."}'));
    render(<ContactsSection />);
    await screen.findByText('Ana');
    fireEvent.change(screen.getByLabelText('E-mail da pessoa cadastrada'), { target: { value: 'ghost@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não há conta cadastrada com este e-mail no Brain Core.');
  });

  it('accepts and rejects incoming requests', async () => {
    render(<ContactsSection />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }));

    await waitFor(() => expect(api.acceptContact).toHaveBeenCalledWith('incoming-1'));
    await waitFor(() => expect(api.listContacts).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    await waitFor(() => expect(api.removeContact).toHaveBeenCalledWith('incoming-1'));
  });

  it('cancels outgoing requests and removes accepted contacts', async () => {
    render(<ContactsSection />);
    await screen.findByText('Carla');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pedido' }));

    await waitFor(() => expect(api.removeContact).toHaveBeenCalledWith('outgoing-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(api.removeContact).toHaveBeenCalledWith('contact-1'));
  });

  it('shows fallback messages when lists fail to load', async () => {
    vi.mocked(api.listContacts).mockRejectedValue(new Error('API 503: {"error":"Failed to list contacts"}'));
    render(<ContactsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar seus contatos.');
  });

  it('formats names and parses backend errors', () => {
    expect(contactDisplayName({ id: '1', name: null, email: 'só-email@test.local' })).toBe('só-email@test.local');
    expect(apiErrorMessage(new Error('API 409: {"error":"Vocês já são contatos."}'), 'fallback')).toBe('Vocês já são contatos.');
    expect(apiErrorMessage(new Error('API 503: texto puro'), 'fallback')).toBe('API 503: texto puro');
    expect(apiErrorMessage(new Error('rede caiu'), 'fallback')).toBe('rede caiu');
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
  });
});