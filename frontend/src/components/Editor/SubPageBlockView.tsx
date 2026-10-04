import { useState, useEffect, useRef, useId } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

interface SubPageBlockViewProps extends NodeViewProps {
  onRefresh?: () => void;
  onNavigatePage?: (page: { id: string; title: string; icon?: string | null }, openInNewTab?: boolean) => void;
}

export function SubPageBlockView({ node, updateAttributes, deleteNode, onRefresh, onNavigatePage }: SubPageBlockViewProps) {
  const { pageId, title, icon, source } = node.attrs as { pageId: string; title: string; icon: string; source?: 'child' | 'reference' };
  const isReference = source === 'reference';
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const restoreRenameFocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
    else if (restoreRenameFocus.current) {
      renameRef.current?.focus();
      restoreRenameFocus.current = false;
    }
  }, [renaming]);

  useEffect(() => {
    if (!showDeleteConfirm) return;
    cancelRef.current?.focus();
    const trigger = removeRef.current;
    return () => { trigger?.focus(); };
  }, [showDeleteConfirm]);

  const handleOpenPage = (openInNewTab = false) => {
    if (onNavigatePage) {
      onNavigatePage({ id: pageId, title, icon }, openInNewTab);
      return;
    }
    navigate('/page/' + pageId);
  };

  const finishRename = () => {
    restoreRenameFocus.current = true;
    setRenaming(false);
  };

  const handleRename = async () => {
    if (pending.current) return;
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === title) { setNewTitle(title); finishRename(); return; }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.renamePage(pageId, trimmed);
      updateAttributes({ title: trimmed });
      finishRename();
      onRefresh?.();
    } catch {
      setError('Não foi possível renomear a página. Tente novamente.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (pending.current) return;
    dialogRef.current?.focus();
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.deletePage(pageId);
    } catch {
      pending.current = false;
      setBusy(false);
      setError('Não foi possível mover a página para a lixeira. Tente novamente.');
      return;
    }
    setShowDeleteConfirm(false);
    deleteNode();
    onRefresh?.();
  };

  const actionClass = 'min-h-10 min-w-10 rounded-md px-2 text-sm text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)] disabled:opacity-50';

  return (
    <NodeViewWrapper className="group/subpage relative">
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          contentEditable={false}
          onMouseDown={e => { if (e.target === e.currentTarget && !pending.current) setShowDeleteConfirm(false); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId + '-title'}
            aria-describedby={dialogId + '-description'}
            aria-busy={busy}
            tabIndex={-1}
            className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6 text-[var(--theme-text)] shadow-2xl"
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape' && !pending.current) setShowDeleteConfirm(false);
              if (e.key !== 'Tab') return;
              const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
              const first = buttons[0];
              const last = buttons.at(-1);
              if (!first) { e.preventDefault(); return; }
              if (document.activeElement === dialogRef.current) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); return; }
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
              if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }}
          >
            <div className="flex flex-col gap-2">
              <h2 id={dialogId + '-title'} className="text-base font-semibold">Mover página para a lixeira?</h2>
              <p id={dialogId + '-description'} className="text-sm text-[var(--theme-muted)]">“{title || 'Sem título'}” irá para a lixeira. Você poderá restaurar a página depois.</p>
            </div>
            {error && <p role="alert" className="text-sm text-[var(--theme-text)]">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button ref={cancelRef} type="button" className={actionClass} disabled={busy} onClick={() => setShowDeleteConfirm(false)}>Cancelar</button>
              <button type="button" disabled={busy} onClick={() => { void handleDelete(); }}
                className="min-h-10 rounded-md bg-red-600 px-3 text-sm text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)] disabled:opacity-50">
                {busy ? 'Movendo…' : 'Mover para a lixeira'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="my-1 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1.5" contentEditable={false}>
        <div data-drag-handle className="cursor-grab px-1 text-[var(--theme-muted)] active:cursor-grabbing" title="Arrastar para reordenar">⠿</div>
        <span aria-hidden="true" className="shrink-0 text-base">{icon || (isReference ? '↗' : '📄')}</span>
        {renaming ? (
          <input
            ref={inputRef}
            aria-label="Nome da página"
            disabled={busy}
            className="min-h-10 min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-input)] px-2 text-sm text-[var(--theme-text)] focus:outline-[var(--theme-primary)]"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); void handleRename(); }
              if (e.key === 'Escape' && !pending.current) { setNewTitle(title); setError(null); finishRename(); }
            }}
          />
        ) : (
          <button type="button"
            aria-label={`Abrir ${isReference ? 'referência' : 'subpágina'}: ${title || 'Sem título'}`}
            className="min-h-10 min-w-0 flex-1 rounded text-left text-sm text-[var(--theme-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-primary)]"
            onClick={e => handleOpenPage(e.ctrlKey || e.metaKey)}
            onAuxClick={e => { if (e.button === 1) { e.preventDefault(); handleOpenPage(true); } }}
          >
            <span className="block truncate">{title || 'Sem título'}</span>
            <span className="block text-xs text-[var(--theme-muted)]">{isReference ? 'Referência' : 'Subpágina'}</span>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {renaming ? (
            <>
              <button type="button" className={actionClass} disabled={busy} onClick={() => { void handleRename(); }}>{busy ? 'Salvando…' : 'Salvar'}</button>
              <button type="button" className={actionClass} disabled={busy} onClick={() => { setNewTitle(title); setError(null); finishRename(); }}>Cancelar</button>
            </>
          ) : (
            <>
              <button ref={renameRef} type="button" title="Renomear página" aria-label="Renomear página" className={actionClass}
                onClick={() => { setError(null); setRenaming(true); setNewTitle(title); }}>✎</button>
              <button ref={removeRef} type="button" title={isReference ? 'Remover referência' : 'Mover página para a lixeira'}
                aria-label={isReference ? 'Remover referência' : 'Mover página para a lixeira'} className={actionClass}
                onClick={() => {
                  if (isReference) { deleteNode(); return; }
                  setError(null);
                  setShowDeleteConfirm(true);
                }}>×</button>
            </>
          )}
        </div>
        {error && !showDeleteConfirm && <p role="alert" className="w-full px-2 text-sm text-[var(--theme-text)]">{error}</p>}
      </div>
    </NodeViewWrapper>
  );
}
