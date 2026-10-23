import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { SearchResult, TreePage } from '../../types';

export function Highlight({ text, query }: { text: string; query: string }) {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const spans: { start: number; end: number }[] = [];
  let normalized = '', index = 0;
  for (const character of text) {
    const part = fold(character);
    for (let i = 0; i < part.length; i++) spans.push({ start: index, end: index + character.length });
    normalized += part; index += character.length;
  }
  const needle = fold(query.trim());
  const found = needle ? normalized.indexOf(needle) : -1;
  if (found < 0) return <>{text}</>;
  const start = spans[found].start, end = spans[found + needle.length - 1].end;
  return <>{text.slice(0, start)}<mark className="rounded text-inherit" style={{ background: 'color-mix(in srgb, var(--theme-primary) 25%, transparent)' }}>{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

function Results({ query, kind, mode, onPageClick, onClose }: { query: string; kind: string; mode: 'text' | 'semantic'; onPageClick?: (p: TreePage) => void; onClose?: () => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SearchResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError(false);
      api.searchNotes(query, kind, offset, controller.signal, mode).then(result => {
        if (controller.signal.aborted) return;
        setItems(previous => offset ? [...previous, ...result.items] : result.items);
        setNext(result.next_offset); setLoading(false);
      }).catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, mode, offset, retry]);
  return <div className="flex flex-col gap-1">
    {items.map(item => <button key={`${item.kind}-${item.id}`} type="button"
      className="min-h-11 rounded-md px-2 py-2 text-left hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]"
      onClick={() => {
        if (item.kind === 'note') navigate(`/notes?note=${encodeURIComponent(item.id)}`);
        else if (onPageClick) onPageClick({ ...item, slug: item.id, sort_order: 0, children: [] });
        else navigate(`/page/${item.id}`);
        onClose?.();
      }}>
      <div className="flex items-center justify-between gap-1">
        <span className="block truncate text-[12px] font-medium text-[var(--theme-text)]" title={item.title || 'Sem título'}>
          {mode === 'semantic' ? (item.title || 'Sem título') : <Highlight text={item.title || 'Sem título'} query={query} />}
        </span>
        {typeof item.score === 'number' && (
          <span className="shrink-0 rounded bg-[var(--theme-hover)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--theme-primary)]" title="Pontuação de similaridade semântica">
            {Math.round(item.score * 100)}%
          </span>
        )}
      </div>
      <span className="mt-0.5 block truncate text-[10px] text-[var(--theme-muted)]">{item.kind === 'note' ? 'Nota rápida' : item.path.map(p => p.title || 'Sem título').join(' › ')}</span>
      {item.snippet && <span className="mt-1 line-clamp-2 break-words text-[11px] text-[var(--theme-muted)]">
        {mode === 'semantic' ? item.snippet : <Highlight text={item.snippet} query={query} />}
      </span>}
    </button>)}
    {loading && <p role="status" className="p-2 text-xs">Pesquisando…</p>}
    {error && <div role="alert" className="p-2 text-xs">Não foi possível pesquisar. <button type="button" className="min-h-11 underline" onClick={() => { setLoading(true); setError(false); setRetry(r => r + 1); }}>Tentar novamente</button></div>}
    {!loading && !error && !items.length && <p role="status" className="p-2 text-xs">Nenhuma correspondência em {kind === 'pages' ? 'páginas' : kind === 'notes' ? 'notas rápidas' : 'páginas e notas rápidas'}.</p>}
    {next !== null && !error && <button type="button" disabled={loading} className="min-h-11 rounded-lg border border-[var(--theme-border)] text-xs disabled:opacity-50" onClick={() => { setLoading(true); setOffset(next); }}>Carregar mais resultados</button>}
  </div>;
}

export function UnifiedSearchResults(props: { query: string; onPageClick?: (p: TreePage) => void; onClose?: () => void }) {
  const [kind, setKind] = useState('all');
  const [mode, setMode] = useState<'text' | 'semantic'>('text');
  return <section aria-label="Resultados da busca" className="px-1 text-[var(--theme-muted)]">
    <div className="mb-2 flex items-center justify-between gap-1 rounded-lg border border-[var(--theme-border)] p-1 text-[11px]">
      <button
        type="button"
        className={`flex-1 rounded py-1 text-center font-medium transition-colors ${mode === 'text' ? 'bg-[var(--theme-primary)] text-white' : 'hover:bg-[var(--theme-hover)]'}`}
        onClick={() => setMode('text')}
      >
        Padrão
      </button>
      <button
        type="button"
        className={`flex-1 rounded py-1 text-center font-medium transition-colors ${mode === 'semantic' ? 'bg-[var(--theme-primary)] text-white' : 'hover:bg-[var(--theme-hover)]'}`}
        onClick={() => setMode('semantic')}
        title="Busca por significado via IA / Embeddings locais"
      >
        🧠 Semântica (IA)
      </button>
    </div>
    <label className="mb-3 block text-xs">Pesquisar em
      <select className="mt-1 min-h-11 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-[var(--theme-text)]" value={kind} onChange={e => setKind(e.target.value)}>
        <option value="all">Páginas e notas rápidas</option><option value="pages">Páginas</option><option value="notes">Notas rápidas</option>
      </select>
    </label>
    <Results key={`${props.query}-${kind}-${mode}`} {...props} kind={kind} mode={mode} />
  </section>;
}
