import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isRevisionConflict } from '../../api/client';
import { activeBrowserUserId } from '../../api/browserSession';
import type { Page, TiptapDoc } from '../../types';
import { computeSavePayloadHash, type SaveStatus } from './editorUtils';
import { textEditorDrafts, type TextEditorDraft } from './textEditorDrafts';

type Snapshot = Pick<TextEditorDraft, 'content' | 'title'>;
type SaveOptions = { keepalive?: boolean; reloadVersions?: boolean };
const hash = (snapshot: Snapshot) => computeSavePayloadHash(snapshot.content, snapshot.title);

/** One mounted instance per page. Local writes and server saves each have an ordered queue. */
export function useTextEditorPersistence(page: Page, onSaved?: () => void) {
  const [userId] = useState(activeBrowserUserId);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [ready, setReady] = useState(!userId);
  const [recoverable, setRecoverable] = useState<TextEditorDraft | null>(null);
  const [draftWarning, setDraftWarning] = useState(!userId);
  const [conflict, setConflict] = useState(false);
  const key = `${userId}:${page.id}`;
  const mounted = useRef(true), blocked = useRef(Boolean(userId)), conflicted = useRef(false), suspended = useRef(false);
  const revision = useRef(page.revision);
  const latest = useRef<Snapshot>({ content: page.content as TiptapDoc, title: page.title });
  const savedHash = useRef(hash({ content: page.content as TiptapDoc, title: page.title }));
  const dirty = useRef(false);
  const pendingSaves = useRef(0);
  const unacknowledged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const localQueue = useRef<Promise<unknown>>(Promise.resolve());
  const serverQueue = useRef<Promise<void>>(Promise.resolve());
  const recovery = useRef<TextEditorDraft | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const sameAccount = useCallback(() => Boolean(userId) && !suspended.current && activeBrowserUserId() === userId, [userId]);
  const updateStatus = useCallback((next: SaveStatus) => { if (mounted.current) setStatus(next); }, []);
  const queueDraft = useCallback((draft: TextEditorDraft | null) => {
    if (!userId) { if (mounted.current) setDraftWarning(true); return Promise.resolve(); }
    // The key belongs to the captured account, including while its view is unmounting.
    localQueue.current = localQueue.current.catch(() => {}).then(() => draft
      ? textEditorDrafts.write(key, draft) : textEditorDrafts.remove(key)).catch(() => {
      if (mounted.current) setDraftWarning(true);
    });
    return localQueue.current;
  }, [key, userId]);

  const flush = useCallback((options?: SaveOptions): Promise<void> => {
    clearTimeout(timer.current);
    if (blocked.current || conflicted.current || !sameAccount() || !dirty.current) return Promise.resolve();
    const snapshot = latest.current;
    pendingSaves.current += 1;
    const operation = serverQueue.current.catch(() => {}).then(async () => {
      if (blocked.current || conflicted.current || !sameAccount()) return;
      // A failed request may have reached the server: a dirty reverted snapshot
      // still needs acknowledgement, even when it matches our last known base.
      if (!dirty.current && hash(snapshot) === savedHash.current) return;
      updateStatus('saving');
      try {
        const saved = await api.savePage(page.id, { ...snapshot, revision: revision.current }, { keepalive: options?.keepalive ?? false });
        if (!sameAccount()) return;
        unacknowledged.current = false;
        revision.current = saved.revision;
        savedHash.current = hash(snapshot);
        dirty.current = hash(latest.current) !== savedHash.current;
        if (dirty.current) {
          await queueDraft({ ...latest.current, baseRevision: revision.current });
        } else {
          await queueDraft(null);
          // A new edit may arrive while IndexedDB is committing the deletion.
          if (hash(latest.current) === savedHash.current) updateStatus('saved');
        }
        if (options?.reloadVersions) onSavedRef.current?.();
      } catch (error) {
        unacknowledged.current = true;
        if (isRevisionConflict(error)) {
          conflicted.current = true;
          if (mounted.current) setConflict(true);
          updateStatus('conflict');
        } else updateStatus('error');
        // Draft remains recoverable. UI exposes retry instead of rejecting lifecycle events.
      }
    }).finally(() => { pendingSaves.current -= 1; });
    serverQueue.current = operation;
    return operation;
  }, [page.id, queueDraft, sameAccount, updateStatus]);

  const change = useCallback((content: TiptapDoc, title: string) => {
    if (blocked.current || !sameAccount()) return;
    latest.current = { content, title };
    dirty.current = pendingSaves.current > 0 || unacknowledged.current || conflicted.current
      || hash(latest.current) !== savedHash.current;
    // Persist before the debounce so closing the view doesn't depend on a network request.
    void queueDraft(dirty.current ? { content, title, baseRevision: revision.current } : null);
    clearTimeout(timer.current);
    if (conflicted.current) return;
    if (!dirty.current) { updateStatus('saved'); return; }
    updateStatus('saving');
    timer.current = setTimeout(() => { void flush({ reloadVersions: true }); }, 1500);
  }, [flush, queueDraft, sameAccount, updateStatus]);

  const saveNow = useCallback(async (content: TiptapDoc, title: string, options?: SaveOptions) => {
    change(content, title);
    await flush(options);
  }, [change, flush]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (userId) {
      textEditorDrafts.read(key).then(draft => {
        if (!active || !sameAccount()) return;
        if (draft && draft.content?.type === 'doc' && Array.isArray(draft.content.content)
          && typeof draft.title === 'string' && Number.isSafeInteger(draft.baseRevision)) {
          if (hash(draft) !== savedHash.current) {
            recovery.current = draft; setRecoverable(draft);
            return;
          }
          void queueDraft(null);
        }
        blocked.current = false;
      }).catch(() => {
        if (active) { blocked.current = false; setDraftWarning(true); }
      }).finally(() => { if (active) setReady(true); });
    }
    const closing = () => { void flush({ keepalive: true }); };
    const ended = () => { suspended.current = true; clearTimeout(timer.current); };
    window.addEventListener('pagehide', closing);
    window.addEventListener('brain-core:session-ended', ended);
    return () => {
      active = false; mounted.current = false; clearTimeout(timer.current);
      window.removeEventListener('pagehide', closing);
      window.removeEventListener('brain-core:session-ended', ended);
      closing();
    };
  }, [flush, key, queueDraft, sameAccount, userId]);

  const recover = useCallback(() => {
    const draft = recovery.current;
    if (!draft || !sameAccount()) return null;
    recovery.current = null; setRecoverable(null); blocked.current = false;
    if (draft.baseRevision !== revision.current) {
      conflicted.current = true; setConflict(true); updateStatus('conflict');
    }
    change(draft.content, draft.title);
    return draft;
  }, [change, sameAccount, updateStatus]);

  const discard = useCallback(async (fresh: Page) => {
    clearTimeout(timer.current);
    // Discard is explicit; callers first fetch the current server document.
    blocked.current = true;
    await serverQueue.current;
    latest.current = { content: fresh.content as TiptapDoc, title: fresh.title };
    unacknowledged.current = false;
    revision.current = fresh.revision; savedHash.current = hash(latest.current); dirty.current = false;
    await queueDraft(null);
    recovery.current = null; setRecoverable(null); conflicted.current = false; setConflict(false);
    blocked.current = false; updateStatus('idle');
  }, [queueDraft, updateStatus]);

  const acceptMetadata = useCallback((saved: Page) => {
    // Icon/cover saves may advance the revision without changing the document.
    // Adopt only acknowledgements whose content still matches our saved base.
    if (!sameAccount() || !saved?.content || saved.id !== page.id || saved.revision <= revision.current
      || hash({ content: saved.content as TiptapDoc, title: saved.title }) !== savedHash.current) return;
    revision.current = saved.revision;
    if (dirty.current) void queueDraft({ ...latest.current, baseRevision: saved.revision });
  }, [page.id, queueDraft, sameAccount]);

  const currentDraft = useCallback((): TextEditorDraft => recovery.current ?? { ...latest.current, baseRevision: revision.current }, []);
  return { status, ready, recoverable, draftWarning, conflict, change, flush, saveNow, recover, discard, currentDraft, acceptMetadata };
}
