import { Extension, type Editor } from '@tiptap/core';
import { Plugin, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

function writeAt(editor: Editor, position: number) {
  if (!editor.isEditable) return false;
  const tr = editor.state.tr.insert(position, editor.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, position + 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}
export const PageWritingGaps = Extension.create({
  name: 'pageWritingGaps',
  addKeyboardShortcuts() {
    const insert = (before: boolean) => {
      const selection = this.editor.state.selection;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'subPageBlock') return false;
      return writeAt(this.editor, before ? selection.from : selection.to);
    };
    return { Enter: () => insert(false), 'Shift-Enter': () => insert(true) };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: {
      decorations(state) {
        if (!editor.isEditable) return DecorationSet.empty;
        const positions = new Set<number>();
        state.doc.forEach((node, position) => {
          if (node.type.name === 'subPageBlock') { positions.add(position); positions.add(position + node.nodeSize); }
        });
        return DecorationSet.create(state.doc, [...positions].map(position => Decoration.widget(position, (_view, getPos) => {
          const button = document.createElement('button');
          button.type = 'button'; button.contentEditable = 'false'; button.className = 'subpage-writing-gap';
          button.setAttribute('aria-label', 'Inserir linha de texto'); button.title = 'Escrever aqui';
          const icon = document.createElement('span'); icon.textContent = '+'; icon.setAttribute('aria-hidden', 'true'); button.append(icon);
          button.addEventListener('mousedown', event => event.preventDefault());
          button.addEventListener('click', () => { const pos = getPos(); if (typeof pos === 'number') writeAt(editor, pos); });
          return button;
        }, { key: `page-writing-${position}`, side: -1, stopEvent: () => true })));
      },
    } })];
  },
});
