import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GRID = 8;
const MAX = 20;

export function NewTableModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (rows: number, cols: number, withHeaderRow: boolean) => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => { gridRef.current?.focus(); }, []);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const clamp = (v: string, d: number) => Math.max(1, Math.min(MAX, parseInt(v, 10) || d));
  const confirmNumeric = () => onConfirm(clamp(rows, 3), clamp(cols, 3), withHeaderRow);
  const confirmGrid = (r: number, c: number) => onConfirm(r, c, withHeaderRow);

  const onGridKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover(h => ({ ...h, c: Math.min(GRID, h.c + 1 || 1) }));
    else if (e.key === 'ArrowLeft') setHover(h => ({ ...h, c: Math.max(1, h.c - 1) }));
    else if (e.key === 'ArrowDown') setHover(h => ({ ...h, r: Math.min(GRID, h.r + 1 || 1) }));
    else if (e.key === 'ArrowUp') setHover(h => ({ ...h, r: Math.max(1, h.r - 1) }));
    else if (e.key === 'Enter' && hover.r && hover.c) confirmGrid(hover.r, hover.c);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-white mb-0.5">Inserir tabela</h2>
          <p className="text-[12px] text-gray-600">{hover.r && hover.c ? `${hover.r} × ${hover.c}` : 'Passe o mouse na grade ou digite o tamanho'}</p>
        </div>

        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onGridKey}
          onMouseLeave={() => setHover({ r: 0, c: 0 })}
          className="grid gap-1 outline-none focus:ring-1 focus:ring-[#444] rounded p-1 self-center"
          style={{ gridTemplateColumns: `repeat(${GRID}, 1.25rem)` }}
        >
          {Array.from({ length: GRID * GRID }).map((_, i) => {
            const r = Math.floor(i / GRID) + 1;
            const c = (i % GRID) + 1;
            const on = r <= hover.r && c <= hover.c;
            return (
              <button
                key={i}
                data-testid={`grid-cell-${r}-${c}`}
                onMouseEnter={() => setHover({ r, c })}
                onClick={() => confirmGrid(r, c)}
                className={`h-5 w-5 rounded-[3px] border ${on ? 'bg-white/80 border-white' : 'bg-[#111] border-[#2a2a2a]'}`}
              />
            );
          })}
        </div>

        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label htmlFor="tbl-rows" className="text-[11px] text-gray-600 uppercase tracking-wider">Linhas</label>
            <input id="tbl-rows" type="number" min={1} max={MAX} value={rows}
              onChange={e => setRows(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmNumeric(); }}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[14px] text-white outline-none transition-colors text-center" />
          </div>
          <div className="flex items-end pb-2 text-gray-600 text-lg">×</div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label htmlFor="tbl-cols" className="text-[11px] text-gray-600 uppercase tracking-wider">Colunas</label>
            <input id="tbl-cols" type="number" min={1} max={MAX} value={cols}
              onChange={e => setCols(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmNumeric(); }}
              className="w-full bg-[#111] border border-[#2a2a2a] focus:border-[#444] rounded-lg px-3 py-2 text-[14px] text-white outline-none transition-colors text-center" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-gray-400 select-none">
          <input type="checkbox" checked={withHeaderRow} onChange={e => setWithHeaderRow(e.target.checked)} />
          Linha de cabeçalho
        </label>

        <div className="flex gap-2 justify-end">
          <button className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 transition-colors" onClick={onClose}>Cancelar</button>
          <button className="px-4 py-2 text-[13px] bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors" onClick={confirmNumeric}>Inserir</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
