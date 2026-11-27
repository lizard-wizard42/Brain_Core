import { useCallback, useEffect, useRef, useState } from 'react';
import { Tldraw, createTLStore, createShapeId, defaultShapeUtils, throttle, getSnapshot, loadSnapshot } from 'tldraw';
import type { Editor, TLShapeId } from 'tldraw';
import 'tldraw/tldraw.css';
import { api } from '../../api/client';
import type { InfiniteDoc, Page } from '../../types';
import { DesignInspector } from '../Design/DesignInspector';
import { DesignOutline } from '../Design/DesignOutline';
import { DesignCardShapeUtil } from '../Design/DesignCardShape';
import { DESIGN_CARD_TYPE, cardDefaults } from '../Design/designCardModel';

interface InfiniteRendererProps {
  page: Page;
}

interface DesignFrame { id: TLShapeId; name: string; width: number; height: number }
const designPresets = [
  { label: 'Post quadrado', width: 1080, height: 1080 },
  { label: 'Feed 4:5', width: 1080, height: 1350 },
  { label: 'Story', width: 1080, height: 1920 },
  { label: 'Tela desktop', width: 1440, height: 900 },
];

export function InfiniteRenderer({ page }: InfiniteRendererProps) {
  const isDesign = page.type === 'design';
  const [store] = useState(() => createTLStore({ shapeUtils: isDesign ? [...defaultShapeUtils, DesignCardShapeUtil] : defaultShapeUtils }));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [frames, setFrames] = useState<DesignFrame[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<TLShapeId | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<TLShapeId | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [exportScale, setExportScale] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const savingRef = useRef(false);
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const pendingFlushRef = useRef(false);
  const pendingKeepaliveRef = useRef(false);
  const lastSavedRef = useRef<string>('');

  const refreshFrames = useCallback((current: Editor) => {
    const next = current.getCurrentPageShapes().filter(shape => shape.type === 'frame').map(shape => {
      const props = shape.props as { name: string; w: number; h: number };
      return { id: shape.id, name: props.name, width: props.w, height: props.h };
    });
    setFrames(next);
    setActiveFrameId(previous => previous && next.some(frame => frame.id === previous) ? previous : next[0]?.id ?? null);
    setSelectedShapeId(current.getSelectedShapeIds()[0] ?? null);
  }, []);

  const addDesignFrame = (label: string, width: number, height: number) => {
    if (!editor) return;
    const rightEdge = frames.reduce((right, frame) => {
      const shape = editor.getShape(frame.id);
      return Math.max(right, (shape?.x ?? 0) + frame.width);
    }, 0);
    editor.createShape({ type: 'frame', x: frames.length ? rightEdge + 80 : 0, y: 0,
      props: { w: width, h: height, name: `${label} ${frames.length + 1}`, color: 'black' } });
    refreshFrames(editor);
    editor.zoomToFit();
  };

  const addDesignCard = () => {
    if (!editor) return;
    const frame = activeFrameId ? editor.getShape(activeFrameId) : undefined;
    const id = createShapeId();
    editor.createShape({ id, type: DESIGN_CARD_TYPE, x: (frame?.x ?? 0) + 40, y: (frame?.y ?? 0) + 40,
      props: { ...cardDefaults } });
    editor.select(id);
  };

  const selectedFrame = () => frames.find(frame => frame.id === activeFrameId) ?? frames[0];
  const exportFrame = async (preview: boolean) => {
    const frame = selectedFrame();
    if (!editor || !frame) return;
    setPreviewError('');
    try {
      const { blob } = await editor.toImage([frame.id], { format: 'png', pixelRatio: preview ? 1 : exportScale, background: true });
      const url = URL.createObjectURL(blob);
      if (preview) {
        setPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${frame.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'design'}.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setPreviewError('Não foi possível gerar a imagem deste quadro.');
    }
  };

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

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
    setLoadError('');
    hydratedRef.current = false;
    dirtyRef.current = false;
    pendingFlushRef.current = false;
    pendingKeepaliveRef.current = false;
    setSaveIndicator('idle');
    store.clear();

    let canEdit = true;
    if (isInfiniteContent(page.content)) {
      try {
        const snapshot = page.content.data;
        if (snapshot) {
          loadSnapshot(store, snapshot);
        }
        lastSavedRef.current = JSON.stringify(page.content);
      } catch (err) {
        if (isDesign) { setLoadError('Este quadro não pôde ser aberto. O conteúdo original foi preservado.'); canEdit = false; }
        console.error('[InfiniteRenderer]', {
          event: 'load.error',
          pageId: page.id,
          detail: String(err),
        });
      }
    } else if (isDesign) {
      setLoadError('Este quadro Design tem um formato inválido. O conteúdo original foi preservado.');
      canEdit = false;
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
    hydratedRef.current = canEdit;
    setLoading(false);
  }, [page.id, store, page.content, isDesign]);

  // Persist changes
  useEffect(() => {
    const save = throttle(() => { void persistSnapshot(); }, 3000);
    const cleanup = store.listen(() => {
      // Mark changes immediately; hiding during the debounce must still flush.
      dirtyRef.current = true;
      if (!savingRef.current) setSaveIndicator('saving');
      save();
      if (isDesign && editor) refreshFrames(editor);
    }, { scope: 'document' });

    return () => cleanup();
  }, [page.id, store, persistSnapshot, isDesign, editor, refreshFrames]);

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
        Carregando {isDesign ? 'Design' : 'Infinite Space'}…
      </div>
    );
  }

  if (loadError) return <div role="alert" className="flex-1 flex items-center justify-center p-8 text-sm text-red-400">{loadError}</div>;

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-[#191919]">
      {isDesign && <DesignOutline editor={editor} />}
      <div className="relative min-w-0 flex-1 tldraw-container">
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
          {saveIndicator === 'idle' && (lastSavedAt ? `Salvo ${lastSavedAt}` : isDesign ? 'Design' : 'Infinite')}
        </div>
      </div>
      {isDesign && <div className="absolute top-3 left-3 z-[120] flex max-w-[min(86vw,690px)] flex-wrap gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2 shadow-xl" aria-label="Ferramentas de Design">
        {designPresets.map(preset => <button key={preset.label} type="button" className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--theme-text)] hover:bg-[var(--theme-hover)]" onClick={() => addDesignFrame(preset.label, preset.width, preset.height)}>+ {preset.label}</button>)}
        <button type="button" className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--theme-text)] hover:bg-[var(--theme-hover)]" onClick={addDesignCard}>+ Cartão</button>
        <span className="mx-1 hidden w-px bg-[var(--theme-border)] sm:block" />
        <button type="button" disabled={!activeFrameId} className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--theme-text)] hover:bg-[var(--theme-hover)] disabled:opacity-40" onClick={() => { void exportFrame(true); }}>Prévia</button>
        <select aria-label="Escala PNG" value={exportScale} onChange={event => setExportScale(Number(event.target.value) as 1 | 2)} className="rounded-lg bg-[var(--theme-card)] px-2 text-xs text-[var(--theme-text)]"><option value={1}>1×</option><option value={2}>2×</option></select>
        <button type="button" disabled={!activeFrameId} className="rounded-lg bg-[var(--theme-primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40" onClick={() => { void exportFrame(false); }}>Baixar PNG</button>
        {previewError && <span role="alert" className="px-2 py-2 text-xs text-red-400">{previewError}</span>}
      </div>}
      {isDesign && frames.length > 0 && <div className="absolute left-3 top-24 z-[120] max-h-[45vh] w-48 overflow-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2 shadow-xl" aria-label="Quadros de Design">
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-muted)]">Quadros</div>
        {frames.map(frame => <button key={frame.id} type="button" aria-current={frame.id === activeFrameId ? 'true' : undefined} className={`block w-full truncate rounded-lg px-2 py-2 text-left text-xs ${frame.id === activeFrameId ? 'bg-[var(--theme-hover)] text-[var(--theme-text)]' : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]'}`} onClick={() => { setActiveFrameId(frame.id); editor?.select(frame.id); editor?.zoomToSelection(); }} title={`${frame.name} · ${Math.round(frame.width)} × ${Math.round(frame.height)}`}>{frame.name}<span className="block text-[10px] opacity-70">{Math.round(frame.width)} × {Math.round(frame.height)}</span></button>)}
      </div>}
      {isDesign && previewUrl && <div role="dialog" aria-modal="true" aria-label="Prévia do quadro" className="absolute inset-0 z-[200] flex items-center justify-center bg-black/80 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewUrl(null); }}>
        <div className="flex max-h-full max-w-full flex-col gap-3"><div className="flex items-center justify-between gap-4 text-white"><strong className="text-sm">Prévia · {selectedFrame()?.name}</strong><button type="button" className="rounded-lg bg-white/15 px-3 py-1 text-sm" onClick={() => setPreviewUrl(null)}>Fechar</button></div><img src={previewUrl} alt={`Prévia do quadro ${selectedFrame()?.name ?? ''}`} className="max-h-[82vh] max-w-[90vw] object-contain" /></div>
      </div>}
      <Tldraw 
        store={store} 
        shapeUtils={isDesign ? [DesignCardShapeUtil] : undefined}
        autoFocus
        onMount={current => { setEditor(current); if (isDesign) refreshFrames(current); }}
      />
      </div>
      {isDesign && <DesignInspector editor={editor} selectedShapeId={selectedShapeId} onPreview={() => { void exportFrame(true); }} onExport={() => { void exportFrame(false); }} />}
    </div>
  );
}
