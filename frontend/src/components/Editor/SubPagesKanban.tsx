import { useEffect, useState, useMemo } from 'react';
import { api } from '../../api/client';
import type { PageSummary } from '../../types';

interface SubPagesKanbanProps {
  pageId: string;
  onNavigatePage?: (page: { id: string; title: string; icon?: string | null }) => void;
  onRefreshParent?: () => void;
}

const COLUMNS = [
  { id: 'todo', label: 'A Fazer', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.1)', border: '#334155' },
  { id: 'in_progress', label: 'Em Andamento', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.1)', border: '#0369a1' },
  { id: 'done', label: 'Concluído', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.1)', border: '#15803d' },
  { id: 'no_status', label: 'Sem Status', color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.05)', border: '#27272a' },
];

export function SubPagesKanban({ pageId, onNavigatePage, onRefreshParent }: SubPagesKanbanProps) {
  const [subPages, setSubPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const loadSubPages = () => {
    if (typeof api.getSubPages !== 'function') {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.getSubPages(pageId)
      .then(items => {
        setSubPages(items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadSubPages();
  }, [pageId]);

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };

  const handleDrop = async (newStatus: string) => {
    if (!draggedId) return;
    const targetPage = subPages.find(p => p.id === draggedId);
    if (!targetPage) return;

    const actualStatus = newStatus === 'no_status' ? null : newStatus;
    if (targetPage.status === actualStatus) {
      setDraggedId(null);
      return;
    }

    // Optimistic UI update
    setSubPages(prev =>
      prev.map(p => (p.id === draggedId ? { ...p, status: actualStatus } : p))
    );
    setDraggedId(null);

    try {
      await api.patchPage(draggedId, { status: actualStatus });
      onRefreshParent?.();
    } catch {
      loadSubPages(); // Rollback on error
    }
  };

  const columnsData = useMemo(() => {
    return COLUMNS.map(col => ({
      ...col,
      pages: subPages.filter(p => {
        if (col.id === 'no_status') {
          return !p.status || !['todo', 'in_progress', 'done'].includes(p.status);
        }
        return p.status === col.id;
      }),
    }));
  }, [subPages]);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--theme-muted)]">
        Carregando subpáginas para o Kanban…
      </div>
    );
  }

  return (
    <div className="mt-4 pb-8">
      <div className="mb-3 flex items-center justify-between text-xs text-[var(--theme-muted)]">
        <span>{subPages.length} subpáginas vinculadas</span>
        <span>Arraste os cartões entre as colunas para atualizar o status</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {columnsData.map(col => (
          <div
            key={col.id}
            onDragOver={e => e.preventDefault()}
            onDrop={() => void handleDrop(col.id)}
            className="flex flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 min-h-[220px]"
          >
            {/* Column Header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                <h3 className="text-xs font-semibold text-[var(--theme-text)]">
                  {col.label}
                </h3>
              </div>
              <span className="rounded bg-[var(--theme-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-muted)]">
                {col.pages.length}
              </span>
            </div>

            {/* Column Cards */}
            <div className="flex flex-1 flex-col gap-2">
              {col.pages.map(p => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => handleDragStart(p.id)}
                  onClick={() => onNavigatePage?.({ id: p.id, title: p.title, icon: p.icon })}
                  className={`group relative cursor-grab rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2.5 transition-all hover:border-[var(--theme-primary)] hover:shadow-sm active:cursor-grabbing ${
                    draggedId === p.id ? 'opacity-40' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm shrink-0">{p.icon || '📄'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--theme-text)] group-hover:text-[var(--theme-primary)]">
                        {p.title || 'Sem título'}
                      </p>
                      {p.due_date && (
                        <p className="mt-1 text-[10px] text-amber-500">
                          📅 {p.due_date.includes('-') ? p.due_date.slice(0, 10).split('-').reverse().join('/') : p.due_date}
                        </p>
                      )}
                      {p.tags && p.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.tags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="rounded bg-[var(--theme-hover)] px-1 py-0.2 text-[9px] text-[var(--theme-muted)]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {col.pages.length === 0 && (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--theme-border)] py-6 text-[11px] text-[var(--theme-muted)] opacity-60">
                  Solte aqui
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
