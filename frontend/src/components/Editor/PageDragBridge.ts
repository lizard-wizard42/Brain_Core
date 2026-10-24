import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { writePageDrag, clearPageDrag } from './pageDrag';

/** Register after ProseMirror's native listener, which clears and recreates the drag store. */
export function attachPageDragBridge(root: HTMLElement, editable: () => boolean) {
  const start = (event: Event) => {
    const drag = event as DragEvent;
    if (!editable() || !drag.dataTransfer || !(drag.target instanceof Element)) return;
    // Native dragging may retarget the NodeView wrapper instead of the inner handle.
    const card = drag.target.closest<HTMLElement>('[data-page-card]')
      ?? drag.target.closest('[data-node-view-wrapper]')?.querySelector<HTMLElement>('[data-page-card]');
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
    return [new Plugin({ view(view) {
      // EditorView installs its input handlers before creating plugin views.
      const dispose = attachPageDragBridge(view.dom, () => editor.isEditable);
      return { destroy: dispose };
    } })];
  },
});
