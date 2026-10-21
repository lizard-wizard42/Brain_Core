import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isRevisionConflict } from '../../api/client';
import { activeBrowserUserId } from '../../api/browserSession';
import type { NotebookDoc, Page } from '../../types';
import { isNotebookDoc } from './notebookModel';
import { notebookDrafts, type NotebookDraft } from './notebookDrafts';

export function useNotebookDocument(page: Page, readOnly: boolean, onTitleSaved?: () => void) {
  const initial = isNotebookDoc(page.content) ? page.content : null;
  const [document, setDocument] = useState<NotebookDoc | null>(initial);
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | 'conflict'>('saved');
  const [draftWarning, setDraftWarning] = useState(false);
  const [recoverable, setRecoverable] = useState<NotebookDraft | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ document: initial, title: page.title });
  const savedTitle = useRef(page.title), onTitleSavedRef = useRef(onTitleSaved);
  onTitleSavedRef.current = onTitleSaved;
  const revision = useRef(page.revision);
  const dirty = useRef(false), busy = useRef(false), conflict = useRef(false), mounted = useRef(true);
  const blocked = useRef(true);
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const history = useRef<Array<{ document: NotebookDoc; title: string }>>([]);
  const future = useRef<Array<{ document: NotebookDoc; title: string }>>([]);
  const userId = activeBrowserUserId();
  const draftKey = `${userId ?? 'unavailable'}:${page.id}`;

  const queueDraft = useCallback((draft: NotebookDraft | null) => {
    if (!userId) { if (mounted.current) setDraftWarning(true); return; }
    draftQueue.current = draftQueue.current.catch(() => {}).then(() => draft
      ? notebookDrafts.write(draftKey, draft) : notebookDrafts.remove(draftKey)).catch(() => {
      if (mounted.current) setDraftWarning(true);
    });
  }, [draftKey, userId]);

  const flush = useCallback(async (keepalive = false) => {
    if (!dirty.current || busy.current || blocked.current || conflict.current || readOnly || !latest.current.document) return;
    busy.current = true;
    const snapshot = latest.current;
    if (mounted.current) setStatus('saving');
    try {
      const saved = await api.patchPage(page.id, { content: snapshot.document!, title: snapshot.title }, { keepalive });
      revision.current = saved.revision;
      if (savedTitle.current !== snapshot.title) {
        savedTitle.current = snapshot.title;
        onTitleSavedRef.current?.();
      }
      if (latest.current === snapshot) {
        dirty.current = false;
        queueDraft(null);
        if (mounted.current) setStatus('saved');
      } else {
        queueDraft({ ...latest.current, document: latest.current.document!, baseRevision: revision.current });
      }
    } catch (error) {
      conflict.current = isRevisionConflict(error);
      if (mounted.current) setStatus(conflict.current ? 'conflict' : 'error');
      return;
    } finally { busy.current = false; }
    // Serialize writes so every request uses the acknowledgement of the previous one.
    if (dirty.current) void flush(keepalive);
  }, [page.id, queueDraft, readOnly]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (readOnly || !initial || !userId) {
      blocked.current = false; setReady(true);
    } else {
      notebookDrafts.read(draftKey).then(draft => {
        if (!active) return;
        if (draft && isNotebookDoc(draft.document) && typeof draft.title === 'string'
          && (JSON.stringify(draft.document) !== JSON.stringify(initial) || draft.title !== page.title)) {
          setRecoverable(draft);
        } else { blocked.current = false; }
      }).catch(() => { if (active) { blocked.current = false; setDraftWarning(true); } })
        .finally(() => { if (active) setReady(true); });
    }
    return () => {
      active = false; mounted.current = false;
      clearTimeout(timer.current);
      void flush(true);
    };
    // The editor is keyed by page ID; server snapshots must never replace an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, draftKey, readOnly]);

  useEffect(() => {
    const hide = () => { if (window.document.visibilityState === 'hidden') void flush(true); };
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = ''; }
      void flush(true);
    };
    window.document.addEventListener('visibilitychange', hide);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', hide);
    return () => {
      window.document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', hide);
    };
  }, [flush]);

  const apply = useCallback((next: NotebookDoc, nextTitle = latest.current.title, remember = true) => {
    if (readOnly || blocked.current || conflict.current || !isNotebookDoc(next)) return false;
    const previous = latest.current;
    if (remember && previous.document) {
      history.current = [...history.current.slice(-39), { document: previous.document, title: previous.title }];
      future.current = [];
    }
    latest.current = { document: next, title: nextTitle };
    dirty.current = true;
    setDocument(next); setTitle(nextTitle); setStatus('saving');
    queueDraft({ document: next, title: nextTitle, baseRevision: revision.current });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 600);
    return true;
  }, [flush, queueDraft, readOnly]);

  const undo = () => {
    const previous = history.current.pop();
    if (!previous || !latest.current.document) return;
    future.current.push({ document: latest.current.document, title: latest.current.title });
    apply(previous.document, previous.title, false);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !latest.current.document) return;
    history.current.push({ document: latest.current.document, title: latest.current.title });
    apply(next.document, next.title, false);
  };
  const recover = () => {
    if (!recoverable || recoverable.baseRevision !== page.revision) return;
    blocked.current = false;
    apply(recoverable.document, recoverable.title);
    setRecoverable(null);
  };
  const dismissRecovery = () => { queueDraft(null); blocked.current = false; setRecoverable(null); };
  return { document, title, status, ready, recoverable, draftWarning, apply, undo, redo,
    canUndo: history.current.length > 0, canRedo: future.current.length > 0,
    flush, recover, dismissRecovery, getDocument: () => latest.current.document,
    locked: readOnly || !ready || !!recoverable || status === 'conflict' };
}
