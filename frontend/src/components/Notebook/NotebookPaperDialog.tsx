import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NotebookSheet } from '../../types';
import { PAPER_COLORS, PAPER_STYLES, paperBackground } from './notebookModel';

export function NotebookPaperDialog({ sheet, onApply, onClose }: {
  sheet: NotebookSheet; onApply: (settings: Pick<NotebookSheet, 'paper' | 'spacing' | 'tint'>, all: boolean) => void;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState(sheet.paper), [spacing, setSpacing] = useState(sheet.spacing), [tint, setTint] = useState(sheet.tint);
  const [all, setAll] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="notebook-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Estilo do papel" className="notebook-paper-dialog" onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('button,input,select') ?? [])];
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="notebook-dialog-heading"><div><h2>Seu papel, seu ritmo</h2><p>Troque o fundo. Sua escrita continua no lugar.</p></div><button type="button" aria-label="Fechar estilos" onClick={onClose}>×</button></div>
      <div className="notebook-paper-options" role="group" aria-label="Tipo de papel">
        {PAPER_STYLES.map(style => <button key={style.id} type="button" aria-pressed={paper === style.id} onClick={() => setPaper(style.id)}>
          <span className="notebook-paper-preview" style={{ backgroundColor: tint, ...paperBackground(style.id, spacing / 4) }}>
            {style.id === 'oxford' && <span className="notebook-margin" />}
          </span><span>{style.label}</span>
        </button>)}
      </div>
      <label className="notebook-setting-label">Espaçamento<select value={spacing} onChange={e => setSpacing(Number(e.target.value))}>
        <option value={24}>Estreito</option><option value={32}>Normal</option><option value={40}>Amplo</option>
      </select></label>
      <div className="notebook-setting-label">Cor do papel<div className="notebook-swatches" role="group" aria-label="Cor do papel">
        {PAPER_COLORS.map((c, i) => <button key={c} type="button" aria-label={['Creme', 'Branco', 'Sálvia', 'Azul suave'][i]} aria-pressed={tint === c} style={{ backgroundColor: c }} onClick={() => setTint(c)} />)}
      </div></div>
      <label className="notebook-checkbox"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />Aplicar a todas as folhas</label>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="notebook-primary" onClick={() => { onApply({ paper, spacing, tint }, all); onClose(); }}>Aplicar</button></footer>
    </div>
  </div>, document.body);
}
