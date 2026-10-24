import { api } from '../../api/client';
export class PageMoveError extends Error {
  readonly committed: boolean;
  constructor(message: string, committed: boolean) { super(message); this.committed = committed; }
}
/** Persist the open document before the server atomically cleans its old child card. */
export async function movePageInto(parentId: string, draggedId: string, targetId: string, save: () => Promise<boolean>) {
  if (draggedId === targetId || draggedId === parentId) throw new PageMoveError('Não é possível mover uma página para dentro dela mesma.', false);
  if (!await save()) throw new PageMoveError('Não foi possível salvar suas alterações. Tente salvar antes de mover a página.', false);
  let committed = false;
  try {
    const children = await api.getSubPages(targetId);
    const sort_order = children.length ? Math.max(...children.map(child => child.sort_order)) + 1000 : 0;
    await api.patchPage(draggedId, { parent_page_id: targetId, sort_order });
    committed = true;
    return await api.getPage(parentId);
  } catch {
    throw new PageMoveError(committed
      ? 'Página movida, mas não foi possível atualizar esta tela. Recarregue a versão salva para continuar.'
      : 'Não foi possível mover a página. Verifique o destino e tente novamente.', committed);
  }
}
