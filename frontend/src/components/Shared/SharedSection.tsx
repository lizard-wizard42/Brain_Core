import { useMemo, useState } from 'react';
import type { SharedPageSummary } from '../../types';
import { ShareBadge } from './ShareBadge';
import { ShareManagerModal } from './ShareManagerModal';
import { useSharedPages } from './sharedPagesContext';
import { filterSharedPages, formatDateTime } from './sharedModel';

function lastEditLine(page: SharedPageSummary): string {
  const when = formatDateTime(page.last_edited_at ?? page.updated_at);
  if (!when) return '';
  return page.last_editor ? `por ${page.last_editor} em ${when}` : `em ${when}`;
}

function SharedItem({
  page,
  onOpenPage,
  onManage,
}: {
  page: SharedPageSummary;
  onOpenPage?: (page: SharedPageSummary) => void;
  onManage?: (page: SharedPageSummary) => void;
}) {
  return (
    <div className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-[var(--theme-hover)]">
      <button
        type="button"
        onClick={() => onOpenPage?.(page)}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-[13px] text-[var(--theme-text)]"
      >
        <span aria-hidden="true" className="w-5 shrink-0 text-center text-sm">{page.icon || '📄'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{page.title}</span>
          <span className="block truncate text-[10px] text-[var(--theme-muted)]">{lastEditLine(page)}</span>
        </span>
        <ShareBadge role={page.role} count={page.grantees?.length} />
      </button>
      {page.role === 'owner' && onManage && (
        <button
          type="button"
          onClick={() => onManage(page)}
          aria-label={`Gerenciar acesso a ${page.title}`}
          title="Gerenciar acesso"
          className="min-h-10 min-w-9 shrink-0 rounded-md text-[13px] text-[var(--theme-muted)] opacity-0 transition-opacity hover:text-[var(--theme-text)] focus:opacity-100 group-hover:opacity-100"
        >
          ⋯
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
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [managing, setManaging] = useState<SharedPageSummary | null>(null);

  const total = shared.received.length + shared.sent.length;
  const received = useMemo(() => filterSharedPages(shared.received, search), [shared.received, search]);
  const sent = useMemo(() => filterSharedPages(shared.sent, search), [shared.sent, search]);
  const searching = search.trim().length > 0;
  const nothingMatches = searching && received.length === 0 && sent.length === 0;

  return (
    <section aria-label="Compartilhados" className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 pt-4 pb-1 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Compartilhados</span>
        {total > 0 && <span className="rounded-full bg-[var(--theme-hover)] px-1.5 text-[10px] text-[var(--theme-muted)]">{total}</span>}
        <span aria-hidden="true" className="ml-auto text-[10px] text-gray-600">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-1">
          <div className="px-1 pb-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar compartilhados…"
              aria-label="Buscar páginas compartilhadas"
              className="w-full rounded-md border border-[#242424] bg-[#161616] px-2 py-1 text-[12px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#333]"
            />
          </div>

          {shared.loading ? (
            <p className="px-2 py-2 text-[11px] text-gray-600">Carregando compartilhados…</p>
          ) : nothingMatches ? (
            <p className="px-2 py-2 text-[11px] text-gray-600">Nada encontrado em Compartilhados.</p>
          ) : total === 0 ? (
            <div className="space-y-1 px-2 py-1">
              <p className="text-[11px] text-gray-600">{shared.error ?? 'Nada compartilhado com você ainda.'}</p>
              <p className="text-[11px] text-gray-700">Você ainda não compartilhou nenhuma página.</p>
            </div>
          ) : (
            <div className="space-y-2 pb-1">
              <div>
                <p className="px-2 text-[10px] uppercase tracking-wide text-gray-600">Compartilhadas comigo</p>
                {received.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-gray-600">{searching ? 'Nenhuma correspondência.' : 'Nenhuma página recebida.'}</p>
                ) : received.map((page) => (
                  <div key={page.id} className={page.id === activePage ? 'rounded-md bg-white/[0.07]' : ''}>
                    <SharedItem page={page} onOpenPage={onOpenPage} onManage={setManaging} />
                  </div>
                ))}
              </div>

              <div>
                <p className="px-2 text-[10px] uppercase tracking-wide text-gray-600">Compartilhadas por mim</p>
                {sent.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-gray-600">
                    {searching ? 'Nenhuma correspondência.' : (shared.sentError ?? 'Nenhuma página enviada.')}
                  </p>
                ) : sent.map((page) => (
                  <div key={page.id} className={page.id === activePage ? 'rounded-md bg-white/[0.07]' : ''}>
                    <SharedItem page={page} onOpenPage={onOpenPage} onManage={setManaging} />
                  </div>
                ))}
                {shared.sentError && sent.length > 0 && (
                  <p className="px-2 text-[10px] text-gray-600">{shared.sentError}</p>
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
