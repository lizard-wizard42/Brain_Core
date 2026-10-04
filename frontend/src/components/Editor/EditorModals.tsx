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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-label="Inserir tabela" className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-5 sm:p-6 w-full max-w-xs flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--theme-text)] mb-0.5">Inserir tabela</h2>
          <p className="text-[12px] text-[var(--theme-muted)]">Defina o tamanho inicial</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label htmlFor="table-rows" className="text-[11px] text-[var(--theme-muted)] uppercase tracking-wider">Linhas</label>
            <input
              id="table-rows"
              ref={rowsRef}
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={e => setRows(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              className="min-h-11 w-full bg-[var(--theme-input)] border border-[var(--theme-border)] focus:border-[var(--theme-primary)] rounded-lg px-3 py-2 text-[14px] text-[var(--theme-text)] outline-none transition-colors text-center"
            />
          </div>
          <div className="flex items-end pb-2 text-[var(--theme-muted)] text-lg">×</div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label htmlFor="table-columns" className="text-[11px] text-[var(--theme-muted)] uppercase tracking-wider">Colunas</label>
            <input
              id="table-columns"
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={e => setCols(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              className="min-h-11 w-full bg-[var(--theme-input)] border border-[var(--theme-border)] focus:border-[var(--theme-primary)] rounded-lg px-3 py-2 text-[14px] text-[var(--theme-text)] outline-none transition-colors text-center"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            className="min-h-11 px-4 py-2 text-[13px] text-[var(--theme-muted)] hover:text-[var(--theme-text)] rounded-lg hover:bg-[var(--theme-hover)] transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="min-h-11 px-4 py-2 text-[13px] bg-[var(--theme-text)] text-[var(--theme-background)] font-medium rounded-lg hover:opacity-90 transition-colors"
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div role="dialog" aria-label="Nova sub-página" className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-5 sm:p-6 w-full max-w-sm flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--theme-text)] mb-0.5">Nova sub-página</h2>
          <p className="text-[12px] text-[var(--theme-muted)]">Será criada dentro desta página</p>
        </div>

        <input
          ref={inputRef}
          className="min-h-11 w-full bg-[var(--theme-input)] border border-[var(--theme-border)] focus:border-[var(--theme-primary)] rounded-xl px-4 py-2.5 text-[14px] text-[var(--theme-text)] outline-none transition-colors placeholder:text-[var(--theme-muted)]"
          aria-label="Nome da sub-página"
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
            className="min-h-11 px-4 py-2 text-[13px] text-[var(--theme-muted)] hover:text-[var(--theme-text)] rounded-lg hover:bg-[var(--theme-hover)] transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="min-h-11 px-4 py-2 text-[13px] bg-[var(--theme-text)] hover:opacity-90 text-[var(--theme-background)] rounded-lg transition-colors disabled:opacity-40"
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
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-label="Novo tipo de sub-página" className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-5 sm:p-6 w-full max-w-xs flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-[var(--theme-text)]">Novo tipo de sub-página</h2>
          <p className="text-[13px] text-[var(--theme-muted)]">Escolha o formato da sub-página.</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            autoFocus
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-[var(--theme-card)] border border-[var(--theme-border)] hover:bg-[var(--theme-hover)] hover:border-[var(--theme-primary)] transition-all text-left group"
            onClick={() => onSelect('note')}
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 text-xl group-hover:scale-110 transition-transform">
              📄
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--theme-text)]">Nota</div>
              <div className="text-[11px] text-[var(--theme-muted)]">Documento de texto rico com Markdown.</div>
            </div>
          </button>
          <button
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-[var(--theme-card)] border border-[var(--theme-border)] hover:bg-[var(--theme-hover)] hover:border-[var(--theme-primary)] transition-all text-left group"
            onClick={() => onSelect('infinite')}
          >
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 text-xl group-hover:scale-110 transition-transform">
              ♾️
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--theme-text)]">Infinite</div>
              <div className="text-[11px] text-[var(--theme-muted)]">Espaço livre para ideias sem limites.</div>
            </div>
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            className="min-h-11 px-4 py-2 text-[13px] text-[var(--theme-muted)] hover:text-[var(--theme-text)] rounded-lg hover:bg-[var(--theme-hover)] transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
