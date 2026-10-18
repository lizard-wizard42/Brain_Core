import { useState } from 'react';
import type { RememberNote } from '../../types';

export function NotasTrash({ notes, loading, error, onReload, onRestore }: {
  notes: RememberNote[]; loading: boolean; error: string | null;
  onReload: () => Promise<void>; onRestore: (note: RememberNote) => Promise<void>;
}) {
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  return <section aria-label="Lixeira de notas" className="space-y-4">
    <p className="text-sm text-[var(--theme-muted)]">Notas na lixeira não aparecem nas buscas nem geram novos lembretes. Ao restaurar, seus lembretes pendentes voltam a valer.</p>
    {restored && <p role="status" className="text-sm text-[var(--theme-text)]">Nota restaurada em Minhas notas.</p>}
    {loading ? <p role="status">Carregando lixeira…</p> : error ? <div role="alert">{error}<button type="button" onClick={() => void onReload()} className="ml-3 min-h-11 underline">Tentar novamente</button></div> : notes.length === 0 ? <p className="py-8 text-[var(--theme-muted)]">Nenhuma nota na lixeira.</p> :
      <ul className="space-y-3">{notes.map(note => <li key={note.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4">
        <div className="min-w-0 flex-1"><h2 className="break-words font-medium text-[var(--theme-text)]">{note.title || 'Sem título'}</h2><p className="line-clamp-2 break-words text-sm text-[var(--theme-muted)]">{note.body || note.checklist.map(item => item.text).join(' · ')}</p></div>
        <button type="button" disabled={busy !== null} aria-label={`Restaurar ${note.title || 'nota sem título'}`} className="min-h-11 rounded-xl border border-[var(--theme-border)] px-4 text-[var(--theme-link)]" onClick={async () => {
          setBusy(note.id); setRestoreError(null); setRestored(false);
          try { await onRestore(note); setRestored(true); } catch (err) { setRestoreError(err instanceof Error ? err.message : 'Não foi possível restaurar. Tente novamente.'); }
          finally { setBusy(null); }
        }}>{busy === note.id ? 'Restaurando…' : 'Restaurar'}</button>
      </li>)}</ul>}
    {restoreError && <p role="alert" className="text-red-500">{restoreError}</p>}
  </section>;
}
