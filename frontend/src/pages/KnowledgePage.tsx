import type { TreePage } from '../types';

export function KnowledgePage({
  tree,
  onOpenPage,
  onOpenTree,
}: {
  tree: TreePage[];
  onOpenPage: (page: TreePage) => void;
  onOpenTree: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-[#191919] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#89aef1]">Brain Core</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#f3f4f6]">Conhecimento</h1>
        <p className="mt-2 text-sm text-gray-400">Suas páginas e ideias, organizadas na mesma árvore do desktop.</p>
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
