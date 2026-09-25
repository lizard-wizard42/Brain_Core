import { useEffect, useState } from 'react';
import type { RememberNote } from '../../types';
import { ChecklistEditor, ColorDots } from './NotasComposer';
import { noteColor, reminderBadge, todayIso, toDraft, type NoteDraft } from './notasModel';

export function NotasCard({
  note,
  onSave,
  onDelete,
}: {
  note: RememberNote;
  onSave: (note: RememberNote, draft: NoteDraft) => Promise<void>;
  onDelete: (note: RememberNote) => Promise<void>;
}) {
  const color = noteColor(note.color);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(() => toDraft(note));
  const [busy, setBusy] = useState(false);
  const editColor = noteColor(draft.color);

  useEffect(() => {
    setDraft(toDraft(note));
  }, [note]);

  const pendingCount = note.checklist.filter((item) => !item.checked).length;

  const save = async () => {
    setBusy(true);
    try {
      await onSave(note, draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(note);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className="group rounded-[18px] border p-4 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_18px_28px_rgba(0,0,0,0.18)]"
      style={{ background: color.card, borderColor: color.border, boxShadow: '0 10px 24px rgba(0,0,0,0.18)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] leading-tight font-semibold text-[#241b12] whitespace-pre-wrap break-words">{note.title || 'Sem título'}</h3>
          {reminderBadge(note) && (
            <span className={`inline-flex mt-2 rounded-full px-2.5 py-1 text-[11px] font-medium ${color.badge}`}>{reminderBadge(note)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          aria-label={editing ? 'Fechar edição' : 'Editar nota'}
          title={editing ? 'Fechar edição' : 'Editar nota'}
          className="shrink-0 rounded-xl bg-black/6 px-2.5 py-2 text-[15px] text-[#241b12] hover:bg-black/10"
        >
          {editing ? '×' : '✎'}
        </button>
      </div>

      {note.body && <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#33271b]">{note.body}</p>}

      {!!note.checklist.length && (
        <div className="mt-3 flex flex-col gap-2">
          {note.checklist.map((item) => (
            <label key={item.id} className="flex items-start gap-2 text-[12px] text-[#33271b]">
              <input type="checkbox" checked={item.checked} readOnly className="mt-0.5 accent-[#241b12]" />
              <span className={item.checked ? 'line-through opacity-60' : ''}>{item.text}</span>
            </label>
          ))}
          <div className="text-[11px] text-[#5e4c39]">{pendingCount} pendente(s)</div>
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-[18px] border p-3 animate-[composer-pop_160ms_ease-out]" style={{ background: editColor.card, borderColor: editColor.border }}>
          <div className="flex flex-col gap-3">
            <input
              value={draft.title}
              onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
              className="rounded-xl border border-black/8 bg-white/18 px-3 py-2 text-[13px] text-[#241b12] outline-none placeholder:text-[#7c6a54]"
              placeholder="Título"
            />
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((c) => ({ ...c, body: e.target.value }))}
              rows={4}
              className="rounded-xl border border-black/8 bg-white/16 px-3 py-2 text-[13px] text-[#33271b] outline-none placeholder:text-[#7c6a54] resize-none"
              placeholder="Texto da nota"
            />
            <ChecklistEditor items={draft.checklist} onChange={(checklist) => setDraft((c) => ({ ...c, checklist }))} />
            <ColorDots selected={draft.color} onSelect={(colorId) => setDraft((c) => ({ ...c, color: colorId }))} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDraft((c) => ({ ...c, checklist: c.checklist.length ? c.checklist : [{ id: `item-${Date.now()}`, text: '', checked: false }] }))}
                className="rounded-full bg-white/55 px-3 py-2 text-[12px] text-[#2b241c] hover:bg-white/80"
              >
                ☑ Checklist
              </button>
              <button
                type="button"
                onClick={() => setDraft((c) => ({ ...c, reminderEnabled: !c.reminderEnabled, reminderDate: c.reminderDate || todayIso() }))}
                className={`rounded-full px-3 py-2 text-[12px] ${draft.reminderEnabled ? 'bg-[#17120d] text-white' : 'bg-white/55 text-[#2b241c] hover:bg-white/80'}`}
              >
                📅 Lembrar
              </button>
            </div>
            {draft.reminderEnabled && (
              <div className="grid gap-2 md:grid-cols-2">
                <input type="date" value={draft.reminderDate} onChange={(e) => setDraft((c) => ({ ...c, reminderDate: e.target.value }))} className="rounded-xl border border-black/8 bg-white/18 px-3 py-2 text-[12px] text-[#241b12] outline-none" />
                <input type="time" value={draft.reminderTime} onChange={(e) => setDraft((c) => ({ ...c, reminderTime: e.target.value }))} className="rounded-xl border border-black/8 bg-white/18 px-3 py-2 text-[12px] text-[#241b12] outline-none" />
                <label className="md:col-span-2 flex items-center gap-2 text-[12px] text-[#4f4436]">
                  <input type="checkbox" checked={draft.reminderRepeatDaily} onChange={(e) => setDraft((c) => ({ ...c, reminderRepeatDaily: e.target.checked }))} className="accent-[#17120d]" />
                  Repetir diariamente
                </label>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button type="button" onClick={remove} disabled={busy} className="rounded-xl px-3 py-2 text-[12px] text-[#8a2b2b] hover:bg-red-500/10">Apagar</button>
              <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-black">{busy ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
