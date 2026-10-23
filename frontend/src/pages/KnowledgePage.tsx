import { useState } from 'react';
import type { TreePage } from '../types';
import { KnowledgeGraph } from '../components/Graph/KnowledgeGraph';

export function KnowledgePage({
  tree,
  onOpenPage,
  onOpenTree,
}: {
  tree: TreePage[];
  onOpenPage: (page: TreePage) => void;
  onOpenTree: () => void;
}) {
  const [viewMode, setViewMode] = useState<'overview' | 'graph'>('overview');

  if (viewMode === 'graph') {
    return (
      <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#121212]">
        <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#181818] px-4 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#89aef1]">Brain Core</span>
            <span className="text-gray-600">/</span>
            <h1 className="text-sm font-medium text-gray-200">Grafo de Conhecimento</h1>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[#343434] bg-[#222] p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('overview')}
              className="rounded px-2.5 py-1 text-gray-400 hover:text-white transition-colors"
            >
              📄 Visão Geral
            </button>
            <button
              type="button"
              onClick={() => setViewMode('graph')}
              className="rounded bg-[#89aef1]/20 font-medium text-[#89aef1] px-2.5 py-1"
            >
              🕸️ Grafo Interativo
            </button>
          </div>
        </div>
        <KnowledgeGraph onOpenPage={onOpenPage} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#191919] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#89aef1]">Brain Core</p>
            <h1 className="mt-2 text-2xl font-semibold text-[#f3f4f6]">Conhecimento</h1>
            <p className="mt-2 text-sm text-gray-400">Suas páginas e ideias, organizadas na mesma árvore do desktop.</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[#343434] bg-[#222] p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('overview')}
              className="rounded bg-[#89aef1]/20 font-medium text-[#89aef1] px-2.5 py-1"
            >
              📄 Visão Geral
            </button>
            <button
              type="button"
              onClick={() => setViewMode('graph')}
              className="rounded px-2.5 py-1 text-gray-400 hover:text-white transition-colors"
            >
              🕸️ Grafo Interativo
            </button>
          </div>
        </div>
        <button type="button" onClick={onOpenTree} className="mt-5 rounded-xl border border-[#343434] bg-[#242424] px-4 py-3 text-sm font-medium text-white md:hidden">
          Abrir árvore de páginas
        </button>
        <div className="mt-7 border-t border-[#2a2a2a] pt-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Páginas principais</h2>
          {tree.length === 0 ? (
            <p className="rounded-xl border border-[#303030] bg-[#202020] p-4 text-sm text-gray-400">Nenhuma página criada. Abra a árvore para começar.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {tree.map((page) => (
                <button key={page.id} type="button" onClick={() => onOpenPage(page)} className="flex min-h-14 items-center gap-3 rounded-xl border border-[#303030] bg-[#202020] px-4 text-left text-sm text-gray-200 hover:border-[#4b5f7a] hover:bg-[#262626]">
                  <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center text-lg">
                    {page.icon && (/^https?:\/\//.test(page.icon) || page.icon.startsWith('/'))
                      ? <img src={page.icon} alt="" className="h-5 w-5 object-contain" />
                      : page.icon || '📄'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                  {page.children.length > 0 && <span className="text-xs text-gray-500">{page.children.length}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
