import { describe, expect, it } from 'vitest';
import { buildQuickDraft, emptyDraft, noteColor, normalizeReminder, reminderBadge, toDraft } from './notasModel';
import type { RememberNote } from '../../types';

const note: RememberNote = {
  id: 'n1', title: 'T', body: 'B', color: 'sage', checklist: [{ id: 'c1', text: 'x', checked: true }],
  tags: [], reminder_date: '2026-09-01', reminder_time: '08:30', reminder_label: null,
  reminder_repeat_daily: true, reminder_sent_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

describe('notasModel', () => {
  it('normalizeReminder: desligado ou sem data → tudo null', () => {
    expect(normalizeReminder({ ...emptyDraft(), reminderEnabled: false, reminderDate: '2026-09-01' }))
      .toEqual({ reminder_date: null, reminder_time: null, reminder_label: null, reminder_repeat_daily: false });
    expect(normalizeReminder({ ...emptyDraft(), reminderEnabled: true, reminderDate: '' }).reminder_date).toBeNull();
  });

  it('normalizeReminder: ligado com data → propaga data/hora/repetição', () => {
    expect(normalizeReminder({
      ...emptyDraft(), reminderEnabled: true, reminderDate: '2026-09-01', reminderTime: '08:30', reminderRepeatDaily: true,
    })).toEqual({ reminder_date: '2026-09-01', reminder_time: '08:30', reminder_label: null, reminder_repeat_daily: true });
  });

  it('normalizeReminder: hora vazia vira null', () => {
    expect(normalizeReminder({ ...emptyDraft(), reminderEnabled: true, reminderDate: '2026-09-01', reminderTime: '' }).reminder_time).toBeNull();
  });

  it('toDraft faz round-trip do lembrete da nota', () => {
    const d = toDraft(note);
    expect(d).toMatchObject({ title: 'T', body: 'B', color: 'sage', reminderEnabled: true, reminderDate: '2026-09-01', reminderTime: '08:30', reminderRepeatDaily: true });
    expect(d.checklist).toEqual(note.checklist);
  });

  it('reminderBadge formata data · hora · diario', () => {
    expect(reminderBadge(note)).toBe('2026-09-01 08:30 · diario');
    expect(reminderBadge({ ...note, reminder_date: null })).toBeNull();
  });

  it('buildQuickDraft: reminder pré-liga a data de hoje; checklist adiciona 1 item', () => {
    const r = buildQuickDraft('reminder');
    expect(r.reminderEnabled).toBe(true);
    expect(r.reminderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(buildQuickDraft('checklist').checklist).toHaveLength(1);
    expect(buildQuickDraft('note').checklist).toHaveLength(0);
  });

  it('noteColor cai no primeiro quando a cor é inválida', () => {
    expect(noteColor('sky').id).toBe('sky');
    // @ts-expect-error - cor inexistente
    expect(noteColor('nope').id).toBe('sand');
  });
});
