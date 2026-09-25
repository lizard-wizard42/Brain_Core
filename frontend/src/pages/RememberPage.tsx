import { useCallback, useEffect, useState } from 'react';
import { RememberMemoryPanel } from '../components/Remember/RememberMemoryPanel';
import { NotasComposer } from '../components/Notas/NotasComposer';
import { emptyDraft, type NoteDraft } from '../components/Notas/notasModel';
import { useNotas } from '../components/Notas/useNotas';

/** The "Memória" workspace: recording control + chronological timeline + search.
 *  Quick notes/reminders can be spun off from a session — those land in Notas
 *  (shown on the dashboard). */
export function RememberPage() {
  const { createNote } = useNotas({ autoload: false });
  const [composerOpen, setComposerOpen] = useState(false);
  const [seed, setSeed] = useState<NoteDraft>(() => emptyDraft());

  const openFromSession = (draft: NoteDraft) => {
    setSeed(draft);
    setComposerOpen(true);
  };

  const close = useCallback(() => setComposerOpen(false), []);

  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerOpen, close]);

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,#1c1a18_0%,#131211_55%,#0f0e0d_100%)]">
      <div className="mx-auto max-w-[1480px] px-3 py-4 sm:px-4 md:px-8 md:py-8">
        <RememberMemoryPanel onCreateNote={openFromSession} />

        {composerOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Nova nota a partir da gravação"
            className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 pt-16"
            onClick={close}
          >
            <div className="w-full max-w-[560px]" onClick={(e) => e.stopPropagation()}>
              <NotasComposer
                open
                onOpen={() => undefined}
                onClose={close}
                onCreate={createNote}
                initialDraft={seed}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
