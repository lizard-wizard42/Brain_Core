import { useState, useEffect, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

interface SubPageBlockViewProps extends NodeViewProps {
  onRefresh?: () => void;
  onNavigatePage?: (page: { id: string; title: string; icon?: string | null }, openInNewTab?: boolean) => void;
}

export function SubPageBlockView({ node, updateAttributes, deleteNode, onRefresh, onNavigatePage }: SubPageBlockViewProps) {
  const { pageId, title, icon } = node.attrs as { pageId: string; title: string; icon: string };
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const handleOpenPage = (openInNewTab = false) => {
    if (onNavigatePage) {
      onNavigatePage({ id: pageId, title, icon }, openInNewTab);
      return;
    }
    navigate("/page/" + pageId);
  };

  const handleRename = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === title) { setRenaming(false); setNewTitle(title); return; }
    try {
      await api.renamePage(pageId, trimmed);
      updateAttributes({ title: trimmed });
      onRefresh?.();
    } catch (e) {
      if (String(e).includes('404')) deleteNode(); // página deletada, remove o bloco
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try { await api.deletePage(pageId); } catch { /* já deletada — remove o bloco mesmo assim */ }
    deleteNode();
    onRefresh?.();
  };

  return (
    <NodeViewWrapper className="group/subpage relative">
      {/* Confirm modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
        >
          <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-5" contentEditable={false}>
            <div className="flex flex-col gap-1">
              <h2 className="text-[15px] font-semibold text-white">Confirmar exclusão</h2>
              <p className="text-[13px] text-gray-400">Apagar "{title}"? Esta ação não pode ser desfeita.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 transition-colors"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 text-[13px] bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                onClick={handleDelete}
              >
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="my-1 flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#1e1e1e] hover:border-[#333] transition-colors group select-none"
        contentEditable={false}
      >
        {/* Drag handle */}
        <div
          data-drag-handle
          className="cursor-grab active:cursor-grabbing text-gray-800 hover:text-gray-500 transition-colors mr-0.5 opacity-0 group-hover:opacity-100"
          title="Arrastar para reordenar"
        >
          ⠿
        </div>

        {/* Ícone */}
        <span className="text-base shrink-0">{icon || '📄'}</span>

        {/* Título ou input de rename */}
        {renaming ? (
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[13px] text-gray-200 outline-none border-b border-accent/70"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setRenaming(false); setNewTitle(title); }
            }}
            onBlur={handleRename}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 text-[13px] text-[#d4d4d4] group-hover:text-white transition-colors truncate cursor-pointer"
            onClick={() => handleOpenPage()}
            onMouseDown={e => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              handleOpenPage(true);
            }}
          >
            {title || 'Sem título'}
          </span>
        )}

        {/* Ações — só aparecem no hover */}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            title="Renomear"
            className="text-gray-600 hover:text-gray-300 text-[10px] w-5 h-5 flex items-center justify-center rounded transition-colors"
            onClick={e => { e.stopPropagation(); setRenaming(true); setNewTitle(title); }}
          >
            ✏
          </button>
          <button
            title="Apagar"
            className="text-gray-600 hover:text-red-400 text-[10px] w-5 h-5 flex items-center justify-center rounded transition-colors"
            onClick={e => { e.stopPropagation(); setShowDeleteConfirm(true); }}
          >
            ✕
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
