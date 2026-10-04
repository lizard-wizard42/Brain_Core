import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { PageSummary } from '../../types';
import { renderPageIcon } from './editorUtils';

export interface AtPickerProps {
  pages: PageSummary[];
  query: string;
  position: { top: number; left: number };
  onSelect: (page: PageSummary) => void;
  onClose: () => void;
}

function searchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function AtPicker({ pages, query, position, onSelect, onClose }: AtPickerProps) {
  const [selectionState, setSelectionState] = useState({ query: '', index: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState(position);
  const matches = useMemo(() => {
    const needle = searchText(query);
    return pages.filter(page => searchText(page.title).includes(needle));
  }, [pages, query]);
  const filtered = useMemo(() => matches.slice(0, 8), [matches]);
  const pageById = useMemo(() => new Map(pages.map(page => [page.id, page])), [pages]);

  const selected = selectionState.query === query
    ? Math.min(selectionState.index, Math.max(0, filtered.length - 1))
    : 0;
  const updateSelected = useCallback((index: number) => setSelectionState({ query, index }), [query]);

  // Measure the rendered menu: result counts and translated titles change its height.
  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8;
      const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
      const next = {
        left: Math.max(leftEdge, Math.min(position.left, rightEdge - box.width)),
        top: Math.max(topEdge, Math.min(position.top, bottomEdge - box.height)),
      };
      setPlacement(previous => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [position.left, position.top, filtered.length]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // With no match, Enter and arrows keep their normal editor behavior.
      if (!filtered.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
        updateSelected(next);
        ref.current?.querySelectorAll<HTMLButtonElement>('[data-page-option]')[next]?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onSelect(filtered[selected]);
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [filtered, onClose, onSelect, selected, updateSelected]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} role="region" aria-label="Referenciar página"
      className="fixed z-[200] w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text)] shadow-2xl"
      style={{ top: placement.top, left: placement.left, maxHeight: 'calc(100dvh - 16px)' }}>
      <div className="border-b border-[var(--theme-border)] px-3 py-2">
        <p className="text-sm font-medium">Referenciar página</p>
        <p className="mt-0.5 text-xs text-[var(--theme-muted)]">Insere um link para uma página existente.</p>
      </div>
      {filtered.length === 0 ? (
        <div role="status" className="px-3 py-4 text-sm text-[var(--theme-muted)]">
          {pages.length === 0 ? 'Não há páginas disponíveis para referenciar.' : <>Nenhuma página encontrada para “{query.trim()}”.</>}
          <p className="mt-2 text-xs">{pages.length ? 'Tente outro nome ou pressione Esc para fechar.' : 'Pressione Esc para fechar.'}</p>
        </div>
      ) : (
        <div className="py-1">
          {filtered.map((page, index) => {
            const parent = page.parent_page_id ? pageById.get(page.parent_page_id) : null;
            const context = parent ? parent.title || 'Sem título' : page.parent_page_id ? 'Página vinculada' : 'Página principal';
            return <button key={page.id} type="button" data-page-option
              aria-current={index === selected ? 'true' : undefined}
              className={`flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--theme-primary)] ${index === selected ? 'bg-[var(--theme-hover)]' : 'hover:bg-[var(--theme-hover)]'}`}
              onMouseEnter={() => updateSelected(index)} onFocus={() => updateSelected(index)}
              onMouseDown={e => e.preventDefault()} onClick={() => onSelect(page)}>
              <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center text-base">{renderPageIcon(page.icon)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{page.title || 'Sem título'}</span>
                <span className="block truncate text-xs text-[var(--theme-muted)]">{context}</span>
              </span>
            </button>;
          })}
        </div>
      )}
      {filtered.length > 0 && <div className="border-t border-[var(--theme-border)] px-3 py-2 text-xs text-[var(--theme-muted)]">
        {matches.length > 8 ? 'Mostrando 8 resultados. Digite mais para filtrar.' : '↑ ↓ navegar · Enter inserir · Esc fechar'}
      </div>}
    </div>
  );
}
