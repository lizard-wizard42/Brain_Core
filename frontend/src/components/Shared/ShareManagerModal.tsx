import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import type { ContactSummary, PageGrant } from '../../types';
import { grantDisplayName, roleLabel } from './sharedModel';

export function ShareManagerModal({
  pageId,
  pageTitle,
  onClose,
  onChanged,
}: {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [grants, setGrants] = useState<PageGrant[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [subPageCount, setSubPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('viewer');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, lists] = await Promise.all([
        api.getPageGrants(pageId),
        api.listContacts().catch(() => ({ contacts: [], incoming: [], outgoing: [] })),
      ]);
      setGrants(list);
      setContacts(lists.contacts);
      setError(null);
    } catch (err) {
      setGrants([]);
      setError(/API 404/.test(String(err)) ? 'Gerenciamento de acesso indisponível para esta página' : 'Não foi possível carregar os acessos');
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api.getSubPages(pageId).then(subPages => {
      if (!cancelled) setSubPageCount(subPages.length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pageId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const availableContacts = useMemo(() => {
    const grantedIds = new Set(grants.map(grant => grant.user_id));
    const needle = search.trim().toLowerCase();
    return contacts.filter(contact => {
      if (grantedIds.has(contact.id)) return false;
      if (!needle) return true;
      const haystack = `${contact.name ?? ''} ${contact.email}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [contacts, grants, search]);

  const applyGrant = async (userId: string, role: 'editor' | 'viewer') => {
    setBusy(true);
    try {
      await api.setPageGrant(pageId, userId, role);
      await load();
      onChanged?.();
      setError(null);
    } catch {
      setError('Não foi possível atualizar o acesso');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId: string) => {
    setBusy(true);
    try {
      await api.removePageGrant(pageId, userId);
      await load();
      onChanged?.();
      setError(null);
    } catch {
      setError('Não foi possível remover o acesso');
    } finally {
      setBusy(false);
    }
  };

  const shareWith = (contact: ContactSummary) => {
    void applyGrant(contact.id, newRole);
    setSearch('');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[320] flex items-center justify-center bg-black/60 px-3 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gerenciar acesso a ${pageTitle}`}
        className="flex max-h-[85vh] w-[min(94vw,440px)] flex-col overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--theme-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold">Compartilhamento</h2>
            <p className="truncate text-[12px] text-[var(--theme-muted)]">{pageTitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar compartilhamento" className="min-h-10 min-w-10 rounded-lg text-[var(--theme-muted)] hover:text-[var(--theme-text)]">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error && <p role="alert" className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</p>}
          {subPageCount > 0 && (
            <p className="mb-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-[12px] text-[var(--theme-muted)]">
              Esta página é uma pasta: compartilhar ou revogar vale para ela e para as {subPageCount} subpágina(s) existentes.
            </p>
          )}
          {loading ? (
            <p className="py-4 text-center text-[12px] text-[var(--theme-muted)]">Carregando acessos…</p>
          ) : grants.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-4 text-center text-[12px] text-[var(--theme-muted)]">Esta página ainda não está compartilhada com ninguém.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {grants.map((grant) => (
                <li key={grant.user_id} className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{grantDisplayName(grant)}</p>
                    <p className="text-[11px] text-[var(--theme-muted)]">{roleLabel(grant.role)}</p>
                  </div>
                  <select
                    aria-label={`Nível de acesso de ${grantDisplayName(grant)}`}
                    value={grant.role}
                    disabled={busy}
                    onChange={(event) => { void applyGrant(grant.user_id, event.target.value as 'editor' | 'viewer'); }}
                    className="min-h-9 rounded-md border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-[12px]"
                  >
                    <option value="viewer">Pode ler</option>
                    <option value="editor">Pode editar</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { void revoke(grant.user_id); }}
                    className="min-h-9 rounded-md px-2 text-[12px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--theme-border)] px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-muted)]">Compartilhar com um contato</p>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar contato por nome ou e-mail"
            aria-label="Buscar contato por nome ou e-mail"
            className="mb-2 min-h-10 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-[13px]"
          />
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] text-[var(--theme-muted)]">Nível:</span>
            <select
              aria-label="Nível de acesso a conceder"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as 'editor' | 'viewer')}
              className="min-h-9 rounded-md border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-[12px]"
            >
              <option value="viewer">Pode ler</option>
              <option value="editor">Pode editar</option>
            </select>
          </div>
          {loading ? (
            <p className="py-2 text-center text-[12px] text-[var(--theme-muted)]">Carregando contatos…</p>
          ) : availableContacts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-3 text-center text-[12px] text-[var(--theme-muted)]">
              Nenhum contato disponível. Adicione pessoas em Configurações → Contatos e compartilhamento.
            </p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {availableContacts.map((contact) => (
                <li key={contact.id} className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{contact.name?.trim() || contact.email}</p>
                    <p className="truncate text-[11px] text-[var(--theme-muted)]">{contact.email}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => shareWith(contact)}
                    className="min-h-9 shrink-0 rounded-md bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40"
                  >
                    Compartilhar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}