import { useId, useMemo, useRef, useState } from 'react';
import type { SharedPageSummary } from '../../types';
import { ShareManagerModal } from './ShareManagerModal';
import { useSharedPages } from './sharedPagesContext';
import { filterSharedPages } from './sharedModel';
import './sharedSection.css';

function SharedItem({
  page,
  onOpenPage,
  onManage,
  active = false,
}: {
  page: SharedPageSummary;
  active?: boolean;
  onOpenPage?: (page: SharedPageSummary) => void;
  onManage?: (page: SharedPageSummary) => void;
}) {
  return (
    <div className="shared-page-item" data-active={active || undefined}>
      <button
        type="button"
        onClick={() => onOpenPage?.(page)}
        className="shared-page-open"
        title={page.title}
        aria-current={active ? 'page' : undefined}
      >
        <span aria-hidden="true" className="shared-page-icon">{page.icon || '📄'}</span>
        <span className="shared-page-title">{page.title}</span>
      </button>
      {page.role === 'owner' && onManage && (
        <button
          type="button"
          onClick={() => onManage(page)}
          aria-label={`Gerenciar acesso a ${page.title}`}
          title="Gerenciar acesso"
          className="shared-page-manage"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
        </button>
      )}
    </div>
  );
}

export function SharedSection({ activePage, onOpenPage }: {
  activePage?: string | null;
  onOpenPage?: (page: SharedPageSummary) => void;
}) {
  const shared = useSharedPages();
  const contentId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [managing, setManaging] = useState<SharedPageSummary | null>(null);

  const total = shared.received.length + shared.sent.length;
  const received = useMemo(() => filterSharedPages(shared.received, search), [shared.received, search]);
  const sent = useMemo(() => filterSharedPages(shared.sent, search), [shared.sent, search]);
  const searching = search.trim().length > 0;
  const nothingMatches = searching && received.length === 0 && sent.length === 0;

  return (
    <section aria-label="Compartilhados" className="shared-section">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={contentId}
        className="shared-section-toggle"
      >
        <svg className="shared-section-symbol" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0112 0v2M16 5a3 3 0 010 6M18 14a5 5 0 013 4v2" /></svg>
        <span className="shared-section-title">Compartilhados</span>
        {total > 0 && <span className="shared-section-count">{total}</span>}
        <svg className="shared-section-chevron" data-open={open} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>

      {open && (
        <div className="shared-section-content" id={contentId}>
          <div className="shared-section-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
            <input
              ref={searchInput}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar compartilhados…"
              aria-label="Buscar páginas compartilhadas"
              className="shared-search-input"
            />
            {search && <button type="button" className="shared-search-clear" aria-label="Limpar busca de compartilhados" title="Limpar busca" onClick={() => { setSearch(''); searchInput.current?.focus(); }}>×</button>}
          </div>

          {shared.loading ? (
            <p className="shared-section-message" role="status">Carregando compartilhados…</p>
          ) : nothingMatches ? (
            <p className="shared-section-message" role="status">Nada encontrado em Compartilhados.</p>
          ) : total === 0 ? (
            <div className="shared-section-empty">
              <p className="shared-section-message">{shared.error ?? 'Nada compartilhado com você ainda.'}</p>
              <p className="shared-section-message">{shared.sentError ?? 'Você ainda não compartilhou nenhuma página.'}</p>
            </div>
          ) : (
            <div className="shared-section-groups">
              <div>
                <h3 className="shared-group-title">Compartilhadas comigo <span>{received.length}</span></h3>
                {received.length === 0 ? (
                  <p className="shared-section-message">{searching ? 'Nenhuma correspondência.' : (shared.error ?? 'Nenhuma página recebida.')}</p>
                ) : received.map((page) => (
                  <SharedItem key={page.id} page={page} active={page.id === activePage} onOpenPage={onOpenPage} onManage={setManaging} />
                ))}
              </div>

              <div>
                <h3 className="shared-group-title">Compartilhadas por mim <span>{sent.length}</span></h3>
                {sent.length === 0 ? (
                  <p className="shared-section-message">
                    {searching ? 'Nenhuma correspondência.' : (shared.sentError ?? 'Nenhuma página enviada.')}
                  </p>
                ) : sent.map((page) => (
                  <SharedItem key={page.id} page={page} active={page.id === activePage} onOpenPage={onOpenPage} onManage={setManaging} />
                ))}
                {shared.sentError && sent.length > 0 && (
                  <p className="shared-section-message">{shared.sentError}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {managing && (
        <ShareManagerModal
          pageId={managing.id}
          pageTitle={managing.title}
          onClose={() => setManaging(null)}
          onChanged={shared.refresh}
        />
      )}
    </section>
  );
}
