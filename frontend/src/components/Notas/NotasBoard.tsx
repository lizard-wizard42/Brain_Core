import { useMemo, useState } from 'react';
import type { RememberNote } from '../../types';
import { NotasComposer } from './NotasComposer';
import { NotasCard } from './NotasCard';
import { buildQuickDraft, emptyDraft, type NoteDraft } from './notasModel';

const COLUMNS = 'columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4';

export function NotasBoard({
  notes,
  loading,
  error,
  onCreate,
  onSave,
  onDelete,
}: {
  notes: RememberNote[];
  loading: boolean;
  error: string | null;
  onCreate: (draft: NoteDraft) => Promise<void>;
  onSave: (note: RememberNote, draft: NoteDraft) => Promise<void>;
  onDelete: (note: RememberNote) => Promise<void>;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<NoteDraft>(() => emptyDraft());
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((note) => {
      const haystack = [note.title, note.body, ...note.checklist.map((item) => item.text)].join('\n').toLowerCase();
      return haystack.includes(query);
    });
  }, [notes, search]);

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
        onSearchChange={setSearch}
      />

      <div className="mt-6">
        {loading ? (
          <p className="text-[13px] text-gray-500">Carregando…</p>
        ) : error ? (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 px-4 py-3 text-[13px] text-red-300">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] px-5 py-6 text-[13px] text-gray-400">
            {search.trim() ? `Nenhuma nota encontrada para "${search.trim()}".` : 'Ainda não há notas. Crie a primeira no composer acima.'}
          </div>
        ) : (
          <div className={COLUMNS}>
            {filtered.map((note) => (
              <div key={note.id} className="mb-4 break-inside-avoid">
                <NotasCard note={note} onSave={onSave} onDelete={onDelete} />
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => openComposer('note')}
        className="fixed bottom-5 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#e6d3a3] text-[28px] text-[#1c160f] shadow-[0_16px_35px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-1 sm:bottom-6 sm:right-6"
        title="Criar nota"
      >
        +
      </button>
    </div>
  );
}
