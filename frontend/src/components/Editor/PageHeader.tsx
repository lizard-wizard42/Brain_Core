import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { EmojiPicker } from '../shared/EmojiPicker';
import { renderPageIcon } from './editorUtils';

export interface PageHeaderProps {
  pageId: string;
  icon: string | null | undefined;
  title: string;
  onIconChange: (icon: string) => void;
  onTitleChange: (title: string) => void;
  onRefresh?: () => void;
}

export function PageHeader({ pageId, icon, title, onIconChange, onTitleChange, onRefresh }: PageHeaderProps) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const handleIconSelect = async (emoji: string) => {
    onIconChange(emoji);
    try {
      await api.patchPage(pageId, { icon: emoji || undefined });
      onRefresh?.();
    } catch { /* silent */ }
    setAnchorRect(null);
  };

  return (
    <div className="mb-6 group/header">
      <div className="flex items-center gap-3">
        {/* Ícone ao lado esquerdo do título */}
        <div className="relative shrink-0">
          {icon ? (
            <button
              className="text-[2.5rem] leading-none rounded-lg hover:bg-white/5 transition-colors p-1"
              title="Trocar ícone"
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAnchorRect(r => (r ? null : rect));
              }}
            >
              {renderPageIcon(icon, '📄')}
            </button>
          ) : (
            <button
              className="text-xs text-gray-700 hover:text-gray-400 transition-colors opacity-0 group-hover/header:opacity-100 whitespace-nowrap"
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                setAnchorRect(r => (r ? null : rect));
              }}
            >
              + ícone
            </button>
          )}
          {anchorRect && (
            <EmojiPicker
              anchorRect={anchorRect}
              onSelect={handleIconSelect}
              onClose={() => setAnchorRect(null)}
            />
          )}
        </div>

        {/* Título */}
        <textarea
          ref={titleRef}
          rows={1}
          className="flex-1 resize-none overflow-hidden text-[2.5rem] font-bold text-white bg-transparent outline-none placeholder-[#333] leading-tight whitespace-pre-wrap break-words"
          style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em' }}
          placeholder="Sem título"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Shared saved-selection ref (populated on editor blur) ──────────────────
// Both dropdowns receive this ref so they can restore selection before applying marks.
