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
  const [savingIcon, setSavingIcon] = useState(false);
  const [iconError, setIconError] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const resize = () => {
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [title]);

  const handleIconSelect = async (emoji: string) => {
    if (savingIcon) return;
    setAnchorRect(null);
    setSavingIcon(true);
    setIconError(false);
    try {
      await api.patchPage(pageId, { icon: emoji });
      onIconChange(emoji);
      onRefresh?.();
    } catch { setIconError(true); }
    finally { setSavingIcon(false); }
  };

  return (
    <div className="mb-5">
      <div className="flex items-start gap-3">
        {/* Ícone ao lado esquerdo do título */}
        <div className="relative shrink-0">
          {icon ? (
            <button
              type="button" disabled={savingIcon} aria-label="Trocar ícone"
              className="min-h-11 min-w-11 text-3xl sm:text-[2.5rem] leading-none rounded-lg hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)] transition-colors p-1 disabled:opacity-50"
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
              type="button" disabled={savingIcon}
              className="min-h-11 rounded-lg px-2 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)] transition-colors whitespace-nowrap disabled:opacity-50"
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
          aria-label="Título da página"
          className="min-w-0 flex-1 resize-none overflow-hidden rounded text-3xl sm:text-[2.5rem] font-bold text-[var(--theme-text)] bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] placeholder:text-[var(--theme-muted)] leading-tight whitespace-pre-wrap break-words"
          style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em' }}
          placeholder="Sem título"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
        />
      </div>
      {savingIcon && <p role="status" className="mt-2 text-xs text-[var(--theme-muted)]">Salvando ícone…</p>}
      {iconError && <p role="alert" className="mt-2 text-sm text-[var(--theme-text)]">Não foi possível salvar o ícone. Selecione-o novamente para tentar.</p>}
    </div>
  );
}

// ── Shared saved-selection ref (populated on editor blur) ──────────────────
// Both dropdowns receive this ref so they can restore selection before applying marks.
