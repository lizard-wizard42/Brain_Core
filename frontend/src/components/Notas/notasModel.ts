import type { RememberChecklistItem, RememberNote } from '../../types';
import notesIconUrl from '../../assets/icons/notes.svg';

export const NOTAS_ICON_URL = notesIconUrl;

export const NOTE_COLORS: Array<{
  id: RememberNote['color'];
  label: string;
  swatch: string;
  card: string;
  border: string;
  badge: string;
}> = [
  { id: 'sand', label: 'Areia', swatch: '#E6D3A3', card: 'linear-gradient(180deg, rgba(244,234,205,0.96), rgba(236,224,190,0.9))', border: 'rgba(230,211,163,0.72)', badge: 'bg-[#E6D3A3] text-[#2d2412]' },
  { id: 'rose', label: 'Rosa', swatch: '#E6A3A3', card: 'linear-gradient(180deg, rgba(247,222,222,0.96), rgba(239,199,199,0.9))', border: 'rgba(230,163,163,0.72)', badge: 'bg-[#E6A3A3] text-[#301717]' },
  { id: 'sage', label: 'Sálvia', swatch: '#A3C7A3', card: 'linear-gradient(180deg, rgba(225,241,225,0.96), rgba(203,231,203,0.9))', border: 'rgba(163,199,163,0.7)', badge: 'bg-[#A3C7A3] text-[#162616]' },
  { id: 'sky', label: 'Azul', swatch: '#A3B9E6', card: 'linear-gradient(180deg, rgba(224,232,247,0.96), rgba(203,217,242,0.9))', border: 'rgba(163,185,230,0.72)', badge: 'bg-[#A3B9E6] text-[#142034]' },
  { id: 'amber', label: 'Âmbar', swatch: '#E6C07A', card: 'linear-gradient(180deg, rgba(247,234,207,0.96), rgba(241,222,180,0.9))', border: 'rgba(230,192,122,0.74)', badge: 'bg-[#E6C07A] text-[#2b1c08]' },
  { id: 'lavender', label: 'Lavanda', swatch: '#C3A3E6', card: 'linear-gradient(180deg, rgba(238,228,248,0.96), rgba(226,210,243,0.9))', border: 'rgba(195,163,230,0.72)', badge: 'bg-[#C3A3E6] text-[#21142f]' },
  { id: 'slate', label: 'Grafite', swatch: '#7A7A7A', card: 'linear-gradient(180deg, rgba(210,210,210,0.92), rgba(182,182,182,0.86))', border: 'rgba(120,120,120,0.48)', badge: 'bg-[#5B5B5B] text-[#ededed]' },
];

export type NoteDraft = {
  title: string;
  body: string;
  color: RememberNote['color'];
  checklist: RememberChecklistItem[];
  reminderEnabled: boolean;
  reminderDate: string;
  reminderTime: string;
  reminderRepeatDaily: boolean;
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyDraft(): NoteDraft {
  return {
    title: '',
    body: '',
    color: 'sand',
    checklist: [],
    reminderEnabled: false,
    reminderDate: '',
    reminderTime: '',
    reminderRepeatDaily: false,
  };
}

export function buildQuickDraft(kind: 'note' | 'checklist' | 'reminder'): NoteDraft {
  if (kind === 'checklist') {
    return { ...emptyDraft(), checklist: [{ id: `item-${Date.now()}`, text: '', checked: false }] };
  }
  if (kind === 'reminder') {
    return { ...emptyDraft(), reminderEnabled: true, reminderDate: todayIso() };
  }
  return emptyDraft();
}

export function noteColor(color: RememberNote['color']) {
  return NOTE_COLORS.find((entry) => entry.id === color) ?? NOTE_COLORS[0];
}

export function reminderBadge(note: RememberNote): string | null {
  if (!note.reminder_date) return null;
  const time = note.reminder_time ? ` ${note.reminder_time}` : '';
  const repeat = note.reminder_repeat_daily ? ' · diario' : '';
  return `${note.reminder_date}${time}${repeat}`;
}

export function toDraft(note: RememberNote): NoteDraft {
  return {
    title: note.title,
    body: note.body,
    color: note.color,
    checklist: note.checklist,
    reminderEnabled: Boolean(note.reminder_date),
    reminderDate: note.reminder_date ?? '',
    reminderTime: note.reminder_time ?? '',
    reminderRepeatDaily: note.reminder_repeat_daily === true,
  };
}

export function normalizeReminder(draft: NoteDraft): {
  reminder_date: string | null;
  reminder_time: string | null;
  reminder_label: string | null;
  reminder_repeat_daily: boolean;
} {
  if (!draft.reminderEnabled || !draft.reminderDate) {
    return { reminder_date: null, reminder_time: null, reminder_label: null, reminder_repeat_daily: false };
  }
  return {
    reminder_date: draft.reminderDate,
    reminder_time: draft.reminderTime || null,
    reminder_label: null,
    reminder_repeat_daily: draft.reminderRepeatDaily,
  };
}
