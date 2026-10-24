import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { writePageDrag, clearPageDrag } from './pageDrag';

function draggedCard(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-page-card]')
    ?? target.closest('[data-node-view-wrapper]')?.querySelector<HTMLElement>('[data-page-card]')
    ?? target.closest('.node-subPageBlock')?.querySelector<HTMLElement>('[data-page-card]');
}

/** Register after ProseMirror's native listener, which clears and recreates the drag store. */
export function attachPageDragBridge(root: HTMLElement, editable: () => boolean) {
  const start = (event: Event) => {
    const drag = event as DragEvent;
    if (!editable() || !drag.dataTransfer || !(drag.target instanceof Element)) return;
    const card = draggedCard(drag.target);
    if (!card?.dataset.pageCard) return;
    writePageDrag(drag.dataTransfer, { id: card.dataset.pageCard, title: card.dataset.pageTitle ?? '',
      origin: 'editor', reference: card.dataset.pageSource === 'reference' });
  };
  root.addEventListener('dragstart', start);
  root.addEventListener('dragend', clearPageDrag);
  return () => { root.removeEventListener('dragstart', start); root.removeEventListener('dragend', clearPageDrag); };
}
export const PageDragBridge = Extension.create({
  name: 'pageDragBridge',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      props: { handleDOMEvents: { dragstart(view, event) {
        if (!editor.isEditable) return false;
        const card = draggedCard(event.target);
        if (!card?.dataset.pageCard) return false;
        const wrapper = card.closest('.node-subPageBlock') ?? card;
        const pos = view.posAtDOM(wrapper, 0);
        const node = view.state.doc.nodeAt(pos);
        if (node?.type.name === 'subPageBlock' && node.attrs.pageId === card.dataset.pageCard) {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        }
        return false;
      } } },
      view(view) {
      // EditorView installs its input handlers before creating plugin views.
      const dispose = attachPageDragBridge(view.dom, () => editor.isEditable);
      return { destroy: dispose };
    } })];
  },
});
