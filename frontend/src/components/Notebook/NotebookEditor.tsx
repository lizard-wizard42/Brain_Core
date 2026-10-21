import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NotebookDoc, NotebookSheet, Page } from '../../types';
import { NotebookCanvas, type NotebookChangeOptions, type NotebookInput, type NotebookTool } from './NotebookCanvas';
import { NotebookIcon } from './NotebookIcon';
import { NotebookToolIcon } from './NotebookToolIcon';
import { NotebookPaperDialog } from './NotebookPaperDialog';
import { NotebookPopover } from './NotebookPopover';
import { useMediaQuery } from './useMediaQuery';
import { INK_COLORS, isNotebookDoc, newSheet, paperBackground } from './notebookModel';
import { useNotebookZoom, ZOOM_STEP } from './useNotebookZoom';
import { useNotebookDocument } from './useNotebookDocument';
import './notebook.css';

function downloadNotebook(document: NotebookDoc, title: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ title, content: document }, null, 2)], { type: 'application/json' }));
  const link = window.document.createElement('a'); link.href = url;
  link.download = `${title.replace(/[^\p{L}\p{N}\s_-]/gu, '').slice(0, 80) || 'caderno'}.brain-notebook.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const tools: Array<{ id: NotebookTool; label: string }> = [
  { id: 'pen', label: 'Caneta' }, { id: 'highlighter', label: 'Marca-texto' }, { id: 'eraser', label: 'Borracha' },
  { id: 'select', label: 'Selecionar' }, { id: 'text', label: 'Texto' }, { id: 'hand', label: 'Mover folha' },
];

const INK_NAMES = ['Grafite', 'Azul', 'Vermelho', 'Verde', 'Violeta', 'Amarelo'];
const WIDTHS = [1, 2, 4, 6];
const isTextField = (target: EventTarget | null) => !!(target as HTMLElement | null)?.matches?.('input,textarea,select,[contenteditable="true"]');

export function NotebookEditor({ page, onRefresh }: { page: Page; onRefresh?: () => void }) {
  const readOnly = page.access_role === 'viewer';
  const state = useNotebookDocument(page, readOnly, onRefresh);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [tool, setTool] = useState<NotebookTool>('pen'), [color, setColor] = useState(INK_COLORS[0]);
  const [width, setWidth] = useState(2), [finger, setFinger] = useState(false);
  const [showPaper, setShowPaper] = useState(false), [showPages, setShowPages] = useState(false);
  const [notice, setNotice] = useState(''), [input, setInput] = useState<NotebookInput | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const compact = useMediaQuery('(max-width: 550px)'), shortScreen = useMediaQuery('(max-height: 500px)');
  const scroller = useRef<HTMLDivElement>(null), importInput = useRef<HTMLInputElement>(null), exitFocus = useRef<HTMLButtonElement>(null);
  const { zoom, zoomTo, zoomBy, fit, toggleFit } = useNotebookZoom(scroller, page.id);
  // Focus mode: F toggles it (outside text fields), Escape leaves it. Kept in memory only.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusMode(false);
      else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(e.target) && !showPaper) setFocusMode(v => !v);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [showPaper]);
  useEffect(() => { if (focusMode) exitFocus.current?.focus(); }, [focusMode]);
  const doc = state.document;
  if (!doc) return <div className="notebook-error" role="alert">Não foi possível abrir este caderno. O conteúdo foi preservado; recarregue a página ou use um backup compatível.</div>;
  const index = Math.max(0, doc.sheets.findIndex(s => s.id === sheetId));
  const sheet = doc.sheets[index];
  const changeSheet = (next: NotebookSheet, options?: NotebookChangeOptions) => state.apply({ ...doc, sheets: doc.sheets.map(s => s.id === next.id ? next : s) }, undefined, options?.track !== false, options?.group);
  const limit = () => setNotice('Este caderno atingiu o limite de tamanho. Baixe uma cópia e continue em um novo caderno.');
  const chooseSheet = (id: string) => { setSheetId(id); scroller.current?.scrollTo?.(0, 0); };
  const addSheet = () => {
    const next = { ...newSheet(), paper: sheet.paper, spacing: sheet.spacing, tint: sheet.tint };
    if (state.apply({ ...doc, sheets: [...doc.sheets, next] })) chooseSheet(next.id); else limit();
  };
  const hideHeader = focusMode || shortScreen;
  const inkOff = state.locked || tool === 'eraser' || tool === 'hand' || tool === 'select';
  const saveLabel = readOnly ? 'Somente leitura' : !state.ready ? 'Abrindo…' : state.status === 'saved' ? '✓ Salvo' : state.status === 'saving' ? 'Salvando…' : state.status === 'conflict' ? 'Conflito de versões' : 'Não salvo no servidor';
  const removeSheet = () => {
    if (window.confirm('Remover esta folha do caderno? Você pode desfazer enquanto esta tela estiver aberta.')) {
      state.apply({ ...doc, sheets: doc.sheets.filter(s => s.id !== sheet.id) });
    }
  };
  const chip = <span role="status" aria-live="polite" className={`notebook-input-chip notebook-input-${input ? (input.smallTouch ? 'warn' : input.kind) : 'idle'}`}
    title="Mostra o último tipo de entrada recebido pela folha. Passar a caneta sobre a folha mostra um círculo azul.">
    {!input ? 'Passe a caneta sobre a folha para testar' : input.kind === 'pen' ? 'Caneta detectada'
      : input.kind === 'mouse' ? 'Mouse detectado' : input.smallTouch ? 'Toque fino: se for a S Pen, ative "Desenhar com dedo"' : 'Toque: o dedo move a folha'}
  </span>;
  const titleField = (id?: string) => <input id={id} aria-label="Título do caderno" value={state.title} maxLength={160} disabled={state.locked}
    onChange={e => { state.apply(doc, e.target.value, true, 'title'); }}
    onBlur={() => { if (!state.title.trim()) state.apply(doc, 'Caderno sem título'); void state.flush(); }} />;
  const item = (label: ReactNode, onClick: () => void, extra: { disabled?: boolean; pressed?: boolean } = {}) =>
    <button type="button" className="notebook-menu-item" disabled={extra.disabled} aria-pressed={extra.pressed} onClick={onClick}>{label}</button>;
  const moreItems = (close: () => void) => <>
    {hideHeader && !focusMode && <div className="notebook-menu-title">{titleField()}<span className="notebook-save">{saveLabel}</span></div>}
    {compact && item('Adicionar folha', () => { addSheet(); close(); }, { disabled: state.locked || doc.sheets.length >= 100 })}
    {item('Adicionar folhas de uma cópia', () => { importInput.current?.click(); close(); }, { disabled: state.locked })}
    {item('Remover folha atual', () => { close(); removeSheet(); }, { disabled: state.locked || doc.sheets.length === 1 })}
    {item('Modo foco', () => { close(); setFocusMode(true); })}
  </>;

  return <section className="notebook-editor" aria-label="Caderno" data-compact={compact || undefined} onKeyDown={e => {
    if (isTextField(e.target) || state.locked) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z') { e.preventDefault(); if (e.shiftKey) state.redo(); else state.undo(); }
    else if (key === 'y') { e.preventDefault(); state.redo(); }
  }}>
    {!hideHeader && <header className="notebook-header">
      <div className="notebook-heading-icon"><NotebookIcon width={24} height={24} /></div>
      <div className="notebook-heading">{!compact && <span>CADERNO</span>}{titleField()}</div>
      <div className="notebook-header-actions"><span role="status" aria-live="polite" className={`notebook-save notebook-save-${state.status}`}>{saveLabel}</span>
        <button type="button" className="notebook-button" onClick={() => downloadNotebook(doc, state.title)} title="Baixar cópia editável" aria-label="Baixar cópia editável"><NotebookToolIcon tool="download" /><span className="notebook-wide-label">Cópia</span></button></div>
    </header>}

    {state.recoverable && <div role="alert" className="notebook-banner">
      <span>{state.recoverable.baseRevision === page.revision ? 'Há um rascunho local ainda não salvo. Deseja recuperá-lo?' : 'Há um rascunho local de outra versão. Baixe a cópia antes de continuar para preservar as duas versões.'}</span>
      {state.recoverable.baseRevision === page.revision && <button type="button" onClick={state.recover}>Recuperar rascunho</button>}
      <button type="button" onClick={() => downloadNotebook(state.recoverable!.document, state.recoverable!.title)}>Baixar rascunho</button>
      <button type="button" onClick={state.dismissRecovery}>Usar versão do servidor</button>
    </div>}
    {(state.status === 'error' || state.status === 'conflict') && <div role="alert" className="notebook-banner">
      <span>{state.status === 'conflict' ? 'Outra sessão salvou uma versão mais recente. Baixe sua cópia e reabra o caderno para comparar.' : 'Não foi possível salvar no servidor. Sua escrita continua nesta tela; tente novamente ou baixe uma cópia.'}</span>
      {state.status === 'error' && <button type="button" onClick={() => void state.flush()}>Tentar salvar</button>}
      <button type="button" onClick={() => downloadNotebook(doc, state.title)}>Baixar minha cópia</button>
    </div>}
    {state.draftWarning && <div role="alert" className="notebook-banner">O navegador não conseguiu guardar o rascunho local. Mantenha a tela aberta até aparecer Salvo ou baixe uma cópia.</div>}
    {notice && <div role="alert" className="notebook-banner"><span>{notice}</span><button type="button" onClick={() => setNotice('')}>Fechar aviso</button></div>}

    {!focusMode && <div className="notebook-toolbar" role="toolbar" aria-label="Ferramentas de escrita">
      <div className="notebook-tool-group"><button type="button" className="notebook-button" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={state.locked || !state.canUndo} onClick={state.undo}><NotebookToolIcon tool="undo" /></button>
        <button type="button" className="notebook-button" title="Refazer (Ctrl+Y)" aria-label="Refazer" disabled={state.locked || !state.canRedo} onClick={state.redo}><NotebookToolIcon tool="redo" /></button></div>
      <div className="notebook-tool-group">{tools.filter(t => !compact || t.id !== 'hand').map(t => <button type="button" key={t.id} className="notebook-button notebook-tool" aria-label={t.label} title={t.id === 'eraser' ? 'Borracha: apaga traços inteiros' : t.label}
        aria-pressed={tool === t.id} disabled={state.locked && t.id !== 'hand'} onClick={() => setTool(t.id)}><NotebookToolIcon tool={t.id} /><span>{t.label}</span></button>)}</div>
      {compact
        ? <NotebookPopover label="Mais ferramentas" className="notebook-toolbar-more" trigger={<NotebookToolIcon tool="more" />}>{close => <>
          {item(<><NotebookToolIcon tool="hand" />Mover folha (mão)</>, () => { setTool('hand'); close(); }, { pressed: tool === 'hand' })}
          {item(<><NotebookToolIcon tool="paper" />Papel</>, () => { close(); setShowPaper(true); }, { disabled: state.locked })}
          {item('Desenhar com dedo', () => setFinger(v => !v), { disabled: state.locked, pressed: finger })}
          <div className="notebook-menu-chip">{chip}</div>
        </>}</NotebookPopover>
        : <button type="button" className="notebook-button" disabled={state.locked} onClick={() => setShowPaper(true)}><NotebookToolIcon tool="paper" />Papel</button>}
    </div>}

    {!focusMode && <div className="notebook-options" data-ink-off={inkOff || undefined}>
      <div className="notebook-swatches" role="group" aria-label="Cor da tinta" title={inkOff ? 'A ferramenta atual não usa cor' : undefined}>{INK_COLORS.map((c, i) => <button type="button" key={c} aria-label={INK_NAMES[i]} aria-pressed={color === c} style={{ '--ink': c } as React.CSSProperties} disabled={inkOff} onClick={() => setColor(c)}><span style={{ backgroundColor: c }} /></button>)}</div>
      {compact
        ? <NotebookPopover label="Espessura do traço" className="notebook-width-picker" trigger={<NotebookToolIcon tool="width" />}>{close =>
          WIDTHS.map(w => item(`${w} px`, () => { setWidth(w); close(); }, { pressed: width === w }))}</NotebookPopover>
        : <>
          <label>Traço<select aria-label="Espessura do traço" value={width} disabled={inkOff} onChange={e => setWidth(Number(e.target.value))}>{WIDTHS.map(w => <option key={w} value={w}>{w} px</option>)}</select></label>
          <label className="notebook-checkbox"><input type="checkbox" checked={finger} disabled={state.locked} onChange={e => setFinger(e.target.checked)} />Desenhar com dedo</label>
          <span className="notebook-options-hint">{tool === 'text' ? 'Toque na folha para inserir texto' : tool === 'select' ? 'Contorne e arraste para mover' : tool === 'eraser' ? 'Apaga traços inteiros' : 'Caneta escreve · dedo move a folha'}</span>
          {chip}
        </>}
    </div>}

    <div className="notebook-body">
      {showPages && !focusMode && <nav className="notebook-pages" aria-label="Folhas do caderno">
        <div className="notebook-pages-heading"><span>Folhas</span><button type="button" aria-label="Fechar folhas" onClick={() => setShowPages(false)}>×</button></div>
        {doc.sheets.map((s, i) => <button type="button" key={s.id} aria-current={s.id === sheet.id ? 'page' : undefined} onClick={() => chooseSheet(s.id)}>
          <span className="notebook-page-thumbnail" style={{ backgroundColor: s.tint, ...paperBackground(s.paper, s.spacing / 8) }}><svg viewBox="0 0 800 1120" aria-hidden="true">{s.strokes.slice(0, 50).map(stroke => <polyline key={stroke.id} points={stroke.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={Math.max(5, stroke.width)} />)}</svg></span><span>Folha {i + 1}</span>
        </button>)}
        <button type="button" className="notebook-add-sheet" disabled={state.locked || doc.sheets.length >= 100} onClick={addSheet}>+ Nova folha</button>
      </nav>}
      <div ref={scroller} className="notebook-workspace">
        <NotebookCanvas key={sheet.id} sheet={sheet} tool={tool} color={color} width={width} fingerDrawing={finger} zoom={zoom}
          locked={state.locked} onChange={changeSheet} onLimit={limit} onInput={setInput} onZoom={zoomTo} onDoubleTap={toggleFit} />
      </div>
    </div>

    {focusMode && <button ref={exitFocus} type="button" className="notebook-button notebook-focus-exit" aria-label="Sair do modo foco" title="Sair do modo foco (Esc)" onClick={() => setFocusMode(false)}><NotebookToolIcon tool="restore" /></button>}

    {!focusMode && <footer className="notebook-footer">
      <div><button type="button" className="notebook-button" aria-label="Folhas" aria-expanded={showPages} onClick={() => setShowPages(v => !v)}><NotebookIcon /><span className="notebook-wide-label">Folhas</span></button>
        <button type="button" className="notebook-button" aria-label="Folha anterior" disabled={index === 0} onClick={() => chooseSheet(doc.sheets[index - 1].id)}>‹</button>
        <span className="notebook-page-counter">{index + 1} / {doc.sheets.length}</span>
        <button type="button" className="notebook-button" aria-label="Próxima folha" disabled={index === doc.sheets.length - 1} onClick={() => chooseSheet(doc.sheets[index + 1].id)}>›</button>
        {!compact && <button type="button" className="notebook-button" aria-label="Adicionar folha" disabled={state.locked || doc.sheets.length >= 100} onClick={addSheet}>+</button>}</div>
      <div className="notebook-zoom"><button type="button" className="notebook-button" aria-label="Diminuir zoom" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button><button type="button" className="notebook-button" aria-label="Ajustar folha à largura" onClick={() => fit()}>{Math.round(zoom * 100)}%</button><button type="button" className="notebook-button" aria-label="Aumentar zoom" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
        {compact
          ? <NotebookPopover label="Mais opções" direction="up" trigger={<NotebookToolIcon tool="more" />}>{moreItems}</NotebookPopover>
          : <NotebookPopover label="Mais" direction="up" className="notebook-more" trigger={<span className="notebook-more-label">Mais</span>}>{moreItems}</NotebookPopover>}</div>
    </footer>}
    <input ref={importInput} type="file" accept=".json,application/json" hidden aria-label="Importar cópia de caderno" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('size');
        const imported = JSON.parse(await file.text()) as { content?: unknown };
        if (!isNotebookDoc(imported.content)) throw new Error('format');
        const extra = imported.content.sheets.map(s => ({ ...s, id: crypto.randomUUID() }));
        const current = state.getDocument();
        if (!current || !state.apply({ ...current, sheets: [...current.sheets, ...extra] })) { limit(); return; }
        chooseSheet(extra[0].id); setNotice('Folhas da cópia adicionadas ao final do caderno.');
      } catch { setNotice('Não foi possível importar. Escolha uma cópia .brain-notebook.json compatível, de até 8 MB.'); }
    }} />
    {showPaper && <NotebookPaperDialog sheet={sheet} onClose={() => setShowPaper(false)} onApply={(settings, all) => state.apply({ ...doc, sheets: doc.sheets.map(s => all || s.id === sheet.id ? { ...s, ...settings } : s) })} />}
  </section>;
}
