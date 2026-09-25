import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { RememberNote } from '../../types';
import { normalizeReminder, type NoteDraft } from './notasModel';

export function useNotas({ autoload = true }: { autoload?: boolean } = {}) {
  const [notes, setNotes] = useState<RememberNote[]>([]);
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
    const updated = await api.updateRememberNote(note.id, {
      title: draft.title,
      body: draft.body,
      color: draft.color,
      checklist: draft.checklist.filter((item) => item.text.trim()),
      tags: [],
      ...normalizeReminder(draft),
    });
    setNotes((current) => current.map((entry) => (entry.id === note.id ? updated : entry)));
  }, []);

  const deleteNote = useCallback(async (note: RememberNote) => {
    await api.deleteRememberNote(note.id);
    setNotes((current) => current.filter((entry) => entry.id !== note.id));
  }, []);

  return { notes, loading, error, reload, createNote, saveNote, deleteNote };
}
