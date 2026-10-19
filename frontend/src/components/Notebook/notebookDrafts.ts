import type { NotebookDoc } from '../../types';

export interface NotebookDraft { document: NotebookDoc; title: string; baseRevision: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('brain-core-notebook-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Draft database blocked'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = run(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

// Account-scoped keys prevent a later login on the same browser from opening another account's draft.
export const notebookDrafts = {
  read: (key: string) => transaction<NotebookDraft | undefined>('readonly', store => store.get(key)),
  write: (key: string, draft: NotebookDraft) => transaction('readwrite', store => store.put(draft, key)),
  remove: (key: string) => transaction('readwrite', store => store.delete(key)),
};
