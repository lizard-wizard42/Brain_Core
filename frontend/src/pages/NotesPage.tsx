import { NotasBoard } from '../components/Notas/NotasBoard';
import { useNotas } from '../components/Notas/useNotas';

export function NotesPage() {
  const { notes, loading, error, createNote, saveNote, deleteNote } = useNotas();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-5 text-xl font-semibold text-white">Notas</h1>
        <NotasBoard notes={notes} loading={loading} error={error} onCreate={createNote} onSave={saveNote} onDelete={deleteNote} />
      </div>
    </div>
  );
}
