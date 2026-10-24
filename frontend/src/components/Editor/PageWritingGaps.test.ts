import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection } from '@tiptap/pm/state';
import { SubPageBlock } from './SubPageBlock';
import { PageWritingGaps } from './PageWritingGaps';
let editor: Editor;
afterEach(() => editor?.destroy());
const card = (id: string) => ({ type: 'subPageBlock', attrs: { pageId: id, title: id, source: 'child' } });
function create(editable = true) {
  editor = new Editor({ element: document.createElement('div'), editable, extensions: [StarterKit, SubPageBlock, PageWritingGaps], content: { type: 'doc', content: [card('alpha'), card('beta')] } });
}
describe('Writing between page cards', () => {
  it('provides one writing point per boundary without changing saved content', () => {
    create(); const before = editor.getJSON();
    expect(editor.view.dom.querySelectorAll('button[aria-label="Inserir linha de texto"]')).toHaveLength(3);
    expect(editor.getJSON()).toEqual(before); expect(editor.getHTML()).not.toContain('Inserir linha');
  });
  it('inserts a real editable paragraph between cards and preserves their order', () => {
    create();
    (editor.view.dom.querySelectorAll('button[aria-label="Inserir linha de texto"]')[1] as HTMLButtonElement).click();
    expect(editor.getJSON().content?.map(n => n.type)).toEqual(['subPageBlock', 'paragraph', 'subPageBlock']);
    editor.commands.insertContent('Fictional writing');
    expect(editor.getJSON().content?.[1].content?.[0].text).toBe('Fictional writing');
    expect(editor.getJSON().content?.[2].attrs?.pageId).toBe('beta');
  });
  it('lets Enter write after a selected card and Shift+Enter write before it', () => {
    create(); editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    expect(editor.commands.keyboardShortcut('Enter')).toBe(true);
    expect(editor.getJSON().content?.[1].type).toBe('paragraph');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    editor.commands.keyboardShortcut('Shift-Enter');
    expect(editor.getJSON().content?.[0].type).toBe('paragraph');
  });
  it('does not offer insertion controls on a read-only page', () => {
    create(false);
    expect(editor.view.dom.querySelector('button[aria-label="Inserir linha de texto"]')).toBeNull();
  });
});
