import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import type { PageSummary } from '../../types';

interface TrashPanelProps {
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function TrashPanel({ onClose, onRefresh }: TrashPanelProps) {
  const [items, setItems] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [mounted, setMounted] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getTrash();
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleRestore = async (id: string) => {
    await api.restorePage(id);
    await onRefresh();
    await load();
  };

  const handlePermanentDelete = async (id: string) => {
    await api.permanentDeletePage(id);
    await load();
  };

  const handleEmptyTrash = async () => {
    await api.emptyTrash();
    setConfirmEmpty(false);
    await onRefresh();
    await load();
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-2xl shadow-2xl w-[min(640px,calc(100vw-2rem))] max-h-[70vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#252525]">
          <div className="flex items-center gap-2">
            <span className="text-base">🗑️</span>
            <h2 className="text-[14px] font-semibold text-white">Lixeira</h2>
          </div>
          <button
            className="text-gray-600 hover:text-gray-300 text-[18px] leading-none transition-colors"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="px-3 pb-2">
            <p className="rounded-lg border border-amber-500/15 bg-amber-500/6 px-3 py-2 text-[12px] leading-5 text-amber-200/85">
              Itens na lixeira sao apagados automaticamente apos 30 dias.
            </p>
          </div>
          {loading ? (
            <p className="text-center text-gray-600 text-[13px] py-8">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-600 text-[13px] py-8">A lixeira está vazia.</p>
          ) : (
            items.map(item => (
              <div
                key={item.id}
                className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.03] group"
              >
                <span className="text-sm shrink-0 pt-0.5">{item.icon || '📄'}</span>
                <span
                  className="flex-1 min-w-0 text-[13px] leading-5 text-[#c7c7c7] break-words"
                  title={item.title || 'Sem título'}
                >
                  {item.title || 'Sem título'}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pl-2">
                  <button
                    className="text-[11px] text-gray-500 hover:text-green-400 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                    onClick={() => handleRestore(item.id)}
                    title="Restaurar"
                  >
                    Restaurar
                  </button>
                  <button
                    className="text-[11px] text-gray-500 hover:text-red-400 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                    onClick={() => handlePermanentDelete(item.id)}
                    title="Apagar definitivamente"
                  >
                    Apagar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="px-5 py-3 border-t border-[#252525] flex justify-end">
            {confirmEmpty ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-gray-500">Apagar tudo permanentemente?</span>
                <button
                  className="text-[12px] text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-white/5 transition-colors"
                  onClick={() => setConfirmEmpty(false)}
                >
                  Cancelar
                </button>
                <button
                  className="text-[12px] text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                  onClick={handleEmptyTrash}
                >
                  Confirmar
                </button>
              </div>
            ) : (
              <button
                className="text-[12px] text-gray-600 hover:text-red-400 transition-colors"
                onClick={() => setConfirmEmpty(true)}
              >
                Esvaziar lixeira
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
