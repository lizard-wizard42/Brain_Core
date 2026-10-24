import type { TiptapDoc } from '../../types';

export interface TextEditorDraft { content: TiptapDoc; title: string; baseRevision: number }

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('brain-core-text-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Draft database blocked'));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = run(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const textEditorDrafts = {
  read: (key: string) => transaction<TextEditorDraft | undefined>('readonly', store => store.get(key)),
  write: async (key: string, draft: TextEditorDraft): Promise<void> => { await transaction('readwrite', store => store.put(draft, key)); },
  remove: async (key: string): Promise<void> => { await transaction('readwrite', store => store.delete(key)); },
};
