import { useSearchParams } from 'react-router-dom';
import { NotasBoard } from '../components/Notas/NotasBoard';
import { useNotas } from '../components/Notas/useNotas';

export function NotesPage() {
  const [params] = useSearchParams();
  const { notes, loading, error, createNote, saveNote, deleteNote } = useNotas();

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--theme-background)] px-4 pb-24 pt-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6"><h1 className="text-2xl font-semibold text-[var(--theme-text)]">Notas</h1><p className="mt-2 text-sm text-[var(--theme-muted)]">Ideias, listas e lembretes. Tudo fácil de encontrar.</p></header>
        <NotasBoard focusedNoteId={params.get('note')} notes={notes} loading={loading} error={error} onCreate={createNote} onSave={saveNote} onDelete={deleteNote} />
      </div>
    </div>
  );
}
