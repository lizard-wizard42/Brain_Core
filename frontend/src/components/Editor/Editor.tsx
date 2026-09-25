import { useEffect, useRef, useState, useReducer, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor as TiptapEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createLowlight, common } from 'lowlight';
import { useSocket } from '../../hooks/useSocket';
import { api } from '../../api/client';
import { resolveAssetUrl } from '../../api/assetUrl';
import { EmojiPicker } from '../shared/EmojiPicker';
import { SubPageBlock } from './SubPageBlock';
import { SubPageBlockView } from './SubPageBlockView';
import { AttachmentBlock } from './AttachmentBlock';
import { AttachmentBlockView } from './AttachmentBlockView';
import { SlashMenu, type SlashCommand } from './SlashMenu';
import { AiMenu } from './AiMenu';
import { NewTableModal } from './NewTableModal';
import { findTrailingEditorTriggerQuery } from './triggers';
import type { InfiniteDoc, Page, PageSummary, PageVersion, TiptapDoc, TiptapNode } from '../../types';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '') || `page-${Date.now()}`;
}

function isCustomIconUrl(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && /^\/|^https?:\/\//.test(icon);
}

function renderPageIcon(icon: string | null | undefined, fallback = '📄') {
  if (isCustomIconUrl(icon)) {
    return (
      <img
        src={icon as string}
        alt="Ícone da página"
        className="w-full h-full object-contain rounded"
      />
    );
  }
  return icon || fallback;
}

const IMAGE_MIN_WIDTH_PERCENT = 20;
const IMAGE_MAX_WIDTH_PERCENT = 100;
let cachedAllPages: PageSummary[] | null = null;
let cachedAllPagesPromise: Promise<PageSummary[]> | null = null;

async function loadAllPagesCached(): Promise<PageSummary[]> {
  if (cachedAllPages) return cachedAllPages;
  if (!cachedAllPagesPromise) {
    cachedAllPagesPromise = api.getTree()
      .then(({ pages }) => {
        cachedAllPages = pages;
        return pages;
      })
      .catch((err) => {
        cachedAllPagesPromise = null;
        throw err;
      });
  }
  return cachedAllPagesPromise;
}

function computeSavePayloadHash(content: unknown, title: string): string {
  return JSON.stringify({ content, title });
}


function clampImageWidthPercent(value: number): number {
  return Math.min(IMAGE_MAX_WIDTH_PERCENT, Math.max(IMAGE_MIN_WIDTH_PERCENT, value));
}

function parseImageWidthPercent(width: unknown): number | null {
  if (typeof width !== 'string') return null;
  const match = width.trim().match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return clampImageWidthPercent(parsed);
}

function ResizableImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const widthPercent = parseImageWidthPercent(node.attrs.width) ?? IMAGE_MAX_WIDTH_PERCENT;

  const startResize = useCallback((event: React.MouseEvent, direction: -1 | 1) => {
    event.preventDefault();
    event.stopPropagation();

    const editorElement = editor.options.element as HTMLElement | null;
    const containerWidth = editorElement?.clientWidth ?? 0;
    if (!containerWidth) return;

    const startX = event.clientX;
    const startWidth = widthPercent;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaPx = (moveEvent.clientX - startX) * direction;
      const deltaPercent = (deltaPx / containerWidth) * 100;
      const next = clampImageWidthPercent(startWidth + deltaPercent);
      updateAttributes({ width: `${Math.round(next)}%` });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [editor.options.element, updateAttributes, widthPercent]);

  return (
    <NodeViewWrapper
      className="relative block max-w-full my-3"
      style={{ width: `${Math.round(widthPercent)}%` }}
      contentEditable={false}
      data-image-node-view="true"
    >
      <img
        src={resolveAssetUrl(node.attrs.src)}
        alt={node.attrs.alt || ''}
        title={node.attrs.title || ''}
        className="w-full h-auto rounded-lg block"
        draggable={false}
      />
      {selected && (
        <>
          <button
            type="button"
            className="absolute left-[-7px] top-1/2 -translate-y-1/2 h-12 w-3 rounded-full bg-accent/90 border border-white/70 shadow-md cursor-ew-resize"
            onMouseDown={(event) => startResize(event, -1)}
            aria-label="Redimensionar imagem pela esquerda"
          />
          <button
            type="button"
            className="absolute right-[-7px] top-1/2 -translate-y-1/2 h-12 w-3 rounded-full bg-accent/90 border border-white/70 shadow-md cursor-ew-resize"
            onMouseDown={(event) => startResize(event, 1)}
            aria-label="Redimensionar imagem pela direita"
          />
        </>
      )}
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const dataWidth = element.getAttribute('data-width');
          if (dataWidth) return dataWidth;

          const styleWidth = (element as HTMLElement).style?.width;
          if (styleWidth) return styleWidth;

          const widthAttr = element.getAttribute('width');
          if (widthAttr && /^\d+(\.\d+)?$/.test(widthAttr)) return `${widthAttr}px`;
          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return {
            'data-width': attributes.width,
            style: `width: ${attributes.width};`,
          };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

// ── New Sub-Page Modal ─────────────────────────────────────────────────────

function NewSubPageModal({
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

function TypeSelectorModal({
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

const lowlight = createLowlight(common);

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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

interface CoverProps {
  pageId: string;
  coverUrl: string | null | undefined;
  coverPositionY: number;
  onUpdate: (url: string | null, posY?: number) => void;
}

function CoverImage({ pageId, coverUrl, coverPositionY, onUpdate }: CoverProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [repositioning, setRepositioning] = useState(false);
  const [posY, setPosY] = useState(coverPositionY);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartPosY = useRef<number>(posY);

  const handleUrlSave = async () => {
    if (!urlInput.trim()) return;
    try {
      const updated = await api.patchPage(pageId, { cover_url: urlInput.trim() });
      onUpdate(updated.cover_url ?? null, updated.cover_position_y ?? 50);
      setShowPanel(false);
      setUrlInput('');
    } catch {
      alert('Erro ao salvar capa');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-uploaded
    try {
      const updated = await api.uploadCover(pageId, file);
      onUpdate(updated.cover_url ?? null, updated.cover_position_y ?? 50);
      setShowPanel(false);
    } catch {
      alert('Erro ao fazer upload');
    }
  };

  const handleRemove = async () => {
    try {
      await api.removeCover(pageId);
      onUpdate(null);
      setShowPanel(false);
    } catch {
      alert('Erro ao remover capa');
    }
  };

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartPosY.current = posY;

    const onMove = (ev: MouseEvent) => {
      if (dragStartY.current === null || !imgContainerRef.current) return;
      const containerH = imgContainerRef.current.clientHeight;
      const delta = ev.clientY - dragStartY.current;
      const deltaPercent = (delta / containerH) * 100;
      setPosY(Math.max(0, Math.min(100, dragStartPosY.current - deltaPercent)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragStartY.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleSavePosition = async () => {
    setRepositioning(false);
    try {
      await api.patchPage(pageId, { cover_position_y: Math.round(posY) });
      onUpdate(coverUrl ?? null, Math.round(posY));
    } catch { /* silent */ }
  };

  if (!coverUrl) {
    return (
      <div className="group relative h-8 flex items-center">
        <button
          className="hidden group-hover:flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors ml-2"
          onClick={() => setShowPanel(true)}
        >
          <span>🖼️</span> Adicionar capa
        </button>
        {showPanel && (
          <CoverPanel
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            onUrlSave={handleUrlSave}
            onFileClick={() => fileRef.current?.click()}
            onRemove={undefined}
            onClose={() => setShowPanel(false)}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      </div>
    );
  }

  const src = coverUrl.startsWith('/uploads') ? api.coverUrl(coverUrl) : coverUrl;

  return (
    <div className="group relative">
      <div
        ref={imgContainerRef}
        className={`w-full h-52 overflow-hidden ${repositioning ? 'cursor-ns-resize select-none' : ''}`}
        onMouseDown={repositioning ? handleDragStart : undefined}
      >
        <img
          src={src}
          alt="Capa"
          draggable={false}
          className="w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `center ${posY}%` }}
        />
      </div>

      {/* Gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#191919] pointer-events-none" />

      {/* Controls */}
      <div className="absolute top-3 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {repositioning ? (
          <>
            <span className="px-3 py-1 text-xs bg-black/60 text-gray-300 rounded-md backdrop-blur-sm">
              Arraste para reposicionar
            </span>
            <button
              className="px-3 py-1 text-xs bg-accent text-white rounded-md backdrop-blur-sm hover:opacity-90 transition-opacity"
              onMouseDown={e => e.stopPropagation()}
              onClick={handleSavePosition}
            >
              Salvar posição
            </button>
          </>
        ) : (
          <>
            <button
              className="px-3 py-1 text-xs bg-black/50 text-white rounded-md backdrop-blur-sm hover:bg-black/70 transition-colors"
              onClick={() => setRepositioning(true)}
            >
              Reposicionar
            </button>
            <button
              className="px-3 py-1 text-xs bg-black/50 text-white rounded-md backdrop-blur-sm hover:bg-black/70 transition-colors"
              onClick={() => setShowPanel(true)}
            >
              Trocar capa
            </button>
            <button
              className="px-3 py-1 text-xs bg-black/50 text-white rounded-md backdrop-blur-sm hover:bg-black/70 transition-colors"
              onClick={handleRemove}
            >
              Remover
            </button>
          </>
        )}
      </div>

      {showPanel && (
        <CoverPanel
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          onUrlSave={handleUrlSave}
          onFileClick={() => fileRef.current?.click()}
          onRemove={handleRemove}
          onClose={() => setShowPanel(false)}
        />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
    </div>
  );
}

function CoverPanel({
  urlInput, setUrlInput, onUrlSave, onFileClick, onRemove, onClose,
}: {
  urlInput: string;
  setUrlInput: (v: string) => void;
  onUrlSave: () => void;
  onFileClick: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-full left-0 mt-2 z-50 bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl p-4 w-80">
      <p className="text-xs text-gray-500 mb-2">URL da imagem</p>
      <div className="flex gap-2 mb-3">
        <input
          autoFocus
          className="flex-1 bg-[#111] text-sm text-gray-200 rounded-lg px-3 py-1.5 outline-none border border-[#2a2a2a] focus:border-accent"
          placeholder="https://..."
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onUrlSave(); if (e.key === 'Escape') onClose(); }}
        />
        <button
          className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:opacity-90 transition-opacity"
          onClick={onUrlSave}
        >
          OK
        </button>
      </div>
      <button
        className="w-full text-xs text-gray-500 hover:text-gray-300 py-1.5 rounded-lg hover:bg-white/5 transition-colors mb-1"
        onClick={onFileClick}
      >
        📁 Enviar arquivo
      </button>
      {onRemove && (
        <button
          className="w-full text-xs text-red-500/60 hover:text-red-400 py-1 rounded-lg hover:bg-white/5 transition-colors"
          onClick={onRemove}
        >
          Remover capa
        </button>
      )}
    </div>
  );
}

// ── @ Page Picker ─────────────────────────────────────────────────────────

interface AtPickerProps {
  pages: PageSummary[];
  query: string;
  position: { top: number; left: number };
  onSelect: (page: PageSummary) => void;
  onClose: () => void;
}

function AtPicker({ pages, query, position, onSelect, onClose }: AtPickerProps) {
  const [selectionState, setSelectionState] = useState({ query: '', index: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() =>
    pages
      .filter(p => p.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8),
    [pages, query]
  );

  const selected = selectionState.query === query
    ? Math.min(selectionState.index, Math.max(0, filtered.length - 1))
    : 0;

  const updateSelected = useCallback((nextIndex: number) => {
    setSelectionState({ query, index: nextIndex });
  }, [query]);

  useEffect(() => {
    if (!filtered.length) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); updateSelected((selected + 1) % (filtered.length || 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); updateSelected((selected - 1 + (filtered.length || 1)) % (filtered.length || 1)); }
      else if (e.key === 'Enter') {
        const page = filtered[selected];
        if (!page) return;
        e.preventDefault();
        onSelect(page);
      }
      else if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [filtered, onClose, onSelect, selected, updateSelected]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  if (!filtered.length) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl py-1 w-64"
      style={{ top: position.top, left: position.left }}
    >
      <div className="px-3 py-1.5 text-[11px] text-gray-600 border-b border-[#2a2a2a] mb-1">Linkar página</div>
      {filtered.map((p, i) => (
        <button
          key={p.id}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
            i === selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
          }`}
          onMouseEnter={() => updateSelected(i)}
          onMouseDown={e => { e.preventDefault(); onSelect(p); }}
        >
          <span className="text-base shrink-0 w-5 h-5 flex items-center justify-center">
            {renderPageIcon(p.icon)}
          </span>
          <span className="text-[13px] text-[#d4d4d4] truncate">{p.title}</span>
        </button>
      ))}
    </div>
  );
}

// ── Page Header (emoji above title, Notion-style) ─────────────────────────

interface PageHeaderProps {
  pageId: string;
  icon: string | null | undefined;
  title: string;
  onIconChange: (icon: string) => void;
  onTitleChange: (title: string) => void;
  onRefresh?: () => void;
}

function PageHeader({ pageId, icon, title, onIconChange, onTitleChange, onRefresh }: PageHeaderProps) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const handleIconSelect = async (emoji: string) => {
    onIconChange(emoji);
    try {
      await api.patchPage(pageId, { icon: emoji || undefined });
      onRefresh?.();
    } catch { /* silent */ }
    setAnchorRect(null);
  };

  return (
    <div className="mb-6 group/header">
      <div className="flex items-center gap-3">
        {/* Ícone ao lado esquerdo do título */}
        <div className="relative shrink-0">
          {icon ? (
            <button
              className="text-[2.5rem] leading-none rounded-lg hover:bg-white/5 transition-colors p-1"
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
              className="text-xs text-gray-700 hover:text-gray-400 transition-colors opacity-0 group-hover/header:opacity-100 whitespace-nowrap"
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
          className="flex-1 resize-none overflow-hidden text-[2.5rem] font-bold text-white bg-transparent outline-none placeholder-[#333] leading-tight whitespace-pre-wrap break-words"
          style={{ fontFamily: 'system-ui, sans-serif', letterSpacing: '-0.02em' }}
          placeholder="Sem título"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Shared saved-selection ref (populated on editor blur) ──────────────────
// Both dropdowns receive this ref so they can restore selection before applying marks.
type SavedSel = { from: number; to: number } | null;

// ── Font Color Dropdown ────────────────────────────────────────────────────

function FontColorDropdown({ editor, savedSel }: { editor: TiptapEditor | null; savedSel: React.RefObject<SavedSel> }) {
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

  const handleToggle = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const btn = btnRef.current;
    if (!btn) return;
    if (open) { setOpen(false); return; }
    const rect = btn.getBoundingClientRect();
    setCustomColor(currentColor && /^#[0-9A-Fa-f]{6}$/.test(currentColor) ? currentColor : '#d4d4d4');
    setAnchor({ top: rect.top - 8, left: Math.max(4, Math.min(rect.left, window.innerWidth - 200)) });
    setOpen(true);
  };

  const handleColor = (e: React.PointerEvent<HTMLButtonElement>, color: string) => {
    e.preventDefault();
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
        title="Cor do texto"
        onPointerDown={handleToggle}
        className="px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 text-gray-400 hover:text-gray-200 hover:bg-white/5"
      >
        <span style={{ color: currentColor || '#d4d4d4', fontWeight: 700 }}>A</span>
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
                title={label}
                onPointerDown={e => handleColor(e, color)}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center"
                style={{
                  backgroundColor: color || '#2a2a2a',
                  borderColor: currentColor === color ? '#fff' : 'transparent',
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
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleHexApply();
                }}
                className="h-9 px-2 rounded border border-[#2a2a2a] text-xs text-gray-300 hover:bg-white/5"
                title="Aplicar cor"
              >
                OK
              </button>
            </div>

            <button
              onPointerDown={(e) => {
                e.preventDefault();
                void handlePickFromScreen();
              }}
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

function HighlightDropdown({ editor, savedSel }: { editor: TiptapEditor | null; savedSel: React.RefObject<SavedSel> }) {
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

  const handleToggle = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const btn = btnRef.current;
    if (!btn) return;
    if (open) { setOpen(false); return; }
    const rect = btn.getBoundingClientRect();
    setCustomColor('#facc15');
    setAnchor({ top: rect.top - 8, left: Math.max(4, Math.min(rect.left, window.innerWidth - 284)) });
    setOpen(true);
  };

  const handleHighlight = (e: React.PointerEvent<HTMLButtonElement>, color: string) => {
    e.preventDefault();
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
        title="Destacar texto"
        onPointerDown={handleToggle}
        className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
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
                title={label}
                onPointerDown={e => handleHighlight(e, color)}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: color,
                  borderColor: editor.isActive('highlight', { color }) ? '#fff' : 'transparent',
                }}
              />
            ))}
            <button
              title="Remover destaque"
              onPointerDown={e => {
                e.preventDefault();
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
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleHexApply();
                }}
                className="h-9 px-2 rounded border border-[#2a2a2a] text-xs text-gray-300 hover:bg-white/5"
                title="Aplicar cor"
              >
                OK
              </button>
            </div>

            <button
              onPointerDown={(e) => {
                e.preventDefault();
                void handlePickFromScreen();
              }}
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

function LinkButton({ editor, savedSel }: { editor: TiptapEditor | null; savedSel: React.RefObject<SavedSel> }) {
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
        className={`px-2 py-1 text-xs rounded transition-colors font-medium ${
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

function EmojiToolbarButton({ editor }: { editor: TiptapEditor | null }) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  if (!editor) return null;

  return (
    <>
      <button
        title="Inserir emoji"
        onMouseDown={e => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchorRect(r => (r ? null : rect));
        }}
        className="px-2 py-1 text-xs rounded transition-colors text-gray-500 hover:text-gray-200 hover:bg-white/5"
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

function TableControls({ editor }: { editor: TiptapEditor | null }) {
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
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}
          >
            +
          </button>
          <button
            className="fixed z-50 flex items-center justify-center w-5 h-5 rounded-md bg-[#2a1a1a] hover:bg-[#3a2222] text-red-400 hover:text-red-300 transition-colors border border-[#4a2a2a] hover:border-[#6a3a3a] text-[10px]"
            style={{ top: colBtn.top + colBtn.height + 4, left: colBtn.left }}
            title="Excluir coluna atual"
            onMouseDown={e => { e.preventDefault(); setConfirmDelete('column'); }}
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
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}
          >
            +
          </button>
          <button
            className="fixed z-50 flex items-center justify-center w-5 h-5 rounded-md bg-[#2a1a1a] hover:bg-[#3a2222] text-red-400 hover:text-red-300 transition-colors border border-[#4a2a2a] hover:border-[#6a3a3a] text-[10px]"
            style={{ top: rowBtn.top, left: rowBtn.left + Math.max(0, rowBtn.width - 20) }}
            title="Excluir linha atual"
            onMouseDown={e => { e.preventDefault(); setConfirmDelete('row'); }}
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
                onMouseDown={e => { e.preventDefault(); setConfirmDelete(null); }}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors"
                onMouseDown={e => { e.preventDefault(); runDelete(confirmDelete); }}
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

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={`px-2 py-1 text-xs rounded transition-colors font-medium ${
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function findTextMatches(editor: TiptapEditor, query: string): Array<{ from: number; to: number }> {
  const needle = query.trim();
  if (!needle) return [];

  const matches: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let searchFrom = 0;
    while (searchFrom <= node.text.length - needle.length) {
      const foundAt = node.text.indexOf(needle, searchFrom);
      if (foundAt === -1) break;
      matches.push({ from: pos + foundAt, to: pos + foundAt + needle.length });
      searchFrom = foundAt + Math.max(needle.length, 1);
    }
  });
  return matches;
}

const findHighlightKey = new PluginKey('brainFindHighlight');

function findHighlightPlugin(getState: () => { matches: Array<{ from: number; to: number }>; activeIndex: number }) {
  return new Plugin({
    key: findHighlightKey,
    props: {
      decorations(state) {
        const { matches, activeIndex } = getState();
        if (!matches.length) return DecorationSet.empty;
        const decos = matches.map((m, i) =>
          Decoration.inline(m.from, m.to, {
            class: i === activeIndex ? 'brain-find-active' : 'brain-find-match',
          }),
        );
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

export function FindReplacePopover({
  editor,
  onClose,
  toggleSelector = '[data-find-toggle]',
}: {
  editor: TiptapEditor;
  onClose: () => void;
  toggleSelector?: string;
}) {
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findInputRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest(toggleSelector)) return;
      if (panelRef.current && !panelRef.current.contains(target)) onClose();
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [onClose, toggleSelector]);

  // `useEditor` (TipTap v3) não re-renderiza por transação; sem isto a navegação
  // ↓/↑ e o realce da ocorrência ativa ficam presos na primeira match no browser.
  const [, bumpTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') return;
    editor.on('transaction', bumpTick);
    return () => { editor.off('transaction', bumpTick); };
  }, [editor]);

  const matches = findTextMatches(editor, findValue);
  const currentSelection = editor.state.selection;
  const activeIndex = matches.findIndex(
    (match) => match.from === currentSelection.from && match.to === currentSelection.to
  );

  const stateRef = useRef({ matches: [] as Array<{ from: number; to: number }>, activeIndex: -1 });
  stateRef.current = { matches, activeIndex };

  useEffect(() => {
    if (typeof editor.registerPlugin !== 'function' || typeof editor.unregisterPlugin !== 'function') return;
    const plugin = findHighlightPlugin(() => stateRef.current);
    editor.registerPlugin(plugin);
    return () => { editor.unregisterPlugin(findHighlightKey); };
  }, [editor]);

  // Mudança no termo não gera transação PM sozinha (só um re-render React), então
  // as decorações `brain-find-match` não apareceriam até a 1ª transação. Este
  // meta no-op força o recomputo das decorações ao digitar. Mudança de seleção
  // já é coberta pela assinatura de `transaction` acima.
  useEffect(() => {
    if (typeof editor.state?.tr?.setMeta !== 'function' || typeof editor.view?.dispatch !== 'function') return;
    editor.view.dispatch(editor.state.tr.setMeta(findHighlightKey, Date.now()));
  }, [editor, findValue]);

  const jumpToMatch = (direction: 'next' | 'prev') => {
    if (!matches.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : (direction === 'next' ? -1 : 0);
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % matches.length
      : (currentIndex - 1 + matches.length) % matches.length;
    const target = matches[nextIndex];
    editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).run();
    const dom = editor.view.domAtPos(target.from)?.node as HTMLElement | undefined;
    (dom?.parentElement ?? dom)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const replaceCurrent = () => {
    if (!findValue.trim()) return;
    const selectedText = editor.state.doc.textBetween(currentSelection.from, currentSelection.to, '\n');
    const target = activeIndex >= 0
      ? matches[activeIndex]
      : matches.find((match) => match.from >= currentSelection.from) ?? matches[0];
    if (!target) return;

    if (selectedText !== findValue) {
      editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).run();
    }
    const tr = editor.state.tr.insertText(replaceValue, target.from, target.to);
    editor.view.dispatch(tr);
    const nextPos = target.from + replaceValue.length;
    editor.chain().focus().setTextSelection({ from: nextPos, to: nextPos }).run();
  };

  const replaceAll = () => {
    if (!findValue.trim() || !matches.length) return;
    let tr = editor.state.tr;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      tr = tr.insertText(replaceValue, match.from, match.to);
    }
    editor.view.dispatch(tr);
    editor.chain().focus().run();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[230]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="absolute bottom-14 left-2 right-2 sm:left-auto sm:right-6 w-auto sm:w-[min(92vw,360px)] rounded-xl border border-[#2a2a2a] bg-[#171717] shadow-2xl"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#242424]">
          <p className="text-[11px] uppercase tracking-wider text-gray-500">Buscar / Substituir</p>
          <button
            className="text-[11px] text-gray-500 hover:text-gray-300"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
        <div className="p-3 space-y-2.5">
          <input
            ref={findInputRef}
            value={findValue}
            onChange={(e) => setFindValue(e.target.value)}
            placeholder="Buscar..."
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#111] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#4a4a4a]"
          />
          <input
            value={replaceValue}
            onChange={(e) => setReplaceValue(e.target.value)}
            placeholder="Substituir por..."
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#111] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#4a4a4a]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500">
              {findValue.trim() ? `${matches.length} ocorrência${matches.length === 1 ? '' : 's'}` : 'Digite para buscar'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => jumpToMatch('prev')}
                className="px-2 py-1 text-[11px] rounded text-gray-300 hover:bg-white/[0.05]"
              >
                ↑
              </button>
              <button
                onClick={() => jumpToMatch('next')}
                className="px-2 py-1 text-[11px] rounded text-gray-300 hover:bg-white/[0.05]"
              >
                ↓
              </button>
              <button
                onClick={replaceCurrent}
                className="px-2 py-1 text-[11px] rounded text-gray-300 hover:bg-white/[0.05]"
              >
                Substituir
              </button>
              <button
                onClick={replaceAll}
                className="px-2 py-1 text-[11px] rounded bg-white text-black font-medium hover:bg-gray-100"
              >
                Tudo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function VersionHistoryPopover({
  versions,
  onRestoreVersion,
  onClose,
}: {
  versions: PageVersion[];
  onRestoreVersion: (versionId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[220]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute bottom-14 right-2 sm:right-6 w-[min(92vw,360px)] rounded-xl border border-[#2a2a2a] bg-[#171717] shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#242424]">
          <p className="text-[11px] uppercase tracking-wider text-gray-500">Histórico ({versions.length})</p>
          <button
            className="text-[11px] text-gray-500 hover:text-gray-300"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto p-2 space-y-1.5">
          {versions.map(v => (
            <div key={v.id} className="flex items-center gap-2 rounded px-2 py-1 border border-[#262626] bg-[#141414]">
              <span className="text-[11px] text-gray-500 min-w-[72px] uppercase">{v.reason}</span>
              <span className="text-[11px] text-gray-400 flex-1">{new Date(v.created_at).toLocaleString('pt-BR')}</span>
              <button
                onClick={() => { onRestoreVersion(v.id); onClose(); }}
                className="px-2 py-1 text-[11px] rounded text-gray-300 hover:bg-white/[0.05]"
              >
                Restaurar
              </button>
            </div>
          ))}
          {versions.length === 0 && (
            <div className="rounded px-2 py-3 border border-dashed border-[#262626] bg-[#141414]">
              <p className="text-xs text-gray-500">Sem versões ainda para esta página.</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function BottomToolbar({
  editor,
  saveStatus,
  onCreateSubPage,
  creatingSubPage,
  onOpenImagePicker,
  onOpenAttachmentPicker,
  savedSel,
  versions,
  onRestoreVersion,
  spellcheckEnabled,
  onToggleSpellcheck,
  pageId,
}: {
  editor: TiptapEditor | null;
  saveStatus: SaveStatus;
  pageId: string;
  onCreateSubPage: () => void;
  creatingSubPage: boolean;
  onOpenImagePicker: () => void;
  onOpenAttachmentPicker: () => void;
  savedSel: React.RefObject<SavedSel>;
  versions: PageVersion[];
  onRestoreVersion: (versionId: string) => void;
  spellcheckEnabled: boolean;
  onToggleSpellcheck: () => void;
}) {
  const [showTableModal, setShowTableModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowFindReplace(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const statusText: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Salvando…',
    saved: '✓ Salvo',
    error: '⚠ Erro',
  };
  const statusColor: Record<SaveStatus, string> = {
    idle: 'text-transparent',
    saving: 'text-gray-600',
    saved: 'text-green-600',
    error: 'text-red-500',
  };

  if (!editor) return null;

  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-1 px-2 sm:px-6 pt-2 bg-[#191919]/90 backdrop-blur-sm border-t border-[#1f1f1f] overflow-x-auto safe-area-bottom" style={{ scrollbarWidth: 'none' }}>
      {showHistory && (
        <VersionHistoryPopover
          versions={versions}
          onRestoreVersion={onRestoreVersion}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showFindReplace && (
        <FindReplacePopover
          editor={editor}
          onClose={() => setShowFindReplace(false)}
        />
      )}
      <AiMenu editor={editor} pageId={pageId} />
      <span className="text-[#2a2a2a] mx-1">|</span>
      {/* Text format */}
      <ToolbarButton title="Negrito (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton title="Itálico (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title="Sublinhado (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span style={{ textDecoration: 'underline' }}>U</span>
      </ToolbarButton>
      <ToolbarButton title="Tachado" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton title="Código" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>`</ToolbarButton>

      <span className="text-[#2a2a2a] mx-1">|</span>

      {/* Headings */}
      <ToolbarButton title="Título 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
      <ToolbarButton title="Título 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
      <ToolbarButton title="Título 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>

      <span className="text-[#2a2a2a] mx-1">|</span>

      {/* Lists */}
      <ToolbarButton title="Lista" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>≡</ToolbarButton>
      <ToolbarButton title="Lista numerada" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
      <ToolbarButton title="Lista de tarefas" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</ToolbarButton>

      <span className="text-[#2a2a2a] mx-1">|</span>

      {/* Blocks */}
      <ToolbarButton title="Citação" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>"</ToolbarButton>
      <ToolbarButton title="Bloco de código" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'</>'}</ToolbarButton>
      {showTableModal && (
        <NewTableModal
          onConfirm={(rows, cols, withHeaderRow) => {
            setShowTableModal(false);
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
          }}
          onClose={() => setShowTableModal(false)}
        />
      )}
      <ToolbarButton title="Tabela" active={editor.isActive('table')} onClick={() => setShowTableModal(true)}>⊞</ToolbarButton>
      <ToolbarButton title="Linha divisória" onClick={() => editor.chain().focus().setHorizontalRule().run()}>—</ToolbarButton>

      <span className="text-[#2a2a2a] mx-1">|</span>

      {/* Font color */}
      <FontColorDropdown editor={editor} savedSel={savedSel} />

      {/* Highlight */}
      <HighlightDropdown editor={editor} savedSel={savedSel} />

      {/* Link */}
      <LinkButton editor={editor} savedSel={savedSel} />

      {/* Emoji */}
      <EmojiToolbarButton editor={editor} />

      {/* Imagem */}
      <button
        title="Inserir imagem"
        onMouseDown={e => { e.preventDefault(); onOpenImagePicker(); }}
        className="px-2 py-1 text-xs rounded transition-colors text-gray-500 hover:text-gray-200 hover:bg-white/5"
      >
        🖼️
      </button>

      {/* Anexo */}
      <button
        title="Anexar arquivo"
        onMouseDown={e => { e.preventDefault(); onOpenAttachmentPicker(); }}
        className="px-2 py-1 text-xs rounded transition-colors text-gray-500 hover:text-gray-200 hover:bg-white/5"
      >
        📎
      </button>

      <span className="text-[#2a2a2a] mx-1">|</span>

      {/* Sub-page */}
      <button
        title="Criar sub-página"
        onMouseDown={e => { e.preventDefault(); onCreateSubPage(); }}
        disabled={creatingSubPage}
        aria-label="Criar sub-página"
        className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-40"
      >
        +
      </button>
      <button
        title="Buscar e substituir (Ctrl+F)"
        data-find-toggle
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setShowFindReplace(v => !v); }}
        aria-label="Buscar e substituir"
        className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
      >
        ⌕
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-pressed={spellcheckEnabled}
          aria-label={spellcheckEnabled ? 'Desativar corretor nativo do navegador' : 'Ativar corretor nativo do navegador'}
          title={spellcheckEnabled ? 'Desativar corretor nativo' : 'Ativar corretor nativo'}
          onClick={onToggleSpellcheck}
          className={`spelling-status-badge ${spellcheckEnabled ? 'spelling-status-badge--active spelling-status-badge--ok' : ''}`}
        >
          {spellcheckEnabled ? '✓' : '✕'}
        </button>
        <button
          title="Histórico de versões"
          onClick={() => setShowHistory(v => !v)}
          className="px-2 py-1 text-xs rounded transition-colors text-gray-500 hover:text-gray-200 hover:bg-white/5"
        >
          ↺ {versions.length}
        </button>
        <span className={`text-xs transition-colors ${statusColor[saveStatus]}`}>
          {statusText[saveStatus]}
        </span>
      </div>
    </div>
  );
}

// ── Main Editor ───────────────────────────────────────────────────────────

interface EditorProps {
  page: Page;
  onRefresh?: () => void;
  headerSlot?: ReactNode;
  onNavigatePage?: (page: { id: string; title: string; icon?: string | null }, openInNewTab?: boolean) => void;
}

export function Editor({ page, onRefresh, headerSlot, onNavigatePage }: EditorProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [title, setTitle] = useState(page.title);
  // Mantém titleRef sempre atualizado para uso em closures do editor
  useEffect(() => { titleRef.current = title; }, [title]);
  const [icon, setIcon] = useState<string>(page.icon ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(page.cover_url ?? null);
  const [coverPositionY, setCoverPositionY] = useState<number>(page.cover_position_y ?? 50);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestContentRef = useRef<unknown>(page.content);
  const lastQueuedSaveHashRef = useRef<string>('');
  const lastSentSaveHashRef = useRef<string>('');
  const subPageOrderKeyRef = useRef<string>('');
  const syncSubPageOrderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Refs estáveis para não recriar o editor a cada render
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  const onNavigatePageRef = useRef(onNavigatePage);
  useEffect(() => { onNavigatePageRef.current = onNavigatePage; }, [onNavigatePage]);
  const titleRef = useRef(page.title);
  // Salva a última seleção conhecida — atualizada tanto em onBlur quanto em selectionUpdate
  const savedSelRef = useRef<SavedSel>(null);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(true);

  // All pages (for @ picker)
  const [allPages, setAllPages] = useState<PageSummary[]>(() => cachedAllPages ?? []);
  useEffect(() => {
    let cancelled = false;
    loadAllPagesCached()
      .then((pages) => {
        if (!cancelled) setAllPages(pages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadVersionHistory = useCallback(() => {
    api.getPageVersions(page.id, 30).then((history) => {
      setVersions(history.versions);
    }).catch(() => {});
  }, [page.id]);

  useEffect(() => {
    loadVersionHistory();
  }, [loadVersionHistory]);

  // @ picker state
  const [atPicker, setAtPicker] = useState<{
    query: string;
    position: { top: number; left: number };
    from: number;
  } | null>(null);
  const [slashMenu, setSlashMenu] = useState<{
    query: string;
    position: { top: number; left: number };
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const currentPageIdRef = useRef(page.id);

  useEffect(() => {
    currentPageIdRef.current = page.id;
    setSaveStatus('idle');
    setSpellcheckEnabled(true);
    clearTimeout(saveTimer.current);
    clearTimeout(syncSubPageOrderTimerRef.current);
    lastQueuedSaveHashRef.current = '';
    lastSentSaveHashRef.current = '';
    subPageOrderKeyRef.current = '';
  }, [page.id]);

  const { joinPage, leavePage, savePage } = useSocket({
    onSaved: (savedPageId) => {
      if (savedPageId !== currentPageIdRef.current) return;
      setSaveStatus(current => (current === 'saving' ? 'saved' : current));
    },
    onError: (errorPageId) => {
      if (errorPageId !== currentPageIdRef.current) return;
      setSaveStatus('error');
    },
  });

  const persistContentNow = useCallback(
    async (
      content: TiptapDoc | InfiniteDoc,
      currentTitle: string,
      options?: { keepalive?: boolean; reloadVersions?: boolean }
    ) => {
      clearTimeout(saveTimer.current);
      latestContentRef.current = content;
      const payloadHash = computeSavePayloadHash(content, currentTitle);
      if (payloadHash === lastSentSaveHashRef.current) {
        setSaveStatus('saved');
        return;
      }
      setSaveStatus('saving');
      try {
        await api.savePage(page.id, { content, title: currentTitle }, { keepalive: options?.keepalive });
        lastSentSaveHashRef.current = payloadHash;
        lastQueuedSaveHashRef.current = payloadHash;
        setSaveStatus('saved');
        if (options?.reloadVersions) loadVersionHistory();
      } catch (err) {
        setSaveStatus('error');
        throw err;
      }
    },
    [loadVersionHistory, page.id]
  );

  const triggerSave = useCallback(
    (ed: TiptapEditor, currentTitle: string) => {
      clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveTimer.current = setTimeout(() => {
        const content = ed.getJSON();
        latestContentRef.current = content;
        const payloadHash = computeSavePayloadHash(content, currentTitle);
        if (payloadHash === lastSentSaveHashRef.current) {
          setSaveStatus('saved');
          return;
        }
        if (payloadHash === lastQueuedSaveHashRef.current) {
          return;
        }
        lastQueuedSaveHashRef.current = payloadHash;
        savePage(page.id, content, currentTitle);
        lastSentSaveHashRef.current = payloadHash;
      }, 1500);
    },
    [page.id, savePage]
  );

  const syncSubPageOrder = useCallback(async (ed: TiptapEditor) => {
    const subPageIds: string[] = [];
    ed.state.doc.descendants(node => {
      if (node.type.name === 'subPageBlock' && node.attrs.pageId) {
        subPageIds.push(node.attrs.pageId);
      }
    });

    if (subPageIds.length === 0) return;

    try {
      const subPages = await api.getSubPages(page.id);
      const validChildIds = new Set(subPages.map(sp => sp.id));
      const orderedChildIds = subPageIds.filter(id => validChildIds.has(id));
      if (orderedChildIds.length === 0) return;

      // Update sort_order for each sub-page based on its position in the editor
      await Promise.all(orderedChildIds.map((id, index) =>
        api.patchPage(id, { sort_order: index * 1000 })
      ));
      onRefresh?.();
    } catch (err) {
      console.error('Failed to sync sub-page order:', err);
    }
  }, [onRefresh, page.id]);

  const getSubPageOrderFromDoc = useCallback((doc: { descendants: (fn: (node: { type: { name: string }; attrs: { pageId?: string } }) => void) => void }) => {
    const ids: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'subPageBlock' && node.attrs.pageId) {
        ids.push(node.attrs.pageId);
      }
    });
    return ids;
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, underline: false, link: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Underline,
      Link.configure({ openOnClick: false }),
      ResizableImage.configure({ inline: false, allowBase64: false }),
      SubPageBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(
            (props) => SubPageBlockView({ ...props, onRefresh: () => onRefreshRef.current?.(), onNavigatePage: (page, openInNewTab) => onNavigatePageRef.current?.(page, openInNewTab) })
          );
        },
      }),
      AttachmentBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(AttachmentBlockView);
        },
      }),
      Placeholder.configure({ placeholder: 'Escreva algo, ou pressione "/" para comandos…' }),
    ],
    // Normalize empty doc so the editor always has at least one paragraph to click into
    content: ('type' in page.content && (page.content.content?.length ?? 0) > 0)
      ? page.content
      : { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
        spellcheck: 'true',
        autocorrect: 'on',
        autocomplete: 'on',
        autocapitalize: 'off',
        lang: 'pt-BR',
      },
      handlePaste(view, event) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const text = clipboardData.getData('text/plain');
        const html = clipboardData.getData('text/html');
        if (text.trim() || html.trim()) {
          return false;
        }

        const items = clipboardData.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            event.preventDefault();
            api.uploadImage(file).then(url => {
              view.dispatch(view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.image.create({ src: url })
              ));
            }).catch(() => alert('Erro ao fazer upload da imagem'));
            return true;
          }
        }
        return false;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (!imageFiles.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        imageFiles.forEach(file => {
          api.uploadImage(file).then(url => {
            const node = view.state.schema.nodes.image.create({ src: url });
            const transaction = view.state.tr.insert(pos?.pos ?? view.state.selection.from, node);
            view.dispatch(transaction);
          }).catch(() => alert('Erro ao fazer upload da imagem'));
        });
        return true;
      },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      // Always track the latest selection so dropdowns can restore it
      const { from, to } = ed.state.selection;
      savedSelRef.current = { from, to };
    },
    onBlur: ({ editor: ed }) => {
      // Capture selection the moment editor loses focus (mobile-safe)
      const { from, to } = ed.state.selection;
      savedSelRef.current = { from, to };
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) return;

      // Keep the latest content cached so the unmount/pagehide flush can persist
      // recent edits even if the editor has already been destroyed by then.
      latestContentRef.current = ed.getJSON();
      triggerSave(ed, titleRef.current);

      // Detect @ for page linking
      const { state } = ed;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n');
      const atQuery = findTrailingEditorTriggerQuery(textBefore, '@');
      const slashQuery = findTrailingEditorTriggerQuery(textBefore, '/');
      if (atQuery !== null) {
        const domPos = ed.view.coordsAtPos(from);
        setAtPicker({
          query: atQuery,
          position: { top: domPos.bottom + 4, left: domPos.left },
          from: from - atQuery.length - 1,
        });
      } else {
        setAtPicker(null);
      }
      if (slashQuery !== null) {
        const domPos = ed.view.coordsAtPos(from);
        setSlashMenu({
          query: slashQuery,
          position: { top: domPos.bottom + 4, left: domPos.left },
        });
      } else {
        setSlashMenu(null);
      }

      // Sync sidebar order only when the subPageBlock sequence actually changes.
      const nextOrder = getSubPageOrderFromDoc(transaction.doc as unknown as { descendants: (fn: (node: { type: { name: string }; attrs: { pageId?: string } }) => void) => void });
      const nextOrderKey = nextOrder.join('|');

      if (nextOrderKey !== subPageOrderKeyRef.current) {
        subPageOrderKeyRef.current = nextOrderKey;
        clearTimeout(syncSubPageOrderTimerRef.current);
        syncSubPageOrderTimerRef.current = setTimeout(() => {
          void syncSubPageOrder(ed);
        }, 600);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    dom.setAttribute('spellcheck', spellcheckEnabled ? 'true' : 'false');
    // Keep the boolean property in sync for browsers that prioritize it.
    dom.spellcheck = spellcheckEnabled;
  }, [editor, spellcheckEnabled]);

  useEffect(() => {
    return () => {
      clearTimeout(syncSubPageOrderTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const currentOrder = getSubPageOrderFromDoc(editor.state.doc as unknown as { descendants: (fn: (node: { type: { name: string }; attrs: { pageId?: string } }) => void) => void });
    subPageOrderKeyRef.current = currentOrder.join('|');
  }, [editor, page.id, getSubPageOrderFromDoc]);

  const toggleSpellcheck = useCallback(() => {
    setSpellcheckEnabled((current) => !current);
  }, []);

  // Listen for icon changes from any page and update matching subPageBlock nodes
  const editorRef = useRef<TiptapEditor | null>(null);
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => {
    function handleIconChange(e: Event) {
      const { pageId, icon: newIcon } = (e as CustomEvent<{ pageId: string; icon: string }>).detail;
      const ed = editorRef.current;
      if (!ed) return;
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'subPageBlock' && node.attrs.pageId === pageId) {
          ed.view.dispatch(
            ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, icon: newIcon })
          );
        }
      });
    }
    document.addEventListener('page-icon-changed', handleIconChange);
    return () => document.removeEventListener('page-icon-changed', handleIconChange);
  }, []);

  // Sync sub-pages from sidebar/tree into the editor body (Notion-like)
  useEffect(() => {
    if (!editor) return;
    api.getSubPages(page.id).then(subPages => {
      if (!subPages.length) return;
      const orderedChildIds = subPages.map(sp => sp.id);
      const childRank = new Map(orderedChildIds.map((id, index) => [id, index]));
      const childById = new Map(subPages.map(sp => [sp.id, sp]));

      const docJson = editor.getJSON();
      const currentContent = (Array.isArray(docJson.content) ? docJson.content : []) as TiptapNode[];
      let nextContent = [...currentContent];

      const managedEntries: Array<{ index: number; id: string; node: TiptapNode }> = [];
      currentContent.forEach((node, index) => {
        if (node.type !== 'subPageBlock') return;
        const pageId = typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : null;
        if (!pageId || !childRank.has(pageId)) return;
        managedEntries.push({ index, id: pageId, node });
      });

      const presentChildIds = new Set(managedEntries.map(entry => entry.id));
      const missingNodes = orderedChildIds
        .filter(id => !presentChildIds.has(id))
        .map(id => {
          const sp = childById.get(id);
          return {
            type: 'subPageBlock',
            attrs: { pageId: id, title: sp?.title ?? 'Sem título', icon: sp?.icon ?? '' },
          } as TiptapNode;
        });

      if (managedEntries.length > 0) {
        // Keep the same visual zone in the body, but reorder managed child blocks by sidebar order
        const sortedManaged = [...managedEntries].sort(
          (a, b) => (childRank.get(a.id) ?? 0) - (childRank.get(b.id) ?? 0)
        );
        const sortedIndices = [...managedEntries].map(entry => entry.index).sort((a, b) => a - b);

        sortedIndices.forEach((targetIndex, idx) => {
          const source = sortedManaged[idx];
          const sp = childById.get(source.id);
          nextContent[targetIndex] = {
            ...source.node,
            type: 'subPageBlock',
            attrs: {
              ...(source.node.attrs ?? {}),
              pageId: source.id,
              title: sp?.title ?? source.node.attrs?.title ?? 'Sem título',
              icon: sp?.icon ?? source.node.attrs?.icon ?? '',
            },
          };
        });

        if (missingNodes.length) {
          const insertAt = Math.max(...sortedIndices) + 1;
          nextContent.splice(insertAt, 0, ...missingNodes);
        }
      } else if (missingNodes.length) {
        // If body is still effectively empty, replace it with the ordered child list.
        const docIsEffectivelyEmpty = currentContent.every(node => {
          if (node.type !== 'paragraph') return false;
          const paragraphText = (node.content ?? [])
            .map(child => ('text' in child ? child.text : ''))
            .join('')
            .trim();
          return paragraphText.length === 0;
        });

        if (docIsEffectivelyEmpty) nextContent = missingNodes;
        else nextContent = [...nextContent, ...missingNodes];
      }

      if (JSON.stringify(nextContent) === JSON.stringify(currentContent)) return;
      editor.chain().setContent({ type: 'doc', content: nextContent }).run();
    }).catch(() => {});
  }, [editor, page.id]);

  // Reset "saved" status after 2s
  useEffect(() => {
    if (saveStatus === 'saved') {
      const t = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [saveStatus]);

  useEffect(() => {
    function flushPendingSave() {
      if (saveStatus !== 'saving') return;
      const content = (editor?.getJSON() ?? latestContentRef.current) as TiptapDoc | InfiniteDoc | undefined;
      if (!content) return;
      void persistContentNow(content, titleRef.current, { keepalive: true });
    }

    window.addEventListener('pagehide', flushPendingSave);
    return () => {
      window.removeEventListener('pagehide', flushPendingSave);
      flushPendingSave();
    };
  }, [editor, persistContentNow, saveStatus]);

  // Socket room
  useEffect(() => {
    joinPage(page.id);
    return () => { leavePage(page.id); };
  }, [page.id, joinPage, leavePage]);

  // Title change handler — triggers save
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (editor) triggerSave(editor, newTitle);
  };

  const handleRestoreVersion = async (versionId: string) => {
    const ok = window.confirm('Restaurar esta versão da página?');
    if (!ok) return;
    try {
      const restored = await api.restorePageVersion(page.id, versionId);
      setTitle(restored.title);
      if (restored.icon !== undefined) setIcon(restored.icon ?? '');
      editor?.chain().setContent(restored.content).run();
      loadVersionHistory();
    } catch {
      alert('Erro ao restaurar versão');
    }
  };

  // @ picker: insert link to selected page
  const handleAtSelect = useCallback((p: PageSummary) => {
    if (!editor || !atPicker) return;
    const { from: atFrom } = atPicker;
    const { from: curFrom } = editor.state.selection;
    editor.chain()
      .deleteRange({ from: atFrom, to: curFrom })
      .insertContent({
        type: 'subPageBlock',
        attrs: { pageId: p.id, title: p.title, icon: p.icon ?? '' },
      })
      .run();
    setAtPicker(null);
  }, [editor, atPicker]);

  // Sub-page modal state
  const [showSubPageModal, setShowSubPageModal] = useState(false);
  const [showSubPageTypeSelector, setShowSubPageTypeSelector] = useState(false);
  const [pendingSubPageTitle, setPendingSubPageTitle] = useState<string | null>(null);
  const [creatingSubPage, setCreatingSubPage] = useState(false);

  const handleUploadImage = useCallback((file: File) => {
    api.uploadImage(file).then(url => {
      if (!editor) return;
      editor.chain().focus().setImage({ src: url }).run();
      const content = editor.getJSON() as TiptapDoc;
      void persistContentNow(content, titleRef.current, { reloadVersions: true }).catch(() => {
        alert('Imagem enviada, mas houve erro ao salvar a página');
      });
    }).catch(() => alert('Erro ao fazer upload da imagem'));
  }, [editor, persistContentNow]);

  const handleUploadAttachment = useCallback((file: File) => {
    api.uploadFile(file).then((uploaded) => {
      if (!editor) return;
      editor.chain().focus().insertAttachmentBlock({
        url: uploaded.url,
        name: uploaded.name,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      }).run();
      const content = editor.getJSON() as TiptapDoc;
      void persistContentNow(content, titleRef.current, { reloadVersions: true }).catch(() => {
        alert('Arquivo enviado, mas houve erro ao salvar a página');
      });
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao fazer upload do anexo';
      alert(message);
    });
  }, [editor, persistContentNow]);

  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (!editor) return [];

    return [
      { id: 'paragraph', label: 'Texto', description: 'Voltar para parágrafo normal', icon: '¶', action: (ed) => { ed.chain().focus().setParagraph().run(); } },
      { id: 'heading-1', label: 'Título 1', description: 'Cabeçalho principal', icon: 'H1', action: (ed) => { ed.chain().focus().toggleHeading({ level: 1 }).run(); } },
      { id: 'heading-2', label: 'Título 2', description: 'Cabeçalho secundário', icon: 'H2', action: (ed) => { ed.chain().focus().toggleHeading({ level: 2 }).run(); } },
      { id: 'heading-3', label: 'Título 3', description: 'Cabeçalho terciário', icon: 'H3', action: (ed) => { ed.chain().focus().toggleHeading({ level: 3 }).run(); } },
      { id: 'bullet-list', label: 'Lista', description: 'Criar lista com marcadores', icon: '•', action: (ed) => { ed.chain().focus().toggleBulletList().run(); } },
      { id: 'ordered-list', label: 'Lista numerada', description: 'Criar lista ordenada', icon: '1.', action: (ed) => { ed.chain().focus().toggleOrderedList().run(); } },
      { id: 'task-list', label: 'Checklist', description: 'Criar lista de tarefas', icon: '☑', action: (ed) => { ed.chain().focus().toggleTaskList().run(); } },
      { id: 'blockquote', label: 'Citação', description: 'Inserir bloco de citação', icon: '❝', action: (ed) => { ed.chain().focus().toggleBlockquote().run(); } },
      { id: 'code-block', label: 'Bloco de código', description: 'Inserir bloco de código', icon: '</>', action: (ed) => { ed.chain().focus().toggleCodeBlock().run(); } },
      { id: 'divider', label: 'Divisor', description: 'Inserir linha horizontal', icon: '—', action: (ed) => { ed.chain().focus().setHorizontalRule().run(); } },
      { id: 'table', label: 'Tabela', description: 'Inserir tabela 3x3', icon: '⊞', action: (ed) => { ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
      { id: 'image', label: 'Imagem', description: 'Enviar uma imagem', icon: '🖼️', action: () => { imageInputRef.current?.click(); } },
      { id: 'attachment', label: 'Anexo', description: 'Enviar PDF, Office ou texto', icon: '📎', action: () => { attachmentInputRef.current?.click(); } },
      { id: 'sub-page', label: 'Sub-página', description: 'Criar sub-página dentro da nota', icon: '➕', action: () => { setShowSubPageModal(true); } },
    ];
  }, [editor]);

  const handleCreateSubPage = async (subTitle: string, type: 'note' | 'infinite') => {
    setShowSubPageModal(false);
    setShowSubPageTypeSelector(false);
    setPendingSubPageTitle(null);
    setCreatingSubPage(true);
    try {
      const sub = await api.createPage({
        parent_page_id: page.id,
        title: subTitle,
        slug: toSlug(subTitle),
        type,
      });
      editor?.chain().focus().insertSubPageBlock({
        pageId: sub.id,
        title: sub.title,
        icon: sub.icon ?? '',
      }).run();
      onRefresh?.();
      loadVersionHistory();
    } catch {
      alert('Erro ao criar sub-página');
    } finally {
      setCreatingSubPage(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* @ page picker */}
      {atPicker && (
        <AtPicker
          pages={allPages}
          query={atPicker.query}
          position={atPicker.position}
          onSelect={handleAtSelect}
          onClose={() => setAtPicker(null)}
        />
      )}
      {slashMenu && editor && (
        <SlashMenu
          editor={editor}
          commands={slashCommands}
          query={slashMenu.query}
          position={slashMenu.position}
          onClose={() => setSlashMenu(null)}
        />
      )}
      {/* Sub-page modal */}
      {showSubPageModal && (
        <NewSubPageModal
          onConfirm={(subTitle) => {
            setPendingSubPageTitle(subTitle);
            setShowSubPageModal(false);
            setShowSubPageTypeSelector(true);
          }}
          onClose={() => setShowSubPageModal(false)}
        />
      )}

      {showSubPageTypeSelector && pendingSubPageTitle && (
        <TypeSelectorModal
          onSelect={(type) => { void handleCreateSubPage(pendingSubPageTitle, type); }}
          onClose={() => {
            setShowSubPageTypeSelector(false);
            setPendingSubPageTitle(null);
          }}
        />
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {headerSlot && (
          <div className="px-6 pt-6">
            {headerSlot}
          </div>
        )}
        {/* Cover */}
        <CoverImage
          pageId={page.id}
          coverUrl={coverUrl}
          coverPositionY={coverPositionY}
          onUpdate={(url, posY) => {
            setCoverUrl(url);
            if (posY !== undefined) setCoverPositionY(posY);
          }}
        />

        {/* Page content */}
        <div className="max-w-[720px] mx-auto px-4 sm:px-12 pt-6 sm:pt-8 pb-4">
          <PageHeader
            pageId={page.id}
            icon={icon}
            title={title}
            onIconChange={setIcon}
            onTitleChange={handleTitleChange}
            onRefresh={onRefresh}
          />
          <EditorContent editor={editor} className="mt-2 min-h-[50vh]" />
        </div>
      </div>

      {/* Table controls (+col / +row) */}
      <TableControls editor={editor} />

      {/* Bottom toolbar */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadImage(file);
            setSlashMenu(null);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.rtf,.odt,.ods,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,application/rtf,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadAttachment(file);
            setSlashMenu(null);
            e.target.value = '';
          }
        }}
      />
      <BottomToolbar
        editor={editor}
        saveStatus={saveStatus}
        onCreateSubPage={() => setShowSubPageModal(true)}
        creatingSubPage={creatingSubPage}
        onOpenImagePicker={() => imageInputRef.current?.click()}
        onOpenAttachmentPicker={() => attachmentInputRef.current?.click()}
        savedSel={savedSelRef}
        versions={versions}
        onRestoreVersion={(versionId) => { void handleRestoreVersion(versionId); }}
        spellcheckEnabled={spellcheckEnabled}
        onToggleSpellcheck={toggleSpellcheck}
        pageId={page.id}
      />
    </div>
  );
}
