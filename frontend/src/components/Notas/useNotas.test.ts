import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotas } from './useNotas';
import { emptyDraft } from './notasModel';
import { api } from '../../api/client';
import type { RememberNote } from '../../types';

vi.mock('../../api/client', () => ({
  api: {
    listRememberNotes: vi.fn(),
    createRememberNote: vi.fn(),
    updateRememberNote: vi.fn(),
    deleteRememberNote: vi.fn(),
  },
}));

const note = (over: Partial<RememberNote> = {}): RememberNote => ({
  id: 'n1', title: 'T', body: '', color: 'sand', checklist: [], tags: [],
  reminder_date: null, reminder_time: null, reminder_label: null, reminder_repeat_daily: false,
  reminder_sent_at: null, created_at: 'x', updated_at: 'x', ...over,
});

describe('useNotas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carrega as notas no mount (autoload)', async () => {
    vi.mocked(api.listRememberNotes).mockResolvedValue({ notes: [note({ id: 'a' })] });
    const { result } = renderHook(() => useNotas());
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });

  it('autoload:false não chama a API', () => {
    renderHook(() => useNotas({ autoload: false }));
    expect(api.listRememberNotes).not.toHaveBeenCalled();
  });

  it('createNote envia checklist filtrada + lembrete normalizado e faz prepend', async () => {
    vi.mocked(api.listRememberNotes).mockResolvedValue({ notes: [] });
    vi.mocked(api.createRememberNote).mockResolvedValue(note({ id: 'new' }));
    const { result } = renderHook(() => useNotas({ autoload: false }));

    await act(async () => {
      await result.current.createNote({
        ...emptyDraft(),
        title: 'X',
        checklist: [{ id: 'k', text: '  ', checked: false }, { id: 'j', text: 'real', checked: false }],
        reminderEnabled: true, reminderDate: '2026-09-01', reminderTime: '09:00',
      });
    });

    expect(api.createRememberNote).toHaveBeenCalledWith(expect.objectContaining({
      title: 'X',
      tags: [],
      checklist: [{ id: 'j', text: 'real', checked: false }],
      reminder_date: '2026-09-01',
      reminder_time: '09:00',
    }));
    expect(result.current.notes[0].id).toBe('new');
  });

  it('saveNote e deleteNote atualizam a lista', async () => {
    vi.mocked(api.listRememberNotes).mockResolvedValue({ notes: [note({ id: 'a', title: 'old' })] });
    vi.mocked(api.updateRememberNote).mockResolvedValue(note({ id: 'a', title: 'novo' }));
    vi.mocked(api.deleteRememberNote).mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useNotas());
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    await act(async () => { await result.current.saveNote(result.current.notes[0], { ...emptyDraft(), title: 'novo' }); });
    expect(result.current.notes[0].title).toBe('novo');

    await act(async () => { await result.current.deleteNote(result.current.notes[0]); });
    expect(result.current.notes).toHaveLength(0);
  });
});
