import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { api } from '../../api/client';
import type { PageSummary } from '../../types';

type Destination = { id: string; title: string; icon?: string | null };
type Heading = { position: number; level: number; text: string };

function editorHeadings(editor: Editor): Heading[] {
  const headings: Heading[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      headings.push({ position, level: Number(node.attrs.level), text: node.textContent });
    }
  });
  return headings;
}

export function PageNavigation({ pageId, title, editor, onNavigate }: {
  pageId: string; title: string; editor: Editor | null; onNavigate?: (page: Destination) => void;
}) {
  const [path, setPath] = useState<Destination[]>([]);
  const [pathError, setPathError] = useState(false);
  const [pathAttempt, setPathAttempt] = useState(0);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [incoming, setIncoming] = useState<PageSummary[]>([]);
  const [referencesState, setReferencesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [referencesAttempt, setReferencesAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api.getPagePath(pageId).then(value => { if (active) { setPath(value); setPathError(false); } })
      .catch(() => { if (active) setPathError(true); });
    return () => { active = false; };
  }, [pageId, pathAttempt]);

  useEffect(() => {
    if (!editor) return;
    const update = () => setHeadings(editorHeadings(editor));
    update(); editor.on('update', update);
    return () => { editor.off('update', update); };
  }, [editor]);

  useEffect(() => {
    if (!referencesOpen) return;
    let active = true;
    api.getReferences(pageId).then(value => {
      if (active) { setIncoming(value.incoming); setReferencesState('ready'); }
    }).catch(() => { if (active) setReferencesState('error'); });
    return () => { active = false; };
  }, [pageId, referencesOpen, referencesAttempt]);

  const pageLink = (page: Destination) => <a href={`/page/${page.id}`} className="inline-flex min-h-11 items-center rounded px-2 hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]"
    onClick={event => {
      if (onNavigate && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(page); }
    }}>{page.title || 'Sem título'}</a>;

  return <div className="mb-6 space-y-3 text-xs text-[var(--theme-muted)]">
    <nav aria-label="Caminho da página">
      <ol className="flex flex-wrap items-center gap-1 break-words">
        {path.filter(p => p.id !== pageId).map(p => <li key={p.id} className="flex min-w-0 items-center gap-1">{pageLink(p)}<span aria-hidden="true">›</span></li>)}
        <li aria-current="page" className="min-w-0 break-words px-2 py-3 text-[var(--theme-text)]">{title || 'Sem título'}</li>
      </ol>
      {pathError && <p role="alert">Caminho indisponível. <button type="button" className="min-h-11 underline" onClick={() => setPathAttempt(n => n + 1)}>Tentar carregar caminho</button></p>}
    </nav>
    <div className="grid gap-2 sm:grid-cols-2">
      <details className="min-w-0 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)]">
        <summary className="min-h-11 cursor-pointer px-3 py-3 font-medium text-[var(--theme-text)]">Nesta página · {headings.length}</summary>
        <nav aria-label="Sumário da página" className="max-h-64 overflow-y-auto border-t border-[var(--theme-border)] p-2">
          {!headings.length && <p className="p-2">Adicione títulos ao texto para criar o sumário.</p>}
          <ol>{headings.map(h => <li key={h.position}><button type="button" className="min-h-11 w-full break-words rounded py-2 pr-2 text-left hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]"
            style={{ paddingLeft: 8 + (h.level - 1) * 12 }} onClick={() => {
              if (!editor || editor.isDestroyed) return;
              editor.chain().setTextSelection(h.position + 1).focus().run();
              const node = editor.view.nodeDOM(h.position);
              if (node instanceof HTMLElement) node.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }}>{h.text}</button></li>)}</ol>
        </nav>
      </details>
      <details className="min-w-0 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)]" onToggle={event => {
        const open = event.currentTarget.open;
        if (open) setReferencesState('loading');
        setReferencesOpen(open);
      }}>
        <summary className="min-h-11 cursor-pointer px-3 py-3 font-medium text-[var(--theme-text)]">Páginas que citam esta</summary>
        <div className="max-h-64 overflow-y-auto border-t border-[var(--theme-border)] p-2">
          {referencesState === 'loading' && <p role="status" className="p-2">Carregando referências…</p>}
          {referencesState === 'error' && <p role="alert" className="p-2">Não foi possível carregar. <button type="button" className="min-h-11 underline" onClick={() => { setReferencesState('loading'); setReferencesAttempt(n => n + 1); }}>Tentar novamente</button></p>}
          {referencesState === 'ready' && (incoming.length ? <ul>{incoming.map(p => <li key={p.id} className="break-words">{pageLink(p)}</li>)}</ul> : <p className="p-2">Nenhuma referência recebida nas suas páginas.</p>)}
        </div>
      </details>
    </div>
  </div>;
}
