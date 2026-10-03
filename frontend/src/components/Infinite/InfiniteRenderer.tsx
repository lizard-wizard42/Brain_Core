import { useCallback, useEffect, useRef, useState } from 'react';
import { Tldraw, createTLStore, defaultShapeUtils, throttle, getSnapshot, loadSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';
import { api } from '../../api/client';
import type { InfiniteDoc, Page } from '../../types';

interface InfiniteRendererProps {
  page: Page;
}

export function InfiniteRenderer({ page }: InfiniteRendererProps) {
  const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }));
  const [loading, setLoading] = useState(true);
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const savingRef = useRef(false);
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const pendingFlushRef = useRef(false);
  const pendingKeepaliveRef = useRef(false);
  const lastSavedRef = useRef<string>('');

  const logInfiniteEvent = useCallback((event: string, payload: Record<string, unknown> = {}) => {
    console.info('[InfiniteRenderer]', {
      event,
      pageId: page.id,
      ...payload,
    });
  }, [page.id]);

  function isInfiniteContent(content: Page['content']): content is InfiniteDoc {
    return typeof content === 'object'
      && content !== null
      && 'tldraw' in content
      && (content as { tldraw?: unknown }).tldraw === true;
  }

  const buildContent = useCallback((): InfiniteDoc => {
    return {
      tldraw: true,
      version: 1,
      data: getSnapshot(store),
    };
  }, [store]);

  const persistSnapshot = useCallback(async (force = false, keepalive = false): Promise<void> => {
    if (!hydratedRef.current) return;

    const content = buildContent();
    const serialized = JSON.stringify(content);
    if (!force && (!dirtyRef.current || serialized === lastSavedRef.current)) return;
    if (savingRef.current) {
      pendingFlushRef.current = true;
      pendingKeepaliveRef.current ||= keepalive;
      return;
    }

    savingRef.current = true;
    setSaveIndicator('saving');
    dirtyRef.current = false;
    try {
      await api.patchPage(page.id, { content }, { keepalive });
      lastSavedRef.current = serialized;
      setLastSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      setSaveIndicator('saved');
      logInfiniteEvent('autosave.success');
    } catch (err) {
      dirtyRef.current = true;
      setSaveIndicator('error');
      console.error('[InfiniteRenderer]', {
        event: 'autosave.error',
        pageId: page.id,
        detail: String(err),
      });
    } finally {
      savingRef.current = false;
      if (pendingFlushRef.current) {
        pendingFlushRef.current = false;
        const nextKeepalive = pendingKeepaliveRef.current;
        pendingKeepaliveRef.current = false;
        void persistSnapshot(force, nextKeepalive);
      }
    }
  }, [buildContent, logInfiniteEvent, page.id]);

  const flushSnapshotOnHide = useCallback(() => {
    // Use the same revision-aware API and acknowledgement rules as autosave.
    void persistSnapshot(false, true);
  }, [persistSnapshot]);

  // Load initial state
  useEffect(() => {
    setLoading(true);
    hydratedRef.current = false;
    dirtyRef.current = false;
    pendingFlushRef.current = false;
    pendingKeepaliveRef.current = false;
    setSaveIndicator('idle');
    store.clear();

    if (isInfiniteContent(page.content)) {
      try {
        const snapshot = page.content.data;
        if (snapshot) {
          loadSnapshot(store, snapshot);
        }
        lastSavedRef.current = JSON.stringify(page.content);
      } catch (err) {
        console.error('[InfiniteRenderer]', {
          event: 'load.error',
          pageId: page.id,
          detail: String(err),
        });
      }
    } else {
      // Normalize legacy/invalid infinite documents to the current snapshot format.
      api.patchPage(page.id, {
        content: { tldraw: true, version: 1, data: getSnapshot(store) },
      }).catch(err => console.error('[InfiniteRenderer]', {
        event: 'migrate.error',
        pageId: page.id,
        detail: String(err),
      }));
    }
    hydratedRef.current = true;
    setLoading(false);
  }, [page.id, store, page.content]);

  // Persist changes
  useEffect(() => {
    const save = throttle(() => { void persistSnapshot(); }, 3000);
    const cleanup = store.listen(() => {
      // Mark changes immediately; hiding during the debounce must still flush.
      dirtyRef.current = true;
      if (!savingRef.current) setSaveIndicator('saving');
      save();
    });

    return () => cleanup();
  }, [page.id, store, persistSnapshot]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSnapshotOnHide();
      }
    };

    const handlePageHide = () => {
      flushSnapshotOnHide();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      flushSnapshotOnHide();
    };
  }, [flushSnapshotOnHide]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#191919] text-gray-500 text-sm">
        Carregando Infinite Space…
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden bg-[#191919] tldraw-container">
      {/* tldraw draws its "made with tldraw" watermark in the bottom-right corner, so the
          status pill stays clear of it: above the toolbar on mobile, left of it on desktop. */}
      <div
        data-testid="infinite-save-status"
        className="pointer-events-none absolute bottom-16 right-3 z-[120] md:bottom-3 md:right-32"
      >
        <div
          role="status"
          aria-live="polite"
          style={{ background: 'var(--theme-card)', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}
          className="rounded-full border backdrop-blur px-3 py-1.5 text-[11px] shadow-lg"
        >
          {saveIndicator === 'saving' && 'Salvando...'}
          {saveIndicator === 'saved' && `Salvo${lastSavedAt ? ` ${lastSavedAt}` : ''}`}
          {saveIndicator === 'error' && 'Erro ao salvar'}
          {saveIndicator === 'idle' && (lastSavedAt ? `Salvo ${lastSavedAt}` : 'Infinite')}
        </div>
      </div>
      <Tldraw 
        store={store} 
        autoFocus
      />
    </div>
  );
}
