import { useEffect, useId, useRef, useState } from 'react';
import type { PageSummary } from '../../types';
import { NotebookIcon } from '../Notebook/NotebookIcon';
import './newPageForm.css';

type PageFormat = PageSummary['type'];
const formats: Array<{ type: PageFormat; name: string; description: string }> = [
  { type: 'note', name: 'Nota', description: 'Texto, listas e documentos' },
  { type: 'infinite', name: 'Infinite', description: 'Ideias em uma tela sem limites' },
  { type: 'notebook', name: 'Caderno', description: 'Escrita à mão e desenhos' },
];

function FormatIcon({ type }: { type: PageFormat }) {
  if (type === 'notebook') return <NotebookIcon width={20} height={20} />;
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'note'
      ? <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>
      : <path d="M12 12c-2-3-3-5-5-5a5 5 0 100 10c2 0 3-2 5-5s3-5 5-5a5 5 0 110 10c-2 0-3-2-5-5z" />}
  </svg>;
}

/** The same creation control is used at the root and at every depth of the tree. */
export function NewPageForm({ title, onTitleChange, onCreate, onCancel, nested = false }: {
  title: string; onTitleChange: (title: string) => void; onCreate: (type: PageFormat) => Promise<void>;
  onCancel: () => void; nested?: boolean;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  const pending = useRef(false);
  const [creating, setCreating] = useState<PageFormat | null>(null);
  const [error, setError] = useState('');
  const submit = async (type: PageFormat) => {
    if (!title.trim() || pending.current) return;
    pending.current = true; setCreating(type); setError('');
    try { await onCreate(type); }
    catch { setError('Não foi possível criar a página. Confira a conexão e tente novamente.'); }
    finally { pending.current = false; setCreating(null); }
  };
  return <form ref={form} className="new-page-form" aria-label={nested ? 'Criar subpágina' : 'Criar página'} aria-busy={!!creating}
    onSubmit={e => { e.preventDefault(); e.stopPropagation(); void submit('note'); }}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!pending.current) onCancel(); } }}>
    <label className="new-page-label" htmlFor={`${id}-title`}>{nested ? 'Nova subpágina' : 'Nova página'}</label>
    <input id={`${id}-title`} autoFocus maxLength={160} placeholder="Título da página…" value={title} disabled={!!creating}
      onChange={e => onTitleChange(e.target.value)} />
    <span className="new-page-format-label" id={`${id}-formats`}>Escolha o formato</span>
    <div className="new-page-formats" role="group" aria-labelledby={`${id}-formats`}>
      {formats.map(format => <button key={format.type} type="button" className="new-page-format" data-format={format.type}
        aria-label={format.name} aria-describedby={`${id}-${format.type}`} disabled={!title.trim() || !!creating}
        onClick={() => { void submit(format.type); }}>
        <span className="new-page-format-icon"><FormatIcon type={format.type} /></span>
        <span className="new-page-format-copy"><strong>{format.name}</strong><span id={`${id}-${format.type}`}>{creating === format.type ? 'Criando…' : format.description}</span></span>
        <span className="new-page-format-arrow" aria-hidden="true">›</span>
      </button>)}
    </div>
    {creating && <span className="sr-only" role="status">Criando página…</span>}
    {error && <p className="new-page-error" role="alert">{error}</p>}
    <div className="new-page-form-footer"><button type="button" disabled={!!creating} onClick={onCancel}>Cancelar</button></div>
  </form>;
}
