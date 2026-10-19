import './sidebarFooter.css';
import './sidebar.css';
import { NewPageForm } from './NewPageForm';
import { NotebookIcon } from '../Notebook/NotebookIcon';
import { UnifiedSearchResults } from '../Search/UnifiedSearchResults';
import { memo, useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';
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
  return typeof icon === 'string' && /^(?:\/|https?:\/\/|data:image\/(?:svg\+xml|png|jpeg|gif|webp)[;,])/i.test(icon);
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
      <div className="bg-[var(--theme-background)] border border-[var(--theme-border)] rounded-xl shadow-xl p-5 w-80 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-[var(--theme-text)]">Confirmar exclusão</h2>
          <p className="text-[13px] text-[var(--theme-muted)]">{message}</p>
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids])); }
  catch { /* Navigation still works when browser storage is unavailable. */ }
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
  page, activePage, onRefresh, openIds, onToggle, depth = 0,
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = useId();
  const actionsPanelRef = useRef<HTMLDivElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsPanelRef.current?.contains(event.target) && !actionsButtonRef.current?.contains(event.target)) setActionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [actionsOpen]);
  const [iconAnchorRect, setIconAnchorRect] = useState<DOMRect | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleAddPage = async (type: 'note' | 'infinite' | 'notebook' = 'note') => {
    if (!newTitle.trim()) return;
    const slug = toSlug(newTitle);
    try {
      const created = await api.createPage({ 
        parent_page_id: page.id, 
        title: newTitle.trim(), 
        slug,
        type 
      });
      await onRefresh().catch(() => {});
      setAdding(false);
      setNewTitle('');
      onToggle(page.id, true);
      
      if (onPageClick) {
        onPageClick({ ...created, children: [] });
      } else {
        navigate(`/page/${created.id}`);
      }
    } catch {
      throw new Error('Page creation failed');
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

  const indent = 2 + Math.min(depth, 3) * 12;

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
      onKeyDown={event => {
        if (event.key === 'Escape' && actionsOpen) {
          event.stopPropagation(); setActionsOpen(false); actionsButtonRef.current?.focus();
        }
      }}
    >
      {/* Drop indicator — BEFORE */}
      {isOver && dropPos === 'before' && (
        <div style={{ marginLeft: `${indent}px` }} className="h-[2px] bg-blue-500 rounded-full mx-1 -mb-px" />
      )}

      <div
        ref={rowRef}
        className={`group sidebar-page-row ${isOver && dropPos === 'inside' ? 'ring-1 ring-blue-500/60 bg-blue-500/5' : ''}`}
        data-active={isActive || undefined}
        style={{ paddingLeft: `${indent}px`, paddingRight: '0' }}
        onMouseDown={e => {
          if (e.button !== 1 || renaming) return;
          e.preventDefault();
          e.stopPropagation();
          if (onPageClick) onPageClick(page, true);
          else window.open("/page/" + page.id, "_blank");
        }}
        onAuxClick={e => e.preventDefault()}
        onDragOver={handleDragOverRow}
        onDragLeave={handleDragLeaveRow}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(); }}
      >
        {/* Drag handle */}
        <span
          className="sidebar-drag-handle"
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
            className="sidebar-node-toggle"
            aria-expanded={open}
            style={{ transform: open ? 'none' : 'rotate(-90deg)' }}
            onClick={e => { e.stopPropagation(); onToggle(page.id); }}
          >
            ▾
          </button>
        ) : (
          <span className="sidebar-node-spacer" aria-hidden="true" />
        )}

        {/* Ícone */}
        <button
          type="button"
          aria-label="Trocar ícone"
          title="Trocar ícone"
          className="sidebar-node-icon"
          onClick={e => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setIconAnchorRect((current) => (current ? null : rect));
          }}
        >
          {page.type === 'notebook' && !page.icon ? <NotebookIcon width={16} height={16} /> : renderPageIcon(page.icon)}
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
          <button type="button" className="sidebar-page-title" title={page.title} draggable
            onDragStart={event => { event.stopPropagation(); onDragStart(page.id); }}
            onDragEnd={event => { event.stopPropagation(); onDragEnd(); }}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => { setActionsOpen(false); if (onPageClick) onPageClick(page); else navigate(`/page/${page.id}`); }}>
            {page.title}
          </button>
        )}

        <button type="button" ref={actionsButtonRef} className="sidebar-page-menu"
          aria-label={`Ações de ${page.title}`} title="Ações da página"
          aria-expanded={actionsOpen} aria-controls={actionsOpen ? actionsId : undefined}
          onClick={() => setActionsOpen(value => !value)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
        </button>
      </div>
      {actionsOpen && <div ref={actionsPanelRef} id={actionsId} role="group" aria-label={`Opções de ${page.title}`} className="sidebar-page-actions">
        <button type="button" title="Nova página aqui" onClick={() => { setActionsOpen(false); setAdding(true); onToggle(page.id, true); setNewTitle(''); }}>+ Subpágina</button>
        <button type="button" title="Renomear" onClick={() => { setActionsOpen(false); setTitle(page.title); setRenaming(true); }}>Renomear</button>
        <button type="button" title="Apagar" onClick={() => { setActionsOpen(false); setShowDeleteConfirm(true); }}>Lixeira</button>
      </div>}

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
          message={`Apagar "${page.title}"${hasChildren ? ' e todo seu conteúdo' : ''}? A página será movida para a lixeira e poderá ser restaurada.`}
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
            <div style={{ paddingLeft: `${Math.min(38, 10 + (depth + 1) * 14)}px`, paddingRight: '8px' }}>
              <NewPageForm nested title={newTitle} onTitleChange={setNewTitle} onCreate={handleAddPage}
                onCancel={() => { setAdding(false); setNewTitle(''); }} />
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

  const activePath = useMemo(() => {
    const ids = new Set<string>();
    let cursor = activePage;
    while (cursor && parentById.has(cursor) && !ids.has(cursor)) {
      ids.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    return JSON.stringify([...ids]);
  }, [activePage, parentById]);

  // Adjust only for a changed selection/path, never for manual expansion changes.
  const [revealedPath, setRevealedPath] = useState('');
  if (revealedPath !== activePath) {
    setRevealedPath(activePath);
    const path: string[] = JSON.parse(activePath);
    if (path.length) setOpenIds(previous => new Set([...previous, ...path]));
  }

  const branchIds = useMemo(() => {
    const ids = new Set<string>();
    const visit = (nodes: TreePage[]) => nodes.forEach(node => {
      if (node.children.length) { ids.add(node.id); visit(node.children); }
    });
    visit(tree);
    return ids;
  }, [tree]);
  const allExpanded = branchIds.size > 0 && [...branchIds].every(id => openIds.has(id));
  const toggleAll = () => {
    const next = allExpanded ? new Set<string>() : new Set(branchIds);
    setOpenIds(next);
  };

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
    saveOpenIds(visibleOpenIds);
  }, [visibleOpenIds]);

  const handleToggle = useCallback((id: string, force?: boolean) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (force === true) {
        next.add(id);
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
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

  const handleAddPage = async (type: 'note' | 'infinite' | 'notebook' = 'note') => {
    if (!newTitle.trim()) return;
    const slug = toSlug(newTitle);
    try {
      const created = await api.createPage({ title: newTitle.trim(), slug, type });
      await onRefresh().catch(() => {});
      setAdding(false);
      setNewTitle('');

      if (onPageClick) {
        onPageClick({ ...created, children: [] });
      } else {
        navigate(`/page/${created.id}`);
      }
    } catch {
      throw new Error('Page creation failed');
    }
  };

  return (
    <aside className="brain-sidebar w-[min(86vw,320px)] md:w-56 h-full flex flex-col shrink-0" style={{ height: 'var(--app-viewport-height, 100%)' }}>
      {/* Header */}
      <div className="sidebar-brand-row">
        <button type="button"
          className="sidebar-brand"
          onClick={() => { navigate('/'); onClose?.(); }}
          aria-label="Brain Core: abrir Dashboard"
        >
          <img src={appIconUrl} alt="Brain Core" className="w-[18px] h-[18px] rounded-sm object-cover" />
          <span className="font-semibold text-[13px]">Brain Core</span>
        </button>
        {/* Botão fechar — só aparece no mobile */}
        {onClose && (
          <button
            onClick={onClose}
            className="sidebar-close md:hidden"
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
          aria-label="Buscar páginas e notas"
          maxLength={200}
          className="sidebar-search"
        />
      </div>

      <details className="sidebar-mobile-tabs md:hidden">
        <summary className="sidebar-tabs-summary">Abas abertas ({tabs.length})</summary>
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          <button type="button" onClick={() => { onNewTab?.(); onClose?.(); }} className="sidebar-tab-tool">+ Nova aba</button>
          <button type="button" onClick={() => { onGoBack?.(); onClose?.(); }} className="sidebar-tab-tool">← Voltar</button>
          <button type="button" onClick={onCloseAllTabs} disabled={tabs.length === 0} className="sidebar-tab-tool">Fechar todas</button>
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
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--theme-border) transparent' }}
        onDragOver={e => e.preventDefault()}
      >
        {search.trim() ? (
          <UnifiedSearchResults query={search.trim()} onPageClick={onPageClick} onClose={onClose} />
        ) : (
          <>
        <p className="sidebar-section-label">Memória</p>
        <RememberErrorBoundary><RememberSidebarTree onOpen={onRememberOpen ?? ((date) => navigate(date ? `/remember?date=${encodeURIComponent(date)}` : '/remember'))} /></RememberErrorBoundary>
        {navigator.userAgent.includes('BrainCoreAndroid/1') && (
          <a href="braincore://capture" onClick={() => onClose?.()} className="sidebar-nav-link">🎙 Gravar neste celular</a>
        )}
        <button type="button" onClick={() => { navigate('/notes'); onClose?.(); }} className="sidebar-nav-link">📝 Notas</button>
        <div className="sidebar-section-header">
          <button type="button" onClick={() => { navigate('/knowledge'); onClose?.(); }} className="sidebar-section-name">Conhecimento</button>
          <button type="button" onClick={() => { navigate('/knowledge'); onClose?.(); }}
            aria-label="Abrir visão geral de Conhecimento" title="Visão geral de Conhecimento"
            className="sidebar-section-tool">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button type="button" onClick={toggleAll} disabled={!branchIds.size}
            aria-label={allExpanded ? 'Recolher toda a árvore de Conhecimento' : 'Expandir toda a árvore de Conhecimento'}
            title={allExpanded ? 'Recolher tudo' : 'Expandir tudo'}
            className="sidebar-section-tool">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d={allExpanded ? 'm7 4 5 5 5-5M7 20l5-5 5 5' : 'm7 9 5-5 5 5M7 15l5 5 5-5'} />
            </svg>
          </button>
        </div>
        <div className="sidebar-divider" />
        {tree.map(page => (
          <PageNode
            key={page.id}
            page={page}
            activePage={activePage}
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
            <NewPageForm title={newTitle} onTitleChange={setNewTitle} onCreate={handleAddPage}
              onCancel={() => { setAdding(false); setNewTitle(''); }} />
          </div>
        )}
        <div className="sidebar-divider sidebar-divider-spaced" />
        <SharedSection
          activePage={activePage}
          onOpenPage={(page) => onPageClick?.({ ...page, sort_order: 0, children: [] })}
        />
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          type="button"
          aria-label="Criar nova página"
          className="sidebar-footer-create"
          onClick={() => { setSearch(''); setAdding(true); setNewTitle(''); }}
        >
          + Nova página
        </button>
        <button
          type="button"
          aria-label="Abrir configurações"
          title="Configurações"
          className="sidebar-footer-tool"
          onClick={() => navigate('/settings')}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3Z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button
          type="button"
          aria-label="Abrir lixeira"
          title="Lixeira"
          className="sidebar-footer-tool"
          onClick={() => setShowTrash(true)}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>
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
