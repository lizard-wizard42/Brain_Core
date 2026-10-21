import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { notebookDrafts } from './notebookDrafts';
import { newNotebook } from './notebookModel';

describe('Notebook draft persistence', () => {
  it('commits a complete editable draft and keeps account keys isolated', async () => {
    const draft = { document: newNotebook(), title: 'Fictional draft', baseRevision: 4 };
    await notebookDrafts.write('account-a:shared-page', draft);
    expect(await notebookDrafts.read('account-a:shared-page')).toEqual(draft);
    expect(await notebookDrafts.read('account-b:shared-page')).toBeUndefined();
    await notebookDrafts.remove('account-a:shared-page');
    expect(await notebookDrafts.read('account-a:shared-page')).toBeUndefined();
  });
});
