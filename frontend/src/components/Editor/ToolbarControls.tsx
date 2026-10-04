import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Editor as TiptapEditor } from '@tiptap/react';
import { EmojiPicker } from '../shared/EmojiPicker';

const HIGHLIGHT_COLORS = [
  { label: 'Amarelo', color: 'rgba(250, 204, 21, 0.25)' },
  { label: 'Laranja', color: 'rgba(251, 146, 60, 0.25)' },
  { label: 'Vermelho', color: 'rgba(248, 113, 113, 0.25)' },
  { label: 'Rosa', color: 'rgba(244, 114, 182, 0.25)' },
  { label: 'Verde', color: 'rgba(74, 222, 128, 0.22)' },
  { label: 'Ciano', color: 'rgba(34, 211, 238, 0.22)' },
  { label: 'Azul', color: 'rgba(96, 165, 250, 0.25)' },
  { label: 'Roxo', color: 'rgba(167, 139, 250, 0.25)' },
  { label: 'Cinza', color: 'rgba(156, 163, 175, 0.20)' },
];

const FONT_COLORS = [
  { label: 'Padrão', color: '' },
  { label: 'Cinza', color: '#9b9b9b' },
  { label: 'Vermelho', color: '#f87171' },
  { label: 'Laranja', color: '#fb923c' },
  { label: 'Amarelo', color: '#facc15' },
  { label: 'Verde', color: '#4ade80' },
  { label: 'Azul', color: '#60a5fa' },
  { label: 'Roxo', color: '#a78bfa' },
  { label: 'Rosa', color: '#f472b6' },
];

// ── Cover Image ───────────────────────────────────────────────────────────


export type SavedSel = { from: number; to: number } | null;

// ── Font Color Dropdown ────────────────────────────────────────────────────

export function FontColorDropdown({ editor, savedSel }: { editor: TiptapEditor | null; savedSel: React.RefObject<SavedSel> }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [customColor, setCustomColor] = useState('#d4d4d4');
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    const tid = setTimeout(() => document.addEventListener('pointerdown', handleOutside), 0);
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', handleOutside); };
  }, [open]);

  if (!editor) return null;

  const currentColor = editor.getAttributes('textStyle').color as string | undefined;
  const eyedropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window;

  const restoreSelection = () => {
    const sel = savedSel.current;
    if (sel) editor.chain().setTextSelection({ from: sel.from, to: sel.to }).run();
  };

  const applyColor = (color: string) => {
    restoreSelection();
    if (!color) editor.chain().focus().unsetColor().run();
    else editor.chain().focus().setColor(color).run();
  };

  const handleToggle = () => {
    const btn = btnRef.current;
    if (!btn) return;
    if (open) { setOpen(false); return; }
    const rect = btn.getBoundingClientRect();
    setCustomColor(currentColor && /^#[0-9A-Fa-f]{6}$/.test(currentColor) ? currentColor : '#d4d4d4');
    setAnchor({ top: rect.top - 8, left: Math.max(4, Math.min(rect.left, window.innerWidth - 200)) });
    setOpen(true);
  };

  const handleColor = (color: string) => {
    applyColor(color);
    setOpen(false);
  };

  const handleHexApply = () => {
    const normalized = customColor.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
      applyColor(normalized);
      setCustomColor(normalized);
    }
  };

  const handlePickFromScreen = async () => {
    if (!eyedropperSupported) return;
    try {
      const EyeDropperCtor = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      if (!EyeDropperCtor) return;
      const result = await new EyeDropperCtor().open();
      setCustomColor(result.sRGBHex);
      applyColor(result.sRGBHex);
    } catch {
      // Cancelled by user or unsupported permission context
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Cor do texto"
        title="Cor do texto"
        onPointerDown={e => e.preventDefault()}
        onClick={handleToggle}
        className="min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors flex items-center justify-center gap-1 text-gray-400 hover:text-gray-200 hover:bg-white/5"
      >
        <span style={{ color: currentColor || 'var(--theme-text)', fontWeight: 700 }}>A</span>
        <span className="text-[8px] opacity-60">▾</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl p-3 w-72"
          style={{ zIndex: 9999, top: anchor.top, left: Math.max(4, Math.min(anchor.left, window.innerWidth - 292)), transform: 'translateY(-100%)' }}
        >
          <p className="text-[11px] text-gray-500 mb-2">🎨 Escolher cor</p>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {FONT_COLORS.map(({ label, color }) => (
              <button
                key={label}
                type="button"
                title={label}
                onPointerDown={e => e.preventDefault()}
                onClick={() => handleColor(color)}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center"
                style={{
                  backgroundColor: color || '#2a2a2a',
                  borderColor: currentColor === color ? 'var(--theme-text)' : 'transparent',
                }}
                aria-label={label}
              >
                {!color && <span className="text-[10px] text-gray-400">A</span>}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9A-Fa-f]{6}$/.test(customColor) ? customColor : '#d4d4d4'}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  applyColor(e.target.value);
                }}
                className="h-9 w-10 rounded border border-[#2a2a2a] bg-transparent cursor-pointer"
                title="Color Wheel"
              />
              <input
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleHexApply();
                }}
                placeholder="#RRGGBB"
                className="flex-1 h-9 rounded border border-[#2a2a2a] bg-[#111] px-2 text-xs text-gray-200 outline-none focus:border-accent"
              />
              <button
                type="button"
                onPointerDown={e => e.preventDefault()}
                onClick={handleHexApply}
                className="h-9 px-2 rounded border border-[#2a2a2a] text-xs text-gray-300 hover:bg-white/5"
                title="Aplicar cor"
              >
                OK
              </button>
            </div>

            <button
              type="button"
              onPointerDown={e => e.preventDefault()}
              onClick={() => { void handlePickFromScreen(); }}
              disabled={!eyedropperSupported}
              className="w-full h-9 px-2 rounded border border-[#2a2a2a] text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={eyedropperSupported ? 'Eyedropper Tool' : 'Eyedropper não suportado neste navegador'}
            >
              🧪 Capturar cor da tela
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Highlight Dropdown ─────────────────────────────────────────────────────

export function HighlightDropdown({ editor, savedSel }: { editor: TiptapEditor | null; savedSel: React.RefObject<SavedSel> }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [customColor, setCustomColor] = useState('#facc15');
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    const tid = setTimeout(() => document.addEventListener('pointerdown', handleOutside), 0);
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', handleOutside); };
  }, [open]);

  if (!editor) return null;

  const isHighlighted = editor.isActive('highlight');
  const eyedropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window;

  const restoreSelection = () => {
    const sel = savedSel.current;
    if (sel) editor.chain().setTextSelection({ from: sel.from, to: sel.to }).run();
  };

  const toHighlightColor = (hex: string) => {
    const normalized = hex.trim();
    const match = normalized.match(/^#([0-9A-Fa-f]{6})$/);
    if (!match) return '';
    const rgb = match[1];
    const r = parseInt(rgb.slice(0, 2), 16);
    const g = parseInt(rgb.slice(2, 4), 16);
    const b = parseInt(rgb.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.28)`;
  };

  const applyHighlight = (color: string) => {
    restoreSelection();
    if (!color) editor.chain().focus().unsetHighlight().run();
    else editor.chain().focus().setHighlight({ color }).run();
  };

  const handleToggle = () => {
    const btn = btnRef.current;
    if (!btn) return;
    if (open) { setOpen(false); return; }
    const rect = btn.getBoundingClientRect();
    setCustomColor('#facc15');
    setAnchor({ top: rect.top - 8, left: Math.max(4, Math.min(rect.left, window.innerWidth - 284)) });
    setOpen(true);
  };

  const handleHighlight = (color: string) => {
    if (editor.isActive('highlight', { color })) applyHighlight('');
    else applyHighlight(color);
    setOpen(false);
  };

  const handleHexApply = () => {
    const color = toHighlightColor(customColor);
    if (!color) return;
    applyHighlight(color);
  };

  const handlePickFromScreen = async () => {
    if (!eyedropperSupported) return;
    try {
      const EyeDropperCtor = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      if (!EyeDropperCtor) return;
      const result = await new EyeDropperCtor().open();
      setCustomColor(result.sRGBHex);
      const color = toHighlightColor(result.sRGBHex);
      if (color) applyHighlight(color);
    } catch {
      // Cancelled by user or unsupported permission context
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Destacar texto"
        title="Destacar texto"
        onPointerDown={e => e.preventDefault()}
        onClick={handleToggle}
        className={`min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors flex items-center justify-center gap-1 ${
          isHighlighted
            ? 'bg-yellow-300/20 text-yellow-300'
            : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
        }`}
      >
        <span>A</span>
        <span className="text-[8px] opacity-60">▾</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl p-3 w-72"
          style={{ zIndex: 9999, top: anchor.top, left: Math.max(4, Math.min(anchor.left, window.innerWidth - 292)), transform: 'translateY(-100%)' }}
        >
          <p className="text-[11px] text-gray-500 mb-2">🎨 Escolher destaque</p>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {HIGHLIGHT_COLORS.map(({ label, color }) => (
              <button
                key={color}
                type="button"
                title={label}
                aria-label={label}
                onPointerDown={e => e.preventDefault()}
                onClick={() => handleHighlight(color)}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: color,
                  borderColor: editor.isActive('highlight', { color }) ? '#fff' : 'transparent',
                }}
              />
            ))}
            <button
              type="button"
              aria-label="Remover destaque"
              title="Remover destaque"
              onPointerDown={e => e.preventDefault()}
              onClick={() => {
                applyHighlight('');
                setOpen(false);
              }}
              className="w-6 h-6 rounded-full border border-[#3a3a3a] flex items-center justify-center text-gray-500 hover:text-gray-200 text-xs transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9A-Fa-f]{6}$/.test(customColor) ? customColor : '#facc15'}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  const color = toHighlightColor(e.target.value);
                  if (color) applyHighlight(color);
                }}
                className="h-9 w-10 rounded border border-[#2a2a2a] bg-transparent cursor-pointer"
                title="Color Wheel"
              />
              <input
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleHexApply();
                }}
                placeholder="#RRGGBB"
                className="flex-1 h-9 rounded border border-[#2a2a2a] bg-[#111] px-2 text-xs text-gray-200 outline-none focus:border-accent"
              />
              <button
                type="button"
                onPointerDown={e => e.preventDefault()}
                onClick={handleHexApply}
                className="h-9 px-2 rounded border border-[#2a2a2a] text-xs text-gray-300 hover:bg-white/5"
                title="Aplicar cor"
              >
                OK
              </button>
            </div>

            <button
              type="button"
              onPointerDown={e => e.preventDefault()}
              onClick={() => { void handlePickFromScreen(); }}
              disabled={!eyedropperSupported}
              className="w-full h-9 px-2 rounded border border-[#2a2a2a] text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={eyedropperSupported ? 'Eyedropper Tool' : 'Eyedropper não suportado neste navegador'}
            >
              🧪 Capturar cor da tela
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Link Button ────────────────────────────────────────────────────────────

export function LinkButton({ editor, savedSel }: { editor: TiptapEditor | null; savedSel: React.RefObject<SavedSel> }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [value, setValue] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    function handleOutside(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    const tid = setTimeout(() => document.addEventListener('pointerdown', handleOutside), 0);
    return () => { clearTimeout(tid); document.removeEventListener('pointerdown', handleOutside); };
  }, [open]);

  if (!editor) return null;

  const isActive = editor.isActive('link');
  const currentHref = String(editor.getAttributes('link').href || '');

  const normalizeHref = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const openPopover = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setAnchor({ top: rect.top - 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)) });
    setValue(currentHref);
    setOpen(true);
  };

  const applyLink = () => {
    const href = normalizeHref(value);
    const sel = savedSel.current;
    if (sel) {
      editor.chain().setTextSelection({ from: sel.from, to: sel.to }).run();
    }
    if (!href) {
      editor.chain().focus().unsetLink().run();
      setOpen(false);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setOpen(false);
  };

  const removeLink = () => {
    const sel = savedSel.current;
    if (sel) {
      editor.chain().setTextSelection({ from: sel.from, to: sel.to }).run();
    }
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        title="Link"
        onMouseDown={e => { e.preventDefault(); }}
        onClick={openPopover}
        className={`min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors font-medium ${
          isActive
            ? 'bg-white/10 text-white'
            : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
        }`}
      >
        🔗
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed w-[min(92vw,320px)] rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] shadow-2xl p-3"
          style={{ zIndex: 9999, top: anchor.top, left: anchor.left, transform: 'translateY(-100%)' }}
        >
          <p className="mb-2 text-[11px] uppercase tracking-wider text-gray-500">Link</p>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="https://exemplo.com"
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#111] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#4a4a4a]"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancelar
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
              className="px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 rounded-lg"
            >
              Remover
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyLink}
              className="px-3 py-1.5 text-xs rounded-lg bg-white text-black font-medium hover:bg-gray-100"
            >
              Salvar
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Emoji Toolbar Button ───────────────────────────────────────────────────

export function EmojiToolbarButton({ editor }: { editor: TiptapEditor | null }) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  if (!editor) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Inserir emoji"
        title="Inserir emoji"
        onMouseDown={e => e.preventDefault()}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchorRect(r => (r ? null : rect));
        }}
        className="min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)]"
      >
        😊
      </button>
      {anchorRect && (
        <EmojiPicker
          anchorRect={anchorRect}
          onSelect={emoji => {
            if (emoji) editor.chain().focus().insertContent(emoji).run();
            setAnchorRect(null);
          }}
          onClose={() => setAnchorRect(null)}
        />
      )}
    </>
  );
}

// ── Table Controls (+ column right, + row bottom) ──────────────────────────

export function TableControls({ editor }: { editor: TiptapEditor | null }) {
  const [colBtn, setColBtn] = useState<{ top: number; left: number; height: number } | null>(null);
  const [rowBtn, setRowBtn] = useState<{ top: number; left: number; width: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<'row' | 'column' | null>(null);
  const tableSelRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!editor) return;

    function update() {
      if (!editor) return;
      if (!editor.isActive('table')) {
        setColBtn(null);
        setRowBtn(null);
        return;
      }

      // Find the table DOM node that contains the current cursor position
      // by walking up from the resolved position in ProseMirror state
      const { state, view } = editor;
      const { from } = state.selection;
      let tablePos: number | null = null;

      // Walk up the node tree to find the 'table' node
      state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
        if (node.type.name === 'table') {
          const end = pos + node.nodeSize;
          if (from >= pos && from <= end) {
            tablePos = pos;
          }
        }
      });

      if (tablePos === null) { setColBtn(null); setRowBtn(null); return; }

      // Get the DOM element for this specific table node
      let tableEl: HTMLElement | null = null;
      try {
        const domAtPos = view.nodeDOM(tablePos);
        tableEl = domAtPos as HTMLElement | null;
        // nodeDOM might return the wrapper — find the actual <table>
        if (tableEl && tableEl.tagName !== 'TABLE') {
          tableEl = tableEl.querySelector('table');
        }
      } catch {
        tableEl = null;
      }

      if (!tableEl) { setColBtn(null); setRowBtn(null); return; }

      const rect = tableEl.getBoundingClientRect();
      tableSelRef.current = { from: state.selection.from, to: state.selection.to };

      setColBtn({ top: rect.top, left: rect.right + 4, height: rect.height });
      setRowBtn({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }

    const updateHandler = () => update();
    editor.on('selectionUpdate', updateHandler);
    editor.on('update', updateHandler);
    update();

    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);

    return () => {
      editor.off('selectionUpdate', updateHandler);
      editor.off('update', updateHandler);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  if (!editor) return null;

  const runDelete = (kind: 'row' | 'column') => {
    const sel = tableSelRef.current;
    if (sel) {
      const chain = editor.chain().setTextSelection({ from: sel.from, to: sel.to }).focus();
      if (kind === 'column') chain.deleteColumn().run();
      else chain.deleteRow().run();
    } else {
      const chain = editor.chain().focus();
      if (kind === 'column') chain.deleteColumn().run();
      else chain.deleteRow().run();
    }
    setConfirmDelete(null);
  };

  return (
    <>
      {colBtn && (
        <>
          <button
            className="fixed z-50 flex items-center justify-center w-5 rounded-md bg-[#2a2a2a] hover:bg-[#3a3a3a] text-gray-500 hover:text-gray-200 transition-colors border border-[#333] hover:border-[#555] text-xs"
            style={{ top: colBtn.top, left: colBtn.left, height: colBtn.height }}
            title="Adicionar coluna"
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            +
          </button>
          <button
            className="fixed z-50 flex items-center justify-center w-5 h-5 rounded-md bg-[#2a1a1a] hover:bg-[#3a2222] text-red-400 hover:text-red-300 transition-colors border border-[#4a2a2a] hover:border-[#6a3a3a] text-[10px]"
            style={{ top: colBtn.top + colBtn.height + 4, left: colBtn.left }}
            title="Excluir coluna atual"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setConfirmDelete('column')}
          >
            🗑
          </button>
        </>
      )}

      {rowBtn && (
        <>
          <button
            className="fixed z-50 flex items-center justify-center h-5 rounded-md bg-[#2a2a2a] hover:bg-[#3a3a3a] text-gray-500 hover:text-gray-200 transition-colors border border-[#333] hover:border-[#555] text-xs"
            style={{ top: rowBtn.top, left: rowBtn.left, width: rowBtn.width }}
            title="Adicionar linha"
            onMouseDown={e => e.preventDefault()}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            +
          </button>
          <button
            className="fixed z-50 flex items-center justify-center w-5 h-5 rounded-md bg-[#2a1a1a] hover:bg-[#3a2222] text-red-400 hover:text-red-300 transition-colors border border-[#4a2a2a] hover:border-[#6a3a3a] text-[10px]"
            style={{ top: rowBtn.top, left: rowBtn.left + Math.max(0, rowBtn.width - 20) }}
            title="Excluir linha atual"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setConfirmDelete('row')}
          >
            🗑
          </button>
        </>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setConfirmDelete(null);
          }}
        >
          <div className="w-[92vw] max-w-xs bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl p-4">
            <p className="text-sm text-gray-200">Tem certeza disso?</p>
            <p className="text-xs text-gray-500 mt-1">
              {confirmDelete === 'column' ? 'Essa coluna será excluída.' : 'Essa linha será excluída.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setConfirmDelete(null)}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors"
                onMouseDown={e => e.preventDefault()}
                onClick={() => runDelete(confirmDelete)}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Bottom Toolbar ─────────────────────────────────────────────────────────

export function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={active}
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 min-w-11 px-2 py-1 text-xs rounded transition-colors font-medium disabled:opacity-30 ${
        active
          ? 'bg-[var(--theme-hover)] text-[var(--theme-text)]'
          : 'text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-hover)]'
      }`}
    >
      {children}
    </button>
  );
}
