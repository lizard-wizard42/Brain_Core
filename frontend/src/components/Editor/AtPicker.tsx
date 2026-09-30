import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { PageSummary } from '../../types';
import { renderPageIcon } from './editorUtils';

export interface AtPickerProps {
  pages: PageSummary[];
  query: string;
  position: { top: number; left: number };
  onSelect: (page: PageSummary) => void;
  onClose: () => void;
}

export function AtPicker({ pages, query, position, onSelect, onClose }: AtPickerProps) {
  const [selectionState, setSelectionState] = useState({ query: '', index: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() =>
    pages
      .filter(p => p.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8),
    [pages, query]
  );

  const selected = selectionState.query === query
    ? Math.min(selectionState.index, Math.max(0, filtered.length - 1))
    : 0;

  const updateSelected = useCallback((nextIndex: number) => {
    setSelectionState({ query, index: nextIndex });
  }, [query]);

  useEffect(() => {
    if (!filtered.length) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); updateSelected((selected + 1) % (filtered.length || 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); updateSelected((selected - 1 + (filtered.length || 1)) % (filtered.length || 1)); }
      else if (e.key === 'Enter') {
        const page = filtered[selected];
        if (!page) return;
        e.preventDefault();
        onSelect(page);
      }
      else if (e.key === 'Escape') onClose();
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

  if (!filtered.length) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl py-1 w-64"
      style={{ top: position.top, left: position.left }}
    >
      <div className="px-3 py-1.5 text-[11px] text-gray-600 border-b border-[#2a2a2a] mb-1">Linkar página</div>
      {filtered.map((p, i) => (
        <button
          key={p.id}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
            i === selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
          }`}
          onMouseEnter={() => updateSelected(i)}
          onMouseDown={e => e.preventDefault()}
          onClick={() => onSelect(p)}
        >
          <span className="text-base shrink-0 w-5 h-5 flex items-center justify-center">
            {renderPageIcon(p.icon)}
          </span>
          <span className="text-[13px] text-[#d4d4d4] truncate">{p.title}</span>
        </button>
      ))}
    </div>
  );
}

// ── Page Header (emoji above title, Notion-style) ─────────────────────────
