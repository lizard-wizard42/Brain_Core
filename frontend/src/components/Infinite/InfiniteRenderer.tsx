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

  const persistSnapshot = useCallback(async (force = false): Promise<void> => {
    if (!hydratedRef.current) return;

    const content = buildContent();
    const serialized = JSON.stringify(content);
    if (!force && (!dirtyRef.current || serialized === lastSavedRef.current)) return;
    if (savingRef.current) {
      pendingFlushRef.current = true;
      return;
    }

    savingRef.current = true;
    setSaveIndicator('saving');
    dirtyRef.current = false;
    try {
      await api.patchPage(page.id, { content });
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
        void persistSnapshot(force);
      }
    }
  }, [buildContent, logInfiniteEvent, page.id]);

  const flushSnapshotOnHide = useCallback(() => {
    if (!hydratedRef.current || !dirtyRef.current) return;

    const content = buildContent();
    const serialized = JSON.stringify(content);
    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');

    fetch(`${baseUrl}/api/pages/${page.id}`, {
      method: 'PATCH',
      keepalive: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }).then(() => {
      setSaveIndicator('saved');
      setLastSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      logInfiniteEvent('autosave.flush');
    }).catch((err) => {
      setSaveIndicator('error');
      console.error('[InfiniteRenderer]', {
        event: 'autosave.flush.error',
        pageId: page.id,
        detail: String(err),
      });
    });

    dirtyRef.current = false;
    lastSavedRef.current = serialized;
  }, [buildContent, logInfiniteEvent, page.id]);

  // Load initial state
  useEffect(() => {
    setLoading(true);
    hydratedRef.current = false;
    dirtyRef.current = false;
    pendingFlushRef.current = false;
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
    const cleanup = store.listen(
      throttle(() => {
        dirtyRef.current = true;
        if (!savingRef.current) setSaveIndicator('saving');
        void persistSnapshot();
      }, 3000)
    );

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
      <div className="pointer-events-none absolute bottom-3 right-3 z-[120]">
        <div className="rounded-full border border-white/10 bg-[#111111]/80 backdrop-blur px-3 py-1.5 text-[11px] text-gray-400 shadow-lg">
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
