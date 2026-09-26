import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ContactLists, ContactSummary } from '../../types';
import { apiErrorMessage, contactDisplayName } from './sharedModel';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PersonRow({ contact, actions }: { contact: ContactSummary; actions: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{contactDisplayName(contact)}</p>
        <p className="truncate text-[11px] text-[var(--theme-muted)]">{contact.email}</p>
      </div>
      {actions}
    </li>
  );
}

export function ContactsSection() {
  const [lists, setLists] = useState<ContactLists | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await api.listContacts();
      setLists(next);
      setError('');
    } catch {
      setError('Não foi possível carregar seus contatos.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, successMessage: string) => {
    setBusy(key);
    setMessage('');
    setError('');
    try {
      await action();
      await load();
      setMessage(successMessage);
    } catch (err) {
      setError(apiErrorMessage(err, 'Ação indisponível no momento.'));
    } finally {
      setBusy(null);
    }
  };

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError('Informe um e-mail válido.');
      return;
    }
    setBusy('invite');
    setMessage('');
    setError('');
    try {
      await api.requestContact(trimmed);
      setEmail('');
      await load();
      setMessage('Pedido enviado. A pessoa precisa aceitar para virar contato.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível enviar o pedido.'));
    } finally {
      setBusy(null);
    }
  };

  const accept = (contact: ContactSummary) => run(`accept:${contact.id}`, () => api.acceptContact(contact.id), `Contato aceito: ${contactDisplayName(contact)}.`);
  const reject = (contact: ContactSummary) => run(`reject:${contact.id}`, () => api.removeContact(contact.id), 'Pedido recusado.');
  const cancel = (contact: ContactSummary) => run(`cancel:${contact.id}`, () => api.removeContact(contact.id), 'Pedido cancelado.');
  const remove = (contact: ContactSummary) => run(`remove:${contact.id}`, () => api.removeContact(contact.id), 'Contato removido.');

  const buttonClass = 'min-h-9 rounded-md border border-[var(--theme-border)] px-2.5 text-[12px] hover:bg-white/[0.06] disabled:opacity-40';
  const emptyClass = 'rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-3 text-center text-[12px] text-[var(--theme-muted)]';

  return (
    <section className="flex flex-col gap-4" aria-label="Contatos">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-600">Contatos e compartilhamento</h2>
      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-5 flex flex-col gap-4">
        <p className="text-[12px] text-[var(--theme-muted)]">
          Contatos só podem ser adicionados entre pessoas cadastradas no Brain Core. Depois de aceitar o pedido,
          vocês podem compartilhar páginas e pastas pelo botão de compartilhar.
        </p>

        <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="E-mail da pessoa cadastrada"
            aria-label="E-mail da pessoa cadastrada"
            className="min-h-10 flex-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 text-[13px]"
          />
          <button
            type="submit"
            disabled={busy === 'invite'}
            className="min-h-10 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {busy === 'invite' ? 'Enviando…' : 'Enviar pedido'}
          </button>
        </form>

        {message && <p role="status" className="text-[12px] text-emerald-400">{message}</p>}
        {error && <p role="alert" className="text-[12px] text-red-400">{error}</p>}

        <section aria-label="Pedidos recebidos" className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">Pedidos recebidos</p>
          {lists?.incoming.length
            ? lists.incoming.map(contact => (
              <PersonRow key={contact.id} contact={contact} actions={
                <>
                  <button type="button" disabled={busy === `accept:${contact.id}`} onClick={() => void accept(contact)}
                    className="min-h-9 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white disabled:opacity-40">
                    Aceitar
                  </button>
                  <button type="button" disabled={busy === `reject:${contact.id}`} onClick={() => void reject(contact)}
                    className={buttonClass}>
                    Recusar
                  </button>
                </>
              } />
            ))
            : <p className={emptyClass}>Nenhum pedido pendente.</p>}
        </section>

        <section aria-label="Pedidos enviados" className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">Pedidos enviados</p>
          {lists?.outgoing.length
            ? lists.outgoing.map(contact => (
              <PersonRow contact={contact} actions={
                <button type="button" disabled={busy === `remove:${contact.id}`} onClick={() => void cancel(contact)}
                  className={buttonClass}>
                  Cancelar pedido
                </button>
              } />
            ))
            : <p className={emptyClass}>Nenhum pedido aguardando resposta.</p>}
        </section>

        <section aria-label="Meus contatos" className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">Meus contatos</p>
          {lists?.contacts.length
            ? lists.contacts.map(contact => (
              <PersonRow contact={contact} actions={
                <button type="button" disabled={busy === `remove:${contact.id}`} onClick={() => void remove(contact)}
                  className="min-h-9 rounded-md px-2 text-[12px] text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                  Remover
                </button>
              } />
            ))
            : <p className={emptyClass}>Você ainda não tem contatos aceitos.</p>}
        </section>
      </div>
    </section>
  );
}