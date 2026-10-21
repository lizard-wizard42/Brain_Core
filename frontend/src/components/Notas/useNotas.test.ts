import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotas } from './useNotas';
import { emptyDraft, toDraft } from './notasModel';
import { api } from '../../api/client';
import type { RememberNote } from '../../types';

vi.mock('../../api/client', () => ({
  api: {
    listRememberNotes: vi.fn(),
    createRememberNote: vi.fn(),
    updateRememberNote: vi.fn(),
    deleteRememberNote: vi.fn(),
    listTrashedRememberNotes: vi.fn(),
    restoreRememberNote: vi.fn(),
    checkRememberNoteItem: vi.fn(),
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


describe('preservação dos metadados ao editar', () => {
  it('mantém tags e rótulo do lembrete que não têm controles no editor', async () => {
    const original = note({ tags: ['projeto', 'revisar'], reminder_date: '2026-11-01', reminder_label: 'Revisão' });
    vi.mocked(api.updateRememberNote).mockResolvedValue(original);
    const { result } = renderHook(() => useNotas({ autoload: false }));
    await act(async () => { await result.current.saveNote(original, { ...toDraft(original), title: 'Título corrigido' }); });
    expect(api.updateRememberNote).toHaveBeenLastCalledWith('n1', expect.objectContaining({ tags: ['projeto', 'revisar'], reminder_label: 'Revisão' }));
  });

  it('limpa o rótulo quando o usuário remove o lembrete', async () => {
    const original = note({ reminder_date: '2026-11-01', reminder_label: 'Revisão' });
    vi.mocked(api.updateRememberNote).mockResolvedValue(original);
    const { result } = renderHook(() => useNotas({ autoload: false }));
    await act(async () => { await result.current.saveNote(original, { ...toDraft(original), reminderEnabled: false }); });
    expect(api.updateRememberNote).toHaveBeenLastCalledWith('n1', expect.objectContaining({ reminder_date: null, reminder_label: null }));
  });
});


it('loads persisted trash and restores the original identity without creating a new note', async () => {
  const deleted = note({ deleted_at: '2026-10-18T20:00:00Z', tags: ['keep'] });
  vi.mocked(api.listTrashedRememberNotes).mockResolvedValue({ notes: [deleted] });
  vi.mocked(api.restoreRememberNote).mockResolvedValue({ ...deleted, deleted_at: null });
  const { result } = renderHook(() => useNotas({ autoload: false }));
  await act(async () => { await result.current.loadTrash(); });
  expect(result.current.trash[0].id).toBe(deleted.id);
  await act(async () => { await result.current.restoreNote(deleted); });
  expect(result.current.trash).toHaveLength(0);
  expect(result.current.notes[0]).toMatchObject({ id: deleted.id, tags: ['keep'], deleted_at: null });
});

it('updates only the targeted checklist flag through its dedicated API', async () => {
  const original = note({ tags: ['keep'], checklist: [{ id: 'item', text: 'Revisar', checked: false }] });
  vi.mocked(api.listRememberNotes).mockResolvedValue({ notes: [original] });
  vi.mocked(api.checkRememberNoteItem).mockResolvedValue({ ...original, checklist: [{ ...original.checklist[0], checked: true }] });
  const { result } = renderHook(() => useNotas());
  await waitFor(() => expect(result.current.notes).toHaveLength(1));
  await act(async () => { await result.current.toggleChecklist(original, 'item', true); });
  expect(api.checkRememberNoteItem).toHaveBeenLastCalledWith(original.id, 'item', true);
  expect(result.current.notes[0].checklist[0].checked).toBe(true);
  expect(result.current.notes[0].tags).toEqual(['keep']);
});
