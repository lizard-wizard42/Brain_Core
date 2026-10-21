import { useState } from 'react';
import { NotasTrash } from '../components/Notas/NotasTrash';
import { useSearchParams } from 'react-router-dom';
import { NotasBoard } from '../components/Notas/NotasBoard';
import { useNotas } from '../components/Notas/useNotas';

export function NotesPage() {
  const [params] = useSearchParams();
  const [showTrash, setShowTrash] = useState(false);
  const { notes, loading, error, createNote, saveNote, deleteNote, deletedNote, restoreNote, toggleChecklist,
    trash, trashLoading, trashError, loadTrash } = useNotas();

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--theme-background)] px-4 pb-24 pt-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6"><h1 className="text-2xl font-semibold text-[var(--theme-text)]">Notas</h1><p className="mt-2 text-sm text-[var(--theme-muted)]">Ideias, listas e lembretes. Tudo fácil de encontrar.</p></header>
        <div className="mb-5 flex gap-3" role="group" aria-label="Visualizar notas">
          <button type="button" aria-pressed={!showTrash} onClick={() => setShowTrash(false)} className={`min-h-11 rounded-xl border px-4 text-[var(--theme-text)] ${!showTrash ? 'border-[var(--theme-primary)] bg-[var(--theme-hover)]' : 'border-[var(--theme-border)]'}`}>Minhas notas</button>
          <button type="button" aria-pressed={showTrash} onClick={() => { setShowTrash(true); void loadTrash(); }} className={`min-h-11 rounded-xl border px-4 text-[var(--theme-text)] ${showTrash ? 'border-[var(--theme-primary)] bg-[var(--theme-hover)]' : 'border-[var(--theme-border)]'}`}>Lixeira</button>
        </div>
        {showTrash && <NotasTrash notes={trash} loading={trashLoading} error={trashError} onReload={loadTrash} onRestore={restoreNote} />}
        <div hidden={showTrash}><NotasBoard focusedNoteId={params.get('note')} notes={notes} loading={loading} error={error} onCreate={createNote} onSave={saveNote} onDelete={deleteNote} deletedNote={deletedNote} onRestore={restoreNote} onToggleChecklist={toggleChecklist} /></div>
      </div>
    </div>
  );
}
