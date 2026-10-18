import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { RememberNote } from '../../types';
import { normalizeReminder, type NoteDraft } from './notasModel';

export function useNotas({ autoload = true }: { autoload?: boolean } = {}) {
  const [notes, setNotes] = useState<RememberNote[]>([]);
  const [trash, setTrash] = useState<RememberNote[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [deletedNote, setDeletedNote] = useState<RememberNote | null>(null);
  const [loading, setLoading] = useState(autoload);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNotes((await api.listRememberNotes()).notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar notas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (autoload) void reload(); }, [autoload, reload]);

  const createNote = useCallback(async (draft: NoteDraft) => {
    const created = await api.createRememberNote({
      title: draft.title,
      body: draft.body,
      color: draft.color,
      checklist: draft.checklist.filter((item) => item.text.trim()),
      tags: [],
      ...normalizeReminder(draft),
    });
    setNotes((current) => [created, ...current]);
  }, []);

  const saveNote = useCallback(async (note: RememberNote, draft: NoteDraft) => {
    const reminder = normalizeReminder(draft);
    const updated = await api.updateRememberNote(note.id, {
      title: draft.title,
      body: draft.body,
      color: draft.color,
      checklist: draft.checklist.filter((item) => item.text.trim()),
      // These fields are not editable here; preserve metadata created elsewhere.
      tags: note.tags,
      ...reminder,
      reminder_label: reminder.reminder_date ? note.reminder_label : null,
    });
    setNotes((current) => current.map((entry) => (entry.id === note.id ? updated : entry)));
  }, []);

  const deleteNote = useCallback(async (note: RememberNote) => {
    await api.deleteRememberNote(note.id);
    setNotes((current) => current.filter((entry) => entry.id !== note.id));
    setTrash(current => [{ ...note, deleted_at: new Date().toISOString() }, ...current.filter(entry => entry.id !== note.id)]);
    setDeletedNote(note);
  }, []);

  const loadTrash = useCallback(async () => {
    setTrashLoading(true); setTrashError(null);
    try { setTrash((await api.listTrashedRememberNotes()).notes); }
    catch (err) { setTrashError(err instanceof Error ? err.message : 'Não foi possível carregar a lixeira.'); }
    finally { setTrashLoading(false); }
  }, []);

  const restoreNote = useCallback(async (note: RememberNote) => {
    const restored = await api.restoreRememberNote(note.id);
    setNotes(current => [restored, ...current.filter(entry => entry.id !== restored.id)]);
    setTrash(current => current.filter(entry => entry.id !== restored.id));
    setDeletedNote(current => current?.id === restored.id ? null : current);
  }, []);

  const toggleChecklist = useCallback(async (note: RememberNote, itemId: string, checked: boolean) => {
    const updated = await api.checkRememberNoteItem(note.id, itemId, checked);
    setNotes(current => current.map(entry => entry.id === updated.id ? updated : entry));
  }, []);

  return { notes, loading, error, reload, createNote, saveNote, deleteNote,
    trash, trashLoading, trashError, loadTrash, restoreNote, deletedNote, toggleChecklist };

}
