import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { api } from '../../api/client';
import type { Page, InfiniteDoc } from '../../types';

type ExcalidrawDoc = Extract<InfiniteDoc, { excalidraw: true }>;
const emptyDoc = (): ExcalidrawDoc => ({ excalidraw: true, version: 1, data: { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} } });
const serialize = (doc: ExcalidrawDoc) => JSON.stringify({
  elements: doc.data.elements,
  files: doc.data.files ?? {},
  appState: { viewBackgroundColor: doc.data.appState?.viewBackgroundColor ?? '#ffffff' },
});

/** The Infinite editor stores document changes, not zoom or selection changes. */
export function ExcalidrawRenderer({ page }: { page: Page }) {
  const legacy = 'tldraw' in page.content && page.content.tldraw === true;
  const unsupported = !legacy && !('excalidraw' in page.content && page.content.excalidraw === true);
  const [initial] = useState<ExcalidrawDoc>(() => !legacy && 'excalidraw' in page.content && page.content.excalidraw === true ? page.content : emptyDoc());
  const revision = useRef(page.revision);
  const saved = useRef(serialize(initial));
  const current = useRef(initial);
  const pending = useRef<ExcalidrawDoc | null>(null);
  const saving = useRef(false);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error' | 'conflict'>('saved');

  const save = useCallback(async (keepalive = false) => {
    if (saving.current || blocked.current || !pending.current) return;
    const next = pending.current;
    pending.current = null;
    saving.current = true;
    setStatus('saving');
    let failed = false;
    try {
      const result = await api.patchPage(page.id, { content: next, revision: revision.current }, { keepalive });
      revision.current = result.revision;
      saved.current = serialize(next);
      if (serialize(current.current) === saved.current) setStatus('saved');
    } catch (error) {
      failed = true;
      if (error instanceof Error && /\b409\b/.test(error.message)) {
        blocked.current = true;
        setStatus('conflict');
      } else setStatus('error');
    } finally {
      saving.current = false;
      if (serialize(current.current) !== saved.current) pending.current = current.current;
      else pending.current = null;
      if (pending.current && !blocked.current && !failed) {
        setStatus('pending');
        timer.current = setTimeout(() => { void save(); }, 800);
      }
    }
  }, [page.id]);

  useEffect(() => {
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void save(true);
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [save]);

  if (legacy) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--theme-muted)]" role="alert">
    Este quadro usa o formato antigo. O conteúdo original foi preservado; converta-o antes de editar.
  </div>;
  if (unsupported) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--theme-muted)]" role="alert">
    Formato de quadro desconhecido. O conteúdo original foi preservado.
  </div>;

  const downloadDraft = () => {
    const doc = current.current;
    const file = new Blob([JSON.stringify({ type: 'excalidraw', version: 2, source: 'Brain Core', ...doc.data })], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url; link.download = 'brain-core-infinite-rascunho.excalidraw'; link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="relative min-h-0 flex-1 bg-[var(--theme-card)]">
    <div className="absolute inset-0"><Excalidraw
      initialData={{ elements: initial.data.elements, appState: initial.data.appState, files: initial.data.files } as NonNullable<Parameters<typeof Excalidraw>[0]['initialData']>}
      onChange={(elements, appState, files) => {
        const next: ExcalidrawDoc = { excalidraw: true, version: 1, data: {
          elements: JSON.parse(JSON.stringify(elements)),
          files: JSON.parse(JSON.stringify(files)),
          appState: { viewBackgroundColor: appState.viewBackgroundColor },
        } };
        const serialized = serialize(next);
        if (serialized === serialize(current.current)) return;
        current.current = next;
        if (timer.current) clearTimeout(timer.current);
        if (serialized === saved.current && !saving.current) {
          pending.current = null;
          setStatus('saved');
        } else {
          pending.current = next;
          if (!blocked.current) {
            setStatus('pending');
            timer.current = setTimeout(() => { void save(); }, 800);
          }
        }
      }}
    /></div>
    <div className="absolute bottom-3 left-3 rounded-lg bg-[var(--theme-card)] px-2 py-1 text-xs text-[var(--theme-muted)]" role="status">
      {status === 'conflict' ? <span>Outra versão foi salva. <button type="button" onClick={downloadDraft}>Baixar rascunho</button> antes de recarregar.</span>
        : status === 'error' ? <button type="button" onClick={() => { void save(); }}>Falha ao salvar · tentar novamente</button>
        : status === 'saving' ? 'Salvando…' : status === 'pending' ? 'Alterações pendentes' : 'Salvo'}
    </div>
  </div>;
}
