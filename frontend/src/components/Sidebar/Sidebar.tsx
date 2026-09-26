import { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TreePage } from '../../types';
import type { Tab } from '../../hooks/useTabs';
import { api } from '../../api/client';
import { TrashPanel } from '../Trash/TrashPanel';
import { EmojiPicker } from '../shared/EmojiPicker';
import { RememberSidebarTree } from '../Remember/RememberSidebarTree';
import { RememberErrorBoundary } from '../Remember/RememberErrorBoundary';
import { SharedSection } from '../Shared/SharedSection';

interface SidebarProps {
  tree: TreePage[];
  activePage: string | null;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
  onPageClick?: (page: TreePage, openInNewTab?: boolean) => void;
  onRememberOpen?: (date?: string) => void;
  tabs?: Tab[];
  activeTabId?: string | null;
  onTabClick?: (id: string) => void;
  onTabClose?: (id: string) => void;
  onCloseAllTabs?: () => void;
  onNewTab?: () => void;
  onGoBack?: () => void;
}

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

// ── Confirm Modal ─────────────────────────────────────────────────────────

function ConfirmModal({
  message,
  onConfirm,
  onClose,
}: {
  message: string;
  onConfirm: () => void;
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
          <h2 className="text-[15px] font-semibold text-white">Confirmar exclusão</h2>
          <p className="text-[13px] text-gray-400">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 transition-colors"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-2 text-[13px] bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            onClick={() => { onConfirm(); onClose(); }}
          >
            Apagar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Expanded state (localStorage) ─────────────────────────────────────────

const STORAGE_KEY = 'brain-core:sidebar-open';

function loadOpenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveOpenIds(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

// ── Drag & Drop types ──────────────────────────────────────────────────────

type DropPosition = 'before' | 'after' | 'inside';

interface DragState {
  draggingId: string;
  overId: string | null;
  position: DropPosition;
}

// Flat list of all nodes with depth info, used to compute siblings/order
interface FlatNode {
  id: string;
  parentId: string | null;
  sort_order: number;
  depth: number;
}

function flattenTree(nodes: TreePage[], parentId: string | null = null, depth = 0): FlatNode[] {
  const result: FlatNode[] = [];
  for (const n of nodes) {
    result.push({ id: n.id, parentId, sort_order: n.sort_order, depth });
    result.push(...flattenTree(n.children, n.id, depth + 1));
  }
  return result;
}

function findNode(tree: TreePage[], id: string): TreePage | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

// Returns true if `ancestorId` is an ancestor of `nodeId` in the tree
function isDescendantOf(tree: TreePage[], nodeId: string, ancestorId: string): boolean {
  const ancestor = findNode(tree, ancestorId);
  if (!ancestor) return false;
  return findNode(ancestor.children, nodeId) !== null || ancestor.children.some(c => isDescendantOf(c.children.length ? [c] : [], nodeId, c.id));
}

// ── PageNode ──────────────────────────────────────────────────────────────

interface PageNodeProps {
  page: TreePage;
  activePage: string | null;
  activeAncestorIds: Set<string>;
  onRefresh: () => Promise<void>;
  openIds: Set<string>;
  onToggle: (id: string, force?: boolean) => void;
  depth?: number;
  // drag & drop
  drag: DragState | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, pos: DropPosition) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  tree: TreePage[];
  onPageClick?: (page: TreePage, openInNewTab?: boolean) => void;
}

function PageNodeComponent({
  page, activePage, activeAncestorIds, onRefresh, openIds, onToggle, depth = 0,
  drag, onDragStart, onDragOver, onDrop, onDragEnd, tree,
  onPageClick,
}: PageNodeProps) {
  const navigate = useNavigate();
  const isActive = page.id === activePage;
  const hasChildren = page.children.length > 0;
  const open = openIds.has(page.id);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [iconAnchorRect, setIconAnchorRect] = useState<DOMRect | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-open when active page is a descendant
  useEffect(() => {
    if (isActive || activeAncestorIds.has(page.id)) {
      onToggle(page.id, true);
    }
  }, [activeAncestorIds, isActive, onToggle, page.id]);

  useEffect(() => {
    setTitle(page.title);
  }, [page.title]);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  // Auto-open when something is dragged over this node for 600ms
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDragging = drag?.draggingId === page.id;
  const isOver = drag?.overId === page.id;
  const dropPos = isOver ? drag?.position : null;

  const handleAddPage = async (type: 'note' | 'infinite' = 'note') => {
    if (!newTitle.trim()) return;
    const slug = toSlug(newTitle);
    try {
      const created = await api.createPage({ 
        parent_page_id: page.id, 
        title: newTitle.trim(), 
        slug,
        type 
      });
      await onRefresh();
      setAdding(false);
      setNewTitle('');
      onToggle(page.id, true);
      
      if (onPageClick) {
        onPageClick({ ...created, children: [] });
      } else {
        navigate(`/page/${created.id}`);
      }
    } catch {
      alert('Erro ao criar página');
    }
  };

  const handleRename = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitle(page.title);
      setRenaming(false);
      return;
    }
    if (nextTitle === page.title) {
      setRenaming(false);
      return;
    }
    try {
      await api.renamePage(page.id, nextTitle);
      await onRefresh();
    } catch {
      setTitle(page.title);
      alert('Erro ao renomear');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deletePage(page.id);
      await onRefresh();
      navigate('/');
    } catch {
      alert('Erro ao apagar');
    }
  };

  const handleIconSelect = async (icon: string) => {
    try {
      await api.patchPage(page.id, { icon: icon || undefined });
      document.dispatchEvent(new CustomEvent('page-icon-changed', {
        detail: { pageId: page.id, icon },
      }));
      await onRefresh();
    } catch {
      alert('Erro ao atualizar ícone');
    } finally {
      setIconAnchorRect(null);
    }
  };

  const indent = 10 + depth * 14;

  // Compute drop position from mouse Y relative to the row
  const rowRef = useRef<HTMLDivElement>(null);

  const handleDragOverRow = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!rowRef.current || !drag) return;
    // Can't drop onto itself or its descendants
    if (drag.draggingId === page.id) return;
    if (isDescendantOf([...tree], page.id, drag.draggingId)) return;

    const rect = rowRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    let pos: DropPosition;
    if (y < h * 0.25) pos = 'before';
    else if (y > h * 0.75) pos = 'after';
    else pos = 'inside';

    onDragOver(page.id, pos);

    // Auto-open if hovering "inside" a node that has (or could have) children
    if (pos === 'inside') {
      if (!hoverTimerRef.current) {
        hoverTimerRef.current = setTimeout(() => {
          onToggle(page.id, true);
          hoverTimerRef.current = null;
        }, 600);
      }
    } else {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    }
  };

  const handleDragLeaveRow = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  return (
    <div
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {/* Drop indicator — BEFORE */}
      {isOver && dropPos === 'before' && (
        <div style={{ marginLeft: `${indent}px` }} className="h-[2px] bg-blue-500 rounded-full mx-1 -mb-px" />
      )}

      <div
        ref={rowRef}
        className={`group flex min-h-11 md:min-h-0 w-full min-w-0 items-center gap-1.5 py-[3px] rounded-md cursor-pointer transition-colors select-none ${
          isActive ? 'bg-white/[0.07] text-white' : 'hover:bg-white/[0.03] text-[#c7c7c7]'
        } ${isOver && dropPos === 'inside' ? 'ring-1 ring-blue-500/60 bg-blue-500/5' : ''}`}
        style={{ paddingLeft: `${indent}px`, paddingRight: '8px' }}
        onMouseDown={e => {
          if (e.button !== 1 || renaming) return;
          e.preventDefault();
          e.stopPropagation();
          if (onPageClick) onPageClick(page, true);
          else window.open("/page/" + page.id, "_blank");
        }}
        onClick={() => {
          if (!renaming) {
            if (onPageClick) onPageClick(page);
            else navigate(`/page/${page.id}`);
          }
        }}
        onAuxClick={e => e.preventDefault()}
        onDragOver={handleDragOverRow}
        onDragLeave={handleDragLeaveRow}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(); }}
      >
        {/* Drag handle */}
        <span
          className="hidden md:block text-[10px] text-gray-800 w-3 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity hover:text-gray-500 mr-0.5"
          draggable
          onDragStart={e => {
            e.stopPropagation();
            // Set drag image to a transparent pixel so the default ghost doesn't show oddly
            const ghost = document.createElement('div');
            ghost.style.position = 'absolute';
            ghost.style.top = '-9999px';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            setTimeout(() => document.body.removeChild(ghost), 0);
            onDragStart(page.id);
          }}
          onDragEnd={e => { e.stopPropagation(); onDragEnd(); }}
          onClick={e => e.stopPropagation()}
          title="Arrastar para mover"
        >
          ⠿
        </span>

        {/* Seta — abre/fecha filhos */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Recolher ${page.title}` : `Expandir ${page.title}`}
            className="flex h-8 w-8 md:h-auto md:w-3 shrink-0 items-center justify-center text-[10px] text-gray-500 transition-transform hover:text-gray-300"
            style={{ transform: open ? 'none' : 'rotate(-90deg)' }}
            onClick={e => { e.stopPropagation(); onToggle(page.id); }}
          >
            ▾
          </button>
        ) : (
          <span className="w-8 md:w-3 shrink-0" />
        )}

        {/* Ícone */}
        <button
          type="button"
          aria-label="Trocar ícone"
          title="Trocar ícone"
          className="text-sm leading-none w-8 h-8 md:w-5 md:h-5 flex items-center justify-center shrink-0 rounded hover:bg-white/5 transition-colors"
          onClick={e => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setIconAnchorRect((current) => (current ? null : rect));
          }}
        >
          {renderPageIcon(page.icon)}
        </button>

        {/* Título ou input de rename */}
        {renaming ? (
          <input
            autoFocus
            ref={renameInputRef}
            className="flex-1 min-w-0 bg-white/5 text-[13px] text-gray-200 rounded px-1 py-0 outline-none border border-accent/70"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onClick={e => e.stopPropagation()}
            onBlur={() => { void handleRename(); }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setRenaming(false);
                setTitle(page.title);
              }
            }}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[13px] leading-5">
            {page.title}
          </span>
        )}

        {/* Ações */}
        <div className="flex md:hidden md:group-hover:flex items-center gap-0.5 shrink-0">
          <button
            title="Nova página aqui"
            className="text-gray-500 hover:text-gray-200 text-sm w-7 h-8 md:w-4 md:h-4 flex items-center justify-center rounded transition-colors"
            onClick={e => {
              e.stopPropagation();
              setAdding(true);
              onToggle(page.id, true);
              setNewTitle('');
            }}
          >
            +
          </button>
          <button
            title="Renomear"
            className="text-gray-500 hover:text-gray-200 text-[12px] w-7 h-8 md:w-4 md:h-4 flex items-center justify-center rounded transition-colors"
            onClick={e => {
              e.stopPropagation();
              setTitle(page.title);
              setRenaming(true);
            }}
          >
            ✏
          </button>
          <button
            title="Apagar"
            className="text-gray-500 hover:text-red-400 text-[12px] w-7 h-8 md:w-4 md:h-4 flex items-center justify-center rounded transition-colors"
            onClick={e => { e.stopPropagation(); setShowDeleteConfirm(true); }}
          >
            ✕
          </button>
        </div>
      </div>

      {iconAnchorRect && (
        <EmojiPicker
          anchorRect={iconAnchorRect}
          onSelect={handleIconSelect}
          onClose={() => setIconAnchorRect(null)}
        />
      )}

      {/* Drop indicator — AFTER */}
      {isOver && dropPos === 'after' && (
        <div style={{ marginLeft: `${indent}px` }} className="h-[2px] bg-blue-500 rounded-full mx-1 -mt-px" />
      )}

      {/* Modal de confirmação */}
      {showDeleteConfirm && (
        <ConfirmModal
          message={`Apagar "${page.title}"${hasChildren ? ' e todo seu conteúdo' : ''}? Esta ação não pode ser desfeita.`}
          onConfirm={handleDelete}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Filhos */}
      {open && (
        <div>
          {page.children.map(child => (
            <PageNode
              key={child.id}
              page={child}
              activePage={activePage}
              activeAncestorIds={activeAncestorIds}
              onRefresh={onRefresh}
              openIds={openIds}
              onToggle={onToggle}
              depth={depth + 1}
              drag={drag}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              tree={tree}
              onPageClick={onPageClick}
            />
          ))}

          {adding && (
            <div style={{ paddingLeft: `${10 + (depth + 1) * 14}px`, paddingRight: '8px' }}>
              <div className="my-1 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                <input
                  autoFocus
                  className="w-full bg-white/5 text-[13px] text-gray-200 rounded-md px-2 py-1 outline-none border border-accent/50 focus:border-accent"
                  placeholder="Título da página…"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleAddPage('note');
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setAdding(false);
                      setNewTitle('');
                    }
                  }}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-white/8 px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/12 transition-colors"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { void handleAddPage('note'); }}
                  >
                    Nota
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-white/8 px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/12 transition-colors"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { void handleAddPage('infinite'); }}
                  >
                    Infinite
                  </button>
                  <button
                    type="button"
                    className="ml-auto rounded-md px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setAdding(false);
                      setNewTitle('');
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

const PageNode = memo(PageNodeComponent);

export const Sidebar = memo(function Sidebar({
  tree,
  activePage,
  onRefresh,
  onClose,
  onPageClick,
  onRememberOpen,
  tabs = [],
  activeTabId,
  onTabClick,
  onTabClose,
  onCloseAllTabs,
  onNewTab,
  onGoBack,
}: SidebarProps) {
  const navigate = useNavigate();
  const appIconUrl = `${import.meta.env.BASE_URL}icons/brain-core-icon.png`;
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [search, setSearch] = useState('');

  const searchMatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [] as TreePage[];
    const out: TreePage[] = [];
    const walk = (nodes: TreePage[]) => nodes.forEach((node) => {
      if (node.title.toLowerCase().includes(query)) out.push(node);
      walk(node.children);
    });
    walk(tree);
    return out.slice(0, 40);
  }, [search, tree]);
  const [openIds, setOpenIds] = useState<Set<string>>(loadOpenIds);
  const [drag, setDrag] = useState<DragState | null>(null);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null>();
    const walk = (nodes: TreePage[], parentId: string | null) => {
      for (const node of nodes) {
        map.set(node.id, parentId);
        walk(node.children, node.id);
      }
    };
    walk(tree, null);
    return map;
  }, [tree]);

  const activeAncestorIds = useMemo(() => {
    const ancestors = new Set<string>();
    if (!activePage) return ancestors;
    let cursor = parentById.get(activePage) ?? null;
    while (cursor) {
      ancestors.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    return ancestors;
  }, [activePage, parentById]);

  const visibleOpenIds = useMemo(() => {
    const validIds = new Set<string>();
    const collect = (nodes: TreePage[]) => nodes.forEach((node) => {
      validIds.add(node.id);
      collect(node.children);
    });
    collect(tree);
    return new Set([...openIds].filter(id => validIds.has(id)));
  }, [openIds, tree]);

  useEffect(() => {
    if (visibleOpenIds.size !== openIds.size) {
      saveOpenIds(visibleOpenIds);
    }
  }, [openIds, visibleOpenIds]);

  const handleToggle = useCallback((id: string, force?: boolean) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (force === true) {
        next.add(id);
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      saveOpenIds(next);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((id: string) => {
    setDrag({ draggingId: id, overId: null, position: 'after' });
  }, []);

  const handleDragOver = useCallback((id: string, pos: DropPosition) => {
    setDrag(prev => prev ? { ...prev, overId: id, position: pos } : null);
  }, []);

  const handleDrop = useCallback(async () => {
    if (!drag || !drag.overId) { setDrag(null); return; }
    const { draggingId, overId, position } = drag;
    if (draggingId === overId) { setDrag(null); return; }

    const flat = flattenTree(tree);
    const overNode = flat.find(n => n.id === overId);
    if (!overNode) { setDrag(null); return; }

    let newParentId: string | null;
    let newSortOrder: number;

    if (position === 'inside') {
      newParentId = overId;
      const overTreeNode = findNode(tree, overId);
      const siblings = overTreeNode?.children ?? [];
      newSortOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.sort_order)) + 1000 : 0;
    } else {
      newParentId = overNode.parentId;
      const siblings = flat.filter(n => n.parentId === newParentId && n.id !== draggingId);
      const overIdx = siblings.findIndex(n => n.id === overId);

      if (position === 'before') {
        const prev = siblings[overIdx - 1];
        const curr = siblings[overIdx];
        newSortOrder = prev ? Math.round((prev.sort_order + curr.sort_order) / 2) : curr.sort_order - 1000;
      } else {
        const curr = siblings[overIdx];
        const next = siblings[overIdx + 1];
        newSortOrder = next ? Math.round((curr.sort_order + next.sort_order) / 2) : curr.sort_order + 1000;
      }
    }

    setDrag(null);

    try {
      await api.patchPage(draggingId, { parent_page_id: newParentId, sort_order: newSortOrder });
      await onRefresh();
      if (newParentId) handleToggle(newParentId, true);
    } catch {
      // silently fail — tree stays as is until next refresh
    }
  }, [drag, tree, onRefresh, handleToggle]);

  const handleDragEnd = useCallback(() => {
    setDrag(null);
  }, []);

  const handleAddPage = async (type: 'note' | 'infinite' = 'note') => {
    if (!newTitle.trim()) return;
    const slug = toSlug(newTitle);
    try {
      const created = await api.createPage({ title: newTitle.trim(), slug, type });
      await onRefresh();
      setAdding(false);
      setNewTitle('');

      if (onPageClick) {
        onPageClick({ ...created, children: [] });
      } else {
        navigate(`/page/${created.id}`);
      }
    } catch {
      alert('Erro ao criar página');
    }
  };

  return (
    <aside className="w-[min(86vw,320px)] md:w-56 h-full flex flex-col bg-[#111111] border-r border-[#1f1f1f] shrink-0" style={{ height: 'var(--app-viewport-height, 100%)' }}>
      {/* Header */}
      <div className="px-3 py-3.5 flex items-center gap-2">
        <button type="button"
          className="flex-1 flex items-center gap-2 cursor-pointer hover:bg-white/[0.03] transition-colors rounded-md px-1 py-0.5 text-left"
          onClick={() => { navigate('/'); onClose?.(); }}
          aria-label="Brain Core: abrir Dashboard"
        >
          <img src={appIconUrl} alt="Brain Core" className="w-[18px] h-[18px] rounded-sm object-cover" />
          <span className="font-semibold text-[13px] text-[#e0e0e0]">Brain Core</span>
        </button>
        {/* Botão fechar — só aparece no mobile */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden text-gray-600 hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-white/5 shrink-0"
            aria-label="Fechar menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        )}
      </div>

      {/* Busca */}
      <div className="px-2 pb-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar…"
          className="w-full rounded-md border border-[#242424] bg-[#161616] px-2.5 py-1.5 text-[12px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#333]"
        />
      </div>

      <details className="md:hidden border-b border-[#1f1f1f] px-2 pb-2 text-[12px] text-gray-300">
        <summary className="cursor-pointer rounded-md px-2 py-2">Abas abertas ({tabs.length})</summary>
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          <button type="button" onClick={() => { onNewTab?.(); onClose?.(); }} className="min-h-11 rounded-md border border-[#2a2a2a] px-3 py-1">+ Nova aba</button>
          <button type="button" onClick={() => { onGoBack?.(); onClose?.(); }} className="min-h-11 rounded-md border border-[#2a2a2a] px-3 py-1">← Voltar</button>
          <button type="button" onClick={onCloseAllTabs} disabled={tabs.length === 0} className="min-h-11 rounded-md border border-[#2a2a2a] px-3 py-1 disabled:opacity-40">Fechar todas</button>
        </div>
        <div className="max-h-44 overflow-y-auto">
          {tabs.map(tab => (
            <div key={tab.id} className="flex items-center rounded-md" style={{ backgroundColor: activeTabId === tab.id ? 'var(--theme-card)' : undefined }}>
              <button type="button" className="min-h-11 min-w-0 flex-1 truncate px-2 text-left" onClick={() => { onTabClick?.(tab.id); onClose?.(); }}>
                {tab.title}
              </button>
              <button type="button" className="min-h-11 min-w-12 rounded-md border border-transparent text-base hover:border-[#444] hover:bg-white/10" aria-label={`Fechar ${tab.title}`} onClick={() => onTabClose?.(tab.id)}>×</button>
            </div>
          ))}
        </div>
      </details>

      {/* Árvore */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1 px-1"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}
        onDragOver={e => e.preventDefault()}
      >
        {search.trim() ? (
          <div className="px-1">
            {searchMatches.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-gray-600">Nada encontrado.</p>
            ) : (
              searchMatches.map(page => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => onPageClick?.(page)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-300 hover:bg-white/[0.04]"
                >
                  <span aria-hidden="true">{page.icon || '📄'}</span>
                  <span className="truncate">{page.title}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <>
        <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">Memória</p>
        <RememberErrorBoundary><RememberSidebarTree onOpen={onRememberOpen ?? ((date) => navigate(date ? `/remember?date=${encodeURIComponent(date)}` : '/remember'))} /></RememberErrorBoundary>
        {navigator.userAgent.includes('BrainCoreAndroid/1') && (
          <a href="braincore://capture" onClick={() => onClose?.()} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-gray-300 hover:bg-white/[0.04]">🎙 Gravar neste celular</a>
        )}
        <button type="button" onClick={() => { navigate('/notes'); onClose?.(); }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-gray-300 hover:bg-white/[0.04]">📝 Notas</button>
        <button type="button" onClick={() => { navigate('/knowledge'); onClose?.(); }} className="w-full px-2 pt-4 pb-1 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Conhecimento</button>
        <div className="mx-2 my-1 border-t border-[#1f1f1f]" />
        {tree.map(page => (
          <PageNode
            key={page.id}
            page={page}
            activePage={activePage}
            activeAncestorIds={activeAncestorIds}
            onRefresh={onRefresh}
            openIds={visibleOpenIds}
            onToggle={handleToggle}
            drag={drag}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            tree={tree}
            onPageClick={onPageClick}
          />
        ))}

        {adding && (
          <div className="px-2 py-0.5 mt-1">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <input
                autoFocus
                className="w-full bg-white/5 text-[13px] text-gray-200 rounded-md px-2 py-1 outline-none border border-accent/50 focus:border-accent"
                placeholder="Título da página…"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleAddPage('note');
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setAdding(false);
                    setNewTitle('');
                  }
                }}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md bg-white/8 px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/12 transition-colors"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { void handleAddPage('note'); }}
                >
                  Nota
                </button>
                <button
                  type="button"
                  className="rounded-md bg-white/8 px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/12 transition-colors"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { void handleAddPage('infinite'); }}
                >
                  Infinite
                </button>
                <button
                  type="button"
                  className="ml-auto rounded-md px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setAdding(false);
                    setNewTitle('');
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="mx-2 my-2 border-t border-[#1f1f1f]" />
        <SharedSection
          activePage={activePage}
          onOpenPage={(page) => onPageClick?.({ ...page, sort_order: 0, children: [] })}
        />
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-[#1a1a1a] flex items-center gap-2">
        <button
          type="button"
          aria-label="Criar nova página"
          className="flex-1 min-h-10 text-left text-[12px] text-gray-600 hover:text-gray-400 py-0.5 transition-colors"
          onClick={() => { setSearch(''); setAdding(true); setNewTitle(''); }}
        >
          + Nova página
        </button>
        <button
          type="button"
          aria-label="Abrir configurações"
          title="Configurações"
          className="min-h-10 min-w-10 text-gray-600 hover:text-gray-400 text-[14px] leading-none transition-colors p-0.5"
          onClick={() => navigate('/settings')}
        >
          ⚙
        </button>
        <button
          type="button"
          aria-label="Abrir lixeira"
          title="Lixeira"
          className="min-h-10 min-w-10 text-gray-600 hover:text-gray-400 text-[14px] leading-none transition-colors p-0.5"
          onClick={() => setShowTrash(true)}
        >
          🗑
        </button>
      </div>

      {showTrash && (
        <TrashPanel
          onClose={() => setShowTrash(false)}
          onRefresh={onRefresh}
        />
      )}
    </aside>
  );
});
