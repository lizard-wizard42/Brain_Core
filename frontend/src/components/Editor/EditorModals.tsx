import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function NewTableModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (rows: number, cols: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const rowsRef = useRef<HTMLInputElement>(null);

  useEffect(() => { rowsRef.current?.focus(); }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleConfirm = () => {
    const r = Math.max(1, Math.min(20, parseInt(rows) || 3));
    const c = Math.max(1, Math.min(20, parseInt(cols) || 3));
    onConfirm(r, c);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-white mb-0.5">Inserir tabela</h2>
          <p className="text-[12px] text-gray-600">Defina o tamanho inicial</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[11px] text-gray-600 uppercase tracking-wider">Linhas</label>
            <input
              ref={rowsRef}
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={e => setRows(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[14px] text-white outline-none transition-colors text-center"
            />
          </div>
          <div className="flex items-end pb-2 text-gray-600 text-lg">×</div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[11px] text-gray-600 uppercase tracking-wider">Colunas</label>
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={e => setCols(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[14px] text-white outline-none transition-colors text-center"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-2 text-[13px] bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors"
            onClick={handleConfirm}
          >
            Inserir
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── New Sub-Page Modal ─────────────────────────────────────────────────────

export function NewSubPageModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (title: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleConfirm = () => {
    if (value.trim()) onConfirm(value.trim());
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl shadow-2xl p-6 w-96 flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-white mb-0.5">Nova sub-página</h2>
          <p className="text-[12px] text-gray-600">Será criada dentro desta página</p>
        </div>

        <input
          ref={inputRef}
          className="w-full bg-[#111] border border-[#2a2a2a] focus:border-accent rounded-xl px-4 py-2.5 text-[14px] text-gray-100 outline-none transition-colors placeholder-[#444]"
          placeholder="Nome da sub-página…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') onClose();
          }}
        />

        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-2 text-[13px] bg-accent hover:bg-accent/90 text-white rounded-lg transition-colors disabled:opacity-40"
            disabled={!value.trim()}
            onClick={handleConfirm}
          >
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}

export function TypeSelectorModal({
  onSelect,
  onClose,
}: {
  onSelect: (type: 'note' | 'infinite') => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-white">Novo tipo de sub-página</h2>
          <p className="text-[13px] text-gray-400">Escolha o formato da sub-página.</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            autoFocus
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-left group"
            onClick={() => onSelect('note')}
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 text-xl group-hover:scale-110 transition-transform">
              📄
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-white">Nota</div>
              <div className="text-[11px] text-gray-500">Documento de texto rico com Markdown.</div>
            </div>
          </button>
          <button
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-left group"
            onClick={() => onSelect('infinite')}
          >
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 text-xl group-hover:scale-110 transition-transform">
              ♾️
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-white">Infinite</div>
              <div className="text-[11px] text-gray-500">Espaço livre para ideias sem limites.</div>
            </div>
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
