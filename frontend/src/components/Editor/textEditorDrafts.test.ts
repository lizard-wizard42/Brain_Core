import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { textEditorDrafts } from './textEditorDrafts';
import type { TiptapDoc } from '../../types';
describe('Text draft storage', () => {
  it('persists exact Tiptap blocks and title, isolating account and page keys', async () => {
    const content: TiptapDoc = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: '  const test = 1;\n' }] }] };
    const draft = { content, title: 'Fictional study', baseRevision: 7 };
    await textEditorDrafts.write('fictional-a:page-a', draft);
    expect(await textEditorDrafts.read('fictional-a:page-a')).toEqual(draft);
    expect(await textEditorDrafts.read('fictional-b:page-a')).toBeUndefined();
    expect(await textEditorDrafts.read('fictional-a:page-b')).toBeUndefined();
    await textEditorDrafts.remove('fictional-a:page-a');
    expect(await textEditorDrafts.read('fictional-a:page-a')).toBeUndefined();
  });
});
