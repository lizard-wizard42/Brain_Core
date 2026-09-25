import { useEffect, useState } from 'react';
import type { RememberChecklistItem, RememberNote } from '../../types';
import { NOTAS_ICON_URL, NOTE_COLORS, emptyDraft, noteColor, todayIso, type NoteDraft } from './notasModel';

export function ColorDots({
  selected,
  onSelect,
}: {
  selected: RememberNote['color'];
  onSelect: (color: RememberNote['color']) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {NOTE_COLORS.map((color) => {
        return (
          <button
            key={color.id}
            type="button"
            aria-label={color.label}
            title={color.label}
            onClick={() => onSelect(color.id)}
            className={`relative h-7 w-7 rounded-full border transition-all hover:scale-105 ${
              selected === color.id ? 'border-white shadow-[0_0_0_2px_rgba(255,255,255,0.16)]' : 'border-white/15 hover:border-white/70'
            }`}
            style={{ backgroundColor: color.swatch }}
          >
            {selected === color.id && <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-black">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ChecklistEditor({
  items,
  dark = false,
  onChange,
}: {
  items: RememberChecklistItem[];
  dark?: boolean;
  onChange: (next: RememberChecklistItem[]) => void;
}) {
  const updateItem = (id: string, patch: Partial<RememberChecklistItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const removeItem = (id: string) => onChange(items.filter((item) => item.id !== id));

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(e) => updateItem(item.id, { checked: e.target.checked })}
            className={dark ? 'accent-white' : 'accent-black'}
          />
          <input
            value={item.text}
            onChange={(e) => updateItem(item.id, { text: e.target.value })}
            className={`flex-1 rounded-xl px-3 py-2 text-[13px] outline-none ${
              dark
                ? 'border border-white/10 bg-black/10 text-white placeholder:text-white/40'
                : 'border border-black/10 bg-white/55 text-[#1f1912] placeholder:text-[#7a6a57]'
            }`}
            placeholder="Item da checklist"
          />
          <button type="button" onClick={() => removeItem(item.id)} className={`w-8 h-8 rounded-lg ${dark ? 'text-white/65 hover:bg-white/10' : 'text-[#5a4a3b] hover:bg-black/5'}`}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { id: `item-${Date.now()}`, text: '', checked: false }])}
        className={`self-start rounded-full px-3 py-2 text-[12px] transition-colors ${dark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-white/60 text-[#2b241c] hover:bg-white/80'}`}
      >
        ☑ Checklist
      </button>
    </div>
  );
}

/** Rich note editor. Collapsed shows a "write a note" prompt + a search box;
 *  open shows the full draft form (title, body, checklist, color, reminder). */
export function NotasComposer({
  open,
  onOpen,
  onClose,
  onCreate,
  initialDraft,
  search,
  onSearchChange,
}: {
  open: boolean;
  onOpen: (kind?: 'note' | 'checklist' | 'reminder') => void;
  onClose: () => void;
  onCreate: (draft: NoteDraft) => Promise<void>;
  initialDraft: NoteDraft;
  search?: string;
  onSearchChange?: (value: string) => void;
}) {
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const composerColor = noteColor(draft.color);

  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft);
  }, [initialDraft, open]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await onCreate(draft);
      setDraft(emptyDraft());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <section className="rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] p-4">
        <div className="flex flex-col gap-4 rounded-xl bg-white/[0.03] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <button type="button" onClick={() => onOpen('note')} className="min-w-0 flex flex-1 items-center gap-3 text-left">
            <img src={NOTAS_ICON_URL} alt="Notas" className="h-10 w-10 shrink-0 rounded-xl bg-white/10 p-2 object-contain" draggable={false} />
            <span className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Notas</p>
              <p className="mt-1.5 text-[15px] text-gray-300">Escreva uma nota…</p>
            </span>
          </button>
          {onSearchChange && (
            <div className="w-full shrink-0 sm:max-w-[300px]">
              <input
                value={search ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buscar notas..."
                className="w-full rounded-xl border border-[#242424] bg-[#161616] px-4 py-2.5 text-[13px] text-white outline-none placeholder:text-gray-600 focus:border-[#3a3a3a]"
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-[28px] border p-5 shadow-[0_22px_60px_rgba(0,0,0,0.22)] origin-top animate-[composer-pop_180ms_ease-out] transition-colors"
      style={{ background: composerColor.card, borderColor: composerColor.border }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={NOTAS_ICON_URL} alt="Notas" className="h-10 w-10 rounded-2xl bg-white/35 p-2 object-contain" draggable={false} />
          <p className="text-[12px] uppercase tracking-[0.22em] text-[#6e5d47]">Notas</p>
        </div>
        <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-black/5 text-[20px] leading-none text-[#5a4c39] hover:bg-black/10">×</button>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <input
          value={draft.title}
          onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
          placeholder="Título"
          className="w-full rounded-2xl border border-black/8 bg-white/18 px-4 py-3 text-[18px] font-medium text-[#20180f] outline-none placeholder:text-[#7c6a54]"
        />
        <textarea
          value={draft.body}
          onChange={(e) => setDraft((c) => ({ ...c, body: e.target.value }))}
          placeholder="Escreva uma nota..."
          rows={4}
          className="w-full rounded-2xl border border-black/8 bg-white/16 px-4 py-3 text-[14px] text-[#20180f] outline-none placeholder:text-[#7c6a54] resize-none"
        />

        {!!draft.checklist.length && (
          <ChecklistEditor items={draft.checklist} onChange={(checklist) => setDraft((c) => ({ ...c, checklist }))} />
        )}

        <div className="flex flex-col gap-3 rounded-[22px] border border-black/8 bg-white/14 p-4">
          <div className="flex flex-wrap gap-2">
            {!draft.checklist.length && (
              <button type="button" onClick={() => setDraft((c) => ({ ...c, checklist: [...c.checklist, { id: `item-${Date.now()}`, text: '', checked: false }] }))} className="rounded-full bg-white/55 px-3 py-2 text-[12px] text-[#2b241c] hover:bg-white/80">
                ☑ Checklist
              </button>
            )}
            <button
              type="button"
              onClick={() => setDraft((c) => ({ ...c, reminderEnabled: !c.reminderEnabled, reminderDate: c.reminderDate || todayIso() }))}
              className={`rounded-full px-3 py-2 text-[12px] ${draft.reminderEnabled ? 'bg-[#17120d] text-white' : 'bg-white/55 text-[#2b241c] hover:bg-white/80'}`}
            >
              📅 Lembrar
            </button>
          </div>

          <ColorDots selected={draft.color} onSelect={(color) => setDraft((c) => ({ ...c, color }))} />

          {draft.reminderEnabled && (
            <div className="grid gap-2 md:grid-cols-2">
              <input type="date" value={draft.reminderDate} onChange={(e) => setDraft((c) => ({ ...c, reminderDate: e.target.value }))} className="rounded-xl border border-black/8 bg-white/18 px-3 py-2 text-[13px] text-[#20180f] outline-none" />
              <input type="time" value={draft.reminderTime} onChange={(e) => setDraft((c) => ({ ...c, reminderTime: e.target.value }))} className="rounded-xl border border-black/8 bg-white/18 px-3 py-2 text-[13px] text-[#20180f] outline-none" />
              <label className="md:col-span-2 flex items-center gap-2 text-[13px] text-[#4f4436]">
                <input type="checkbox" checked={draft.reminderRepeatDaily} onChange={(e) => setDraft((c) => ({ ...c, reminderRepeatDaily: e.target.checked }))} className="accent-[#17120d]" />
                Repetir diariamente
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" disabled={saving} onClick={handleCreate} className="rounded-2xl bg-[#17120d] px-4 py-3 text-[13px] font-medium text-white hover:bg-black transition-colors disabled:opacity-50">
            {saving ? 'Salvando…' : '📝 Criar nota'}
          </button>
        </div>
      </div>
    </section>
  );
}
