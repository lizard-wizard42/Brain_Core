import { useEffect, useMemo, useState } from 'react';
import type { RememberNote } from '../../types';
import { NotasComposer } from './NotasComposer';
import { NotasCard } from './NotasCard';
import { buildQuickDraft, emptyDraft, type NoteDraft } from './notasModel';

const COLUMNS = 'grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3';
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function NotasBoard({
  notes,
  focusedNoteId,
  loading,
  error,
  onCreate,
  onSave,
  onDelete,
  preview = false,
}: {
  notes: RememberNote[];
  preview?: boolean;
  focusedNoteId?: string | null;
  loading: boolean;
  error: string | null;
  onCreate: (draft: NoteDraft) => Promise<void>;
  onSave: (note: RememberNote, draft: NoteDraft) => Promise<void>;
  onDelete: (note: RememberNote) => Promise<void>;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<NoteDraft>(() => emptyDraft());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'checklist' | 'reminder'>('all');
  const [sort, setSort] = useState('updated');
  const [visibleCount, setVisibleCount] = useState(24);
  useEffect(() => {
    if (!focusedNoteId || loading) return;
    const card = document.getElementById(`quick-note-${focusedNoteId}`);
    card?.scrollIntoView?.({ block: 'center' });
    card?.focus({ preventScroll: true });
  }, [focusedNoteId, loading, notes]);

  const filtered = useMemo(() => {
    const query = normalize(search.trim());
    return notes.filter((note) => {
      if (filter === 'checklist' && !note.checklist.length) return false;
      if (filter === 'reminder' && !note.reminder_date) return false;
      return normalize([note.title, note.body, ...note.checklist.map(item => item.text), ...note.tags].join('\n')).includes(query);
    }).sort((a, b) => sort === 'title'
      ? (a.title || a.body).localeCompare(b.title || b.body, 'pt-BR')
      : b.updated_at.localeCompare(a.updated_at));
  }, [notes, search, filter, sort]);
  // A deep-linked note stays reachable even when it is older than the first batch.
  const focusedIndex = focusedNoteId ? filtered.findIndex(note => note.id === focusedNoteId) : -1;
  const shown = filtered.slice(0, preview ? 6 : Math.max(visibleCount, focusedIndex + 1));

  const openComposer = (kind: 'note' | 'checklist' | 'reminder' = 'note') => {
    setComposerSeed(buildQuickDraft(kind));
    setComposerOpen(true);
  };

  return (
    <div>

      <NotasComposer
        open={composerOpen}
        onOpen={openComposer}
        onClose={() => setComposerOpen(false)}
        onCreate={onCreate}
        initialDraft={composerSeed}
        search={search}
        onSearchChange={preview ? undefined : (value) => { setSearch(value); setVisibleCount(24); }}
      />

      {!preview && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filtrar notas" className="flex flex-wrap gap-2">
            {([{ id: 'all', label: 'Todas' }, { id: 'checklist', label: 'Listas' }, { id: 'reminder', label: 'Lembretes' }] as const).map(item => (
              <button key={item.id} type="button" aria-pressed={filter === item.id}
                onClick={() => { setFilter(item.id); setVisibleCount(24); }}
                className={`min-h-11 rounded-full border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)] ${filter === item.id ? 'border-[var(--theme-primary)] bg-[var(--theme-hover)] text-[var(--theme-text)]' : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]'}`}>
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
            Ordenar
            <select value={sort} onChange={event => { setSort(event.target.value); setVisibleCount(24); }}
              className="min-h-11 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 text-sm text-[var(--theme-text)]">
              <option value="updated">Atualizadas recentemente</option>
              <option value="title">Título (A–Z)</option>
            </select>
          </label>
        </div>
      )}
      {!loading && !error && !preview && <p role="status" className="mt-3 text-xs text-[var(--theme-muted)]">{filtered.length} {filtered.length === 1 ? 'nota' : 'notas'}{filtered.length !== notes.length ? ` de ${notes.length}` : ''}</p>}
      <div className="mt-5">
        {loading ? (
          <p role="status" className="text-sm text-[var(--theme-muted)]">Carregando notas…</p>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-900/40 bg-red-950/20 px-4 py-3 text-[13px] text-red-300">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-5 py-8 text-sm text-[var(--theme-muted)]">
            {search.trim() ? `Nenhuma nota encontrada para "${search.trim()}".` : filter !== 'all' ? 'Nenhuma nota neste filtro.' : 'Suas ideias começam aqui. Escreva sua primeira nota acima.'}
            {(search.trim() || filter !== 'all') && <button type="button" onClick={() => { setSearch(''); setFilter('all'); }} className="mt-3 block min-h-11 text-[var(--theme-link)] underline">Limpar filtros</button>}
          </div>
        ) : (
          <div className={COLUMNS}>
            {shown.map((note) => (
              <div key={note.id} id={`quick-note-${note.id}`} tabIndex={-1} className="min-w-0 rounded-2xl focus:outline focus:outline-2 focus:outline-[var(--theme-primary)]">
                <NotasCard note={note} onSave={onSave} onDelete={onDelete} />
              </div>
            ))}
          </div>
        )}
      </div>

      {!preview && shown.length < filtered.length && <button type="button" onClick={() => setVisibleCount(count => count + 24)} className="mt-5 min-h-11 rounded-xl border border-[var(--theme-border)] px-4 text-sm text-[var(--theme-text)] hover:bg-[var(--theme-hover)]">Mostrar mais notas ({filtered.length - shown.length})</button>}
      {!preview && !composerOpen && <button
        type="button"
        aria-label="Criar nota"
        onClick={() => openComposer('note')}
        className="fixed bottom-5 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#e6d3a3] text-[28px] text-[#1c160f] shadow-[0_16px_35px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-1 sm:bottom-6 sm:right-6"
        title="Criar nota"
      >
        +
      </button>}
    </div>
  );
}
