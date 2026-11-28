import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, Ellipse, FabricImage, Gradient, Group, Point, Rect, Shadow, Textbox, Triangle } from 'fabric';
import type { FabricObject } from 'fabric';
import { api } from '../../api/client';
import type { Page } from '../../types';
import { cardAppearance, cardDefaults } from './designCardModel';
import type { DesignCardProps } from './designCardModel';
import { absolutePosition, addDesignCard, addDesignFrame, changeDesignShape, designFrames, designShapes, openDesignSnapshot } from './designSnapshotAdapter';
import type { DesignShape, DesignSnapshot } from './designSnapshotAdapter';
import './designInspector.css';

const presets = [
  { name: 'Post quadrado', w: 1080, h: 1080 },
  { name: 'Feed 4:5', w: 1080, h: 1350 },
  { name: 'Story', w: 1080, h: 1920 },
  { name: 'Tela desktop', w: 1440, h: 900 },
];
const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
const palette: Record<string, string> = {
  black: '#1f2937', grey: '#64748b', white: '#ffffff', red: '#e03131', orange: '#f97316',
  yellow: '#eab308', green: '#16a34a', blue: '#2563eb', violet: '#7c3aed',
  'light-blue': '#93c5fd', 'light-violet': '#c4b5fd', 'light-green': '#86efac', 'light-red': '#fca5a5',
};
function plainText(value: unknown): string {
  if (Array.isArray(value)) return value.map(plainText).join('');
  if (!value || typeof value !== 'object') return '';
  const item = value as { text?: unknown; content?: unknown };
  return (typeof item.text === 'string' ? item.text : '') + plainText(item.content);
}

function shapeObject(shape: DesignShape, snapshot: DesignSnapshot): FabricObject {
  const { x, y } = absolutePosition(shape, snapshot);
  const w = Number(shape.props.w), h = Number(shape.props.h);
  if (shape.type === 'frame') return new Rect({ left: x, top: y, width: w, height: h,
    fill: '#ffffff', stroke: '#aab5c8', strokeWidth: 1, originX: 'left', originY: 'top',
    angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
    lockMovementX: shape.isLocked, lockMovementY: shape.isLocked, selectable: !shape.isLocked });
  if (shape.type === 'text') return new Textbox(plainText(shape.props.richText) || String(shape.props.text ?? ''), {
    left: x, top: y, width: Math.max(1, w), fontFamily: 'Inter', fontSize: 24,
    fill: palette[String(shape.props.color)] ?? '#1f2937', originX: 'left', originY: 'top',
    angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
    selectable: !shape.isLocked, lockMovementX: shape.isLocked, lockMovementY: shape.isLocked,
    lockScalingX: true, lockScalingY: true,
  });
  if (shape.type === 'geo') {
    const color = palette[String(shape.props.color)] ?? '#2563eb';
    const common = { left: x, top: y, width: w, height: h, fill: shape.props.fill === 'none' ? 'transparent' : color,
      stroke: color, strokeWidth: 2, originX: 'left' as const, originY: 'top' as const,
      angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
      selectable: !shape.isLocked, lockMovementX: shape.isLocked, lockMovementY: shape.isLocked,
      lockScalingX: true, lockScalingY: true };
    if (shape.props.geo === 'ellipse') return new Ellipse({ ...common, rx: w / 2, ry: h / 2 });
    if (shape.props.geo === 'triangle') return new Triangle(common);
    return new Rect(common);
  }
  if (shape.type !== 'design-card') return new Group([
    new Rect({ left: 0, top: 0, width: Math.max(80, w || 160), height: Math.max(50, h || 80), fill: '#374151', stroke: '#9ca3af', strokeWidth: 1 }),
    new Textbox(shape.type === 'image' ? 'Imagem' : `Elemento ${shape.type}`, { left: 8, top: 8, width: Math.max(64, w - 16 || 144), fontSize: 14, fill: '#ffffff' }),
  ], { left: x, top: y, originX: 'left', originY: 'top', selectable: false, evented: false });
  const p = cardAppearance({ ...cardDefaults, ...shape.props } as DesignCardProps);
  const fill = p.gradientTo ? new Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 0, y2: h },
    colorStops: [{ offset: 0, color: p.fill }, { offset: 1, color: p.gradientTo }] }) : p.fill;
  const surface = new Rect({ left: 0, top: 0, width: w, height: h, rx: p.radius, ry: p.radius,
    fill, stroke: p.borderColor, strokeWidth: p.borderWidth,
    shadow: new Shadow({ color: p.shadowColor, offsetX: p.shadowX, offsetY: p.shadowY, blur: p.shadowBlur }) });
  const text = new Textbox(String(shape.props.text ?? ''), { left: p.padding, top: p.padding,
    width: Math.max(1, w - 2 * p.padding), fontSize: p.fontSize, fontFamily: p.fontFamily,
    fontWeight: p.fontWeight, textAlign: p.textAlign, fill: p.textColor,
    lineHeight: p.lineHeight, charSpacing: p.letterSpacing * 1000 / p.fontSize,
    selectable: false, evented: false });
  if (p.verticalAlign === 'middle') text.set('top', Math.max(p.padding, (h - text.height) / 2));
  if (p.verticalAlign === 'bottom') text.set('top', Math.max(p.padding, h - p.padding - text.height));
  return new Group([surface, text], { left: x, top: y, originX: 'left', originY: 'top',
    angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
    lockMovementX: shape.isLocked, lockMovementY: shape.isLocked, selectable: !shape.isLocked,
    objectCaching: true,
  });
}

function fitFrames(canvas: Canvas, snapshot: DesignSnapshot) {
  const frames = designFrames(snapshot);
  if (!frames.length) return;
  const left = Math.min(...frames.map(frame => frame.x));
  const top = Math.min(...frames.map(frame => frame.y));
  const right = Math.max(...frames.map(frame => frame.x + Number(frame.props.w)));
  const bottom = Math.max(...frames.map(frame => frame.y + Number(frame.props.h)));
  const zoom = Math.min(1, Math.max(0.05, Math.min((canvas.getWidth() - 80) / (right - left), (canvas.getHeight() - 80) / (bottom - top))));
  canvas.setViewportTransform([zoom, 0, 0, zoom,
    (canvas.getWidth() - (right - left) * zoom) / 2 - left * zoom,
    (canvas.getHeight() - (bottom - top) * zoom) / 2 - top * zoom]);
}

/** Export in document coordinates, independent of the editor's current zoom. */
function renderFramePng(canvas: Canvas, frame: DesignShape, multiplier: number): Promise<Blob> {
  const viewport: [number, number, number, number, number, number] = [...canvas.viewportTransform];
  try {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    return canvas.toBlob({ format: 'png', multiplier, left: frame.x, top: frame.y,
      width: Number(frame.props.w), height: Number(frame.props.h) }).then(blob => {
      if (!blob) throw new Error('Falha ao gerar imagem do quadro');
      return blob;
    });
  } finally { canvas.setViewportTransform(viewport); canvas.requestRenderAll(); }
}

function NumberField({ label, value, onChange, min = -1_000_000, max = 1_000_000 }: {
  label: string; value: number; onChange: (next: number) => void; min?: number; max?: number;
}) {
  return <label className="design-inspector-number"><span>{label}</span><input type="number" aria-label={label} value={Math.round(value * 100) / 100}
    min={min} max={max} onChange={event => { const next = Number(event.target.value); if (event.target.value && finite(next, min, max)) onChange(next); }} /></label>;
}

export function FabricDesignRenderer({ page }: { page: Page }) {
  const [initial] = useState(() => { try { return { snapshot: openDesignSnapshot(page.content), error: '' }; }
    catch (error) { return { snapshot: null, error: error instanceof Error ? error.message : 'Design inválido' }; } });
  const [snapshot, setSnapshot] = useState<DesignSnapshot | null>(initial.snapshot);
  const snapshotRef = useRef(snapshot);
  const savedRef = useRef(snapshot ? JSON.stringify(snapshot) : '');
  const revisionRef = useRef(page.revision);
  const savingRef = useRef(false);
  const saveBlockedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasElement = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const objectIds = useRef(new Map<FabricObject, string>());
  const shapeObjects = useRef(new Map<string, FabricObject>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const rebuildingRef = useRef(false);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | 'external'>('saved');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [scale, setScale] = useState<1 | 2>(1);
  const [zoom, setZoom] = useState(100);
  const initialized = useRef(false);

  const apply = useCallback((next: DesignSnapshot) => { snapshotRef.current = next; setSnapshot(next); }, []);
  const selected = snapshot && selectedId ? designShapes(snapshot).find(shape => shape.id === selectedId) : undefined;
  const frames = snapshot ? designFrames(snapshot) : [];
  const frameId = selected?.type === 'frame' ? selected.id : selected?.parentId || activeFrameId;
  const archived = snapshot ? Object.values(snapshot.data.document.store).flatMap(item => {
    const meta = item.meta as Record<string, unknown> | undefined;
    return item.typeName === 'page' && Array.isArray(meta?.brainCoreArchivedAnnotations)
      ? meta.brainCoreArchivedAnnotations.filter(entry => !!entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string') as Array<{ text: string }>
      : [];
  }) : [];

  const save = useCallback(async (force = false) => {
    const next = snapshotRef.current;
    if (!next || savingRef.current || (!force && saveBlockedRef.current) || JSON.stringify(next) === savedRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    let failed = false;
    try {
      const result = await api.patchPage(page.id, { content: next, revision: revisionRef.current });
      revisionRef.current = result.revision;
      savedRef.current = JSON.stringify(next);
      saveBlockedRef.current = false;
      setStatus('saved');
      const canvas = canvasRef.current;
      if (canvas && JSON.stringify(snapshotRef.current) === savedRef.current) {
        void (async () => {
          for (const frame of designFrames(next).slice(0, 40)) {
            if (JSON.stringify(snapshotRef.current) !== savedRef.current || revisionRef.current !== result.revision) return;
            try {
              let png = await renderFramePng(canvas, frame, 1);
              if (png.size > 3 * 1024 * 1024) png = await renderFramePng(canvas, frame, 0.5);
              if (JSON.stringify(snapshotRef.current) !== savedRef.current || revisionRef.current !== result.revision) return;
              await api.uploadDesignPreview(page.id, frame.id, result.revision, png);
            } catch { /* Preview is optional; never block a successful save. */ }
          }
        })();
      }
    } catch { saveBlockedRef.current = true; failed = true; setStatus('error'); }
    finally {
      savingRef.current = false;
      if (!failed && snapshotRef.current && JSON.stringify(snapshotRef.current) !== savedRef.current) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => { void save(); }, 800);
      }
    }
  }, [page.id]);

  useEffect(() => {
    if (!snapshot || saveBlockedRef.current || JSON.stringify(snapshot) === savedRef.current) return;
    const timer = window.setTimeout(() => { void save(); }, 800);
    return () => window.clearTimeout(timer);
  }, [snapshot, save]);

  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!snapshot || !canvasElement.current) return;
    const host = canvasElement.current.parentElement!;
    const canvas = new Canvas(canvasElement.current, { selection: true, backgroundColor: '#161616', preserveObjectStacking: true });
    canvasRef.current = canvas;
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      if (width < 200 || height < 200) return;
      canvas.setDimensions({ width, height });
      if (!initialized.current) { fitFrames(canvas, snapshotRef.current!); initialized.current = true; }
      canvas.requestRenderAll();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const select = (event: { selected?: FabricObject[] }) => {
      if (rebuildingRef.current) return;
      const id = event.selected?.[0] ? objectIds.current.get(event.selected[0]) ?? null : null;
      selectedIdRef.current = id;
      setSelectedId(id);
      const shape = id ? designShapes(snapshotRef.current!).find(item => item.id === id) : undefined;
      if (shape) setActiveFrameId(shape.type === 'frame' ? shape.id : shape.parentId);
    };
    canvas.on('selection:created', select);
    canvas.on('selection:updated', select);
    canvas.on('selection:cleared', () => {
      if (rebuildingRef.current) return;
      selectedIdRef.current = null;
      setSelectedId(null);
    });
    canvas.on('object:moving', event => {
      const target = event.target;
      const id = target && objectIds.current.get(target);
      const doc = snapshotRef.current;
      const shape = doc && id ? designShapes(doc).find(item => item.id === id) : undefined;
      if (!shape || shape.type !== 'frame') return;
      const dx = (target.left ?? 0) - shape.x, dy = (target.top ?? 0) - shape.y;
      for (const child of designShapes(doc!).filter(item => item.parentId === id)) {
        const object = shapeObjects.current.get(child.id);
        if (object) object.set({ left: shape.x + child.x + dx, top: shape.y + child.y + dy });
      }
      canvas.requestRenderAll();
    });
    canvas.on('object:modified', event => {
      const object = event.target;
      const id = object && objectIds.current.get(object);
      const doc = snapshotRef.current;
      const shape = doc && id ? designShapes(doc).find(item => item.id === id) : undefined;
      if (!object || !id || !shape || !doc) return;
      const parent = doc.data.document.store[shape.parentId];
      const parentX = parent?.typeName === 'shape' ? Number(parent.x) || 0 : 0;
      const parentY = parent?.typeName === 'shape' ? Number(parent.y) || 0 : 0;
      apply(changeDesignShape(doc, id, { x: (object.left ?? 0) - parentX, y: (object.top ?? 0) - parentY,
        rotation: (object.angle ?? 0) * Math.PI / 180,
        ...(shape.type === 'frame' || shape.type === 'design-card' ? { props: {
          w: Math.max(1, Math.min(10000, Math.round(Number(shape.props.w) * object.scaleX))),
          h: Math.max(1, Math.min(10000, Math.round(Number(shape.props.h) * object.scaleY))),
        } } : {}) }));
    });
    canvas.on('mouse:wheel', event => {
      const wheel = event.e as WheelEvent;
      wheel.preventDefault(); wheel.stopPropagation();
      const next = Math.min(8, Math.max(0.05, canvas.getZoom() * Math.exp(-wheel.deltaY / 500)));
      canvas.zoomToPoint(new Point(wheel.offsetX, wheel.offsetY), next);
      setZoom(Math.round(next * 100));
    });
    return () => { observer.disconnect(); objectIds.current.clear(); shapeObjects.current.clear(); canvasRef.current = null; void canvas.dispose(); };
  }, [apply, initial.snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    let cancelled = false;
    const images = new AbortController();
    rebuildingRef.current = true;
    canvas.clear(); canvas.backgroundColor = '#161616';
    objectIds.current.clear(); shapeObjects.current.clear();
    const shapes = designShapes(snapshot);
    for (const shape of [...shapes.filter(item => item.type === 'frame'), ...shapes.filter(item => item.type !== 'frame')]) {
      const object = shapeObject(shape, snapshot);
      canvas.add(object);
      objectIds.current.set(object, shape.id);
      shapeObjects.current.set(shape.id, object);
      if (shape.type === 'image') {
        const asset = snapshot.data.document.store[String(shape.props.assetId)];
        const src = asset?.typeName === 'asset' && typeof (asset.props as { src?: unknown } | undefined)?.src === 'string'
          ? (asset.props as { src: string }).src : '';
        if (/^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(src)) {
          void FabricImage.fromURL(src, { signal: images.signal }).then(image => {
            if (cancelled || !canvasRef.current || shapeObjects.current.get(shape.id) !== object) return;
            const position = canvas.getObjects().indexOf(object);
            if (position < 0) return;
            const absolute = absolutePosition(shape, snapshot);
            image.set({ left: absolute.x, top: absolute.y, originX: 'left', originY: 'top',
              scaleX: Number(shape.props.w) / Math.max(1, image.width), scaleY: Number(shape.props.h) / Math.max(1, image.height),
              angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
              selectable: !shape.isLocked, lockMovementX: shape.isLocked, lockMovementY: shape.isLocked,
              lockScalingX: true, lockScalingY: true });
            canvas.remove(object);
            canvas.insertAt(position, image);
            objectIds.current.delete(object);
            objectIds.current.set(image, shape.id);
            shapeObjects.current.set(shape.id, image);
            if (selectedIdRef.current === shape.id) canvas.setActiveObject(image);
            canvas.requestRenderAll();
          }).catch(() => { /* Keep a visible placeholder if an owned upload is unavailable. */ });
        }
      }
    }
    const selectedObject = selectedIdRef.current ? shapeObjects.current.get(selectedIdRef.current) : null;
    if (selectedObject) canvas.setActiveObject(selectedObject);
    canvas.requestRenderAll();
    rebuildingRef.current = false;
    return () => { cancelled = true; images.abort(); };
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || selectedIdRef.current === selectedId) return;
    selectedIdRef.current = selectedId;
    const object = selectedId ? shapeObjects.current.get(selectedId) : null;
    if (object) canvas.setActiveObject(object);
    else canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [selectedId]);

  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setInterval(() => { void (async () => {
      try {
        const remote = await api.getPage(page.id);
        if (remote.revision <= revisionRef.current) return;
        if (JSON.stringify(snapshotRef.current) !== savedRef.current || savingRef.current) { setStatus('external'); return; }
        const incoming = openDesignSnapshot(remote.content);
        revisionRef.current = remote.revision;
        savedRef.current = JSON.stringify(incoming);
        apply(incoming);
        setStatus('saved');
      } catch { /* Keep the local canvas during a transient failure. */ }
    })(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [apply, page.id, snapshot !== null]);

  const change = (patch: Parameters<typeof changeDesignShape>[2]) => {
    if (!snapshot || !selected) return;
    apply(changeDesignShape(snapshot, selected.id, patch));
  };
  const changeProps = (props: Record<string, unknown>) => change({ props });
  const exportFrame = (download: boolean) => {
    const canvas = canvasRef.current;
    const frame = frames.find(item => item.id === frameId) ?? frames[0];
    if (!canvas || !frame) return;
    setPreviewError('');
    void renderFramePng(canvas, frame, scale).then(blob => {
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a'); link.href = url; link.download = `${page.title || 'design'}.png`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else setPreview(url);
    }).catch(() => setPreviewError('Não foi possível exportar este quadro.'));
  };

  if (!snapshot) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--theme-muted)]" role="alert">
    {initial.error}. O conteúdo original foi preservado.
  </div>;

  return <div className="flex min-h-0 flex-1 bg-[#161616]">
    <aside className="hidden w-48 shrink-0 overflow-auto border-r border-[var(--theme-border)] bg-[var(--theme-card)] p-2 lg:block" aria-label="Camadas Design">
      <strong className="block px-2 py-2 text-xs">Quadros e camadas</strong>
      {frames.map(frame => <div key={frame.id}><button type="button" className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--theme-hover)]" onClick={() => {
        setActiveFrameId(frame.id); setSelectedId(frame.id);
      }}>{String(frame.props.name || 'Quadro')}</button>
        {designShapes(snapshot).filter(shape => shape.parentId === frame.id).map(shape => <button key={shape.id} type="button" className="block w-full truncate rounded py-1 pl-5 pr-2 text-left text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]" onClick={() => { setActiveFrameId(frame.id); setSelectedId(shape.id); }}>{String(shape.props.text || (shape.type === 'text' ? plainText(shape.props.richText) : shape.type))}</button>)}
      </div>)}
      {archived.length > 0 && <details className="mt-4 border-t border-[var(--theme-border)] px-2 pt-2 text-xs"><summary>Anotações preservadas ({archived.length})</summary>{archived.map((item, index) => <p key={index} className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>)}</details>}
    </aside>
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2 shadow-xl" aria-label="Ferramentas de Design">
        {presets.map(preset => <button key={preset.name} type="button" className="rounded px-2 py-1 text-xs hover:bg-[var(--theme-hover)]" onClick={() => { const result = addDesignFrame(snapshotRef.current!, preset.name, preset.w, preset.h); apply(result.snapshot); setActiveFrameId(result.id); setSelectedId(result.id); }}>+ {preset.name}</button>)}
        <button type="button" disabled={!frameId} className="rounded px-2 py-1 text-xs hover:bg-[var(--theme-hover)] disabled:opacity-40" onClick={() => { const result = addDesignCard(snapshotRef.current!, frameId!); apply(result.snapshot); setSelectedId(result.id); }}>+ Cartão</button>
        <button type="button" disabled={!frames.length} className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={() => exportFrame(false)}>Prévia</button>
        <select aria-label="Escala PNG" value={scale} onChange={event => setScale(Number(event.target.value) as 1 | 2)} className="rounded bg-[var(--theme-card)] text-xs"><option value={1}>1×</option><option value={2}>2×</option></select>
        <button type="button" disabled={!frames.length} className="rounded bg-[var(--theme-primary)] px-2 py-1 text-xs text-white disabled:opacity-40" onClick={() => exportFrame(true)}>Baixar PNG</button>
      </div>
      <div className="absolute inset-0"><canvas ref={canvasElement} /></div>
      <div className="absolute bottom-3 left-3 rounded bg-[var(--theme-card)] px-2 py-1 text-xs text-[var(--theme-muted)]" role="status">
        {status === 'saving' ? 'Salvando…' : status === 'error' ? <button type="button" onClick={() => { saveBlockedRef.current = false; void save(true); }}>Falha ao salvar · tentar novamente</button> : status === 'external' ? 'Alteração externa detectada · recarregue a página' : 'Salvo'} · {zoom}%
      </div>
      {previewError && <div className="absolute bottom-12 left-3 rounded bg-red-900 px-2 py-1 text-xs text-white" role="alert">{previewError}</div>}
      {preview && <div role="dialog" aria-modal="true" aria-label="Prévia do quadro" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"><button type="button" onClick={() => setPreview(null)} className="self-end rounded bg-white/15 px-3 py-1 text-sm text-white">Fechar</button><img src={preview} alt="Prévia do quadro Design" className="max-h-[85vh] max-w-full object-contain" /></div>}
    </div>
    <aside className="design-inspector" aria-label="Propriedades de Design">
      <div className="design-inspector-heading"><strong>Design</strong><span>{selected ? selected.type === 'frame' ? 'Quadro selecionado' : 'Cartão selecionado' : 'Selecione um elemento'}</span></div>
      {selected && <><section className="design-inspector-section" aria-label="Layout"><h3>Layout</h3><div className="design-inspector-grid">
        <NumberField label="X" value={selected.x} onChange={x => change({ x })} />
        <NumberField label="Y" value={selected.y} onChange={y => change({ y })} />
        {typeof selected.props.w === 'number' && <NumberField label="Largura" value={selected.props.w} min={1} max={10000} onChange={w => changeProps({ w })} />}
        {typeof selected.props.h === 'number' && <NumberField label="Altura" value={selected.props.h} min={1} max={10000} onChange={h => changeProps({ h })} />}
      </div></section>
      {selected.type === 'frame' ? <section className="design-inspector-section"><h3>Quadro</h3><label className="design-inspector-text"><span>Nome</span><input value={String(selected.props.name || '')} maxLength={160} onChange={event => changeProps({ name: event.target.value })} /></label></section>
        : selected.type === 'design-card' ? <><section className="design-inspector-section" aria-label="Conteúdo do cartão"><h3>Conteúdo</h3><label className="design-inspector-text"><span>Texto</span><textarea aria-label="Texto do cartão" value={String(selected.props.text || '')} maxLength={5000} rows={6} onChange={event => changeProps({ text: event.target.value })} /></label>
          <NumberField label="Fonte px" value={Number(selected.props.fontSize || 24)} min={8} max={160} onChange={fontSize => changeProps({ fontSize })} />
          <label>Cor do texto<input aria-label="Cor do texto" type="color" value={String(selected.props.textColor || '#111827').slice(0, 7)} onChange={event => changeProps({ textColor: event.target.value })} /></label>
          <select aria-label="Família da fonte" value={String(selected.props.fontFamily || 'Inter')} onChange={event => changeProps({ fontFamily: event.target.value })}>{['Inter', 'Arial', 'Georgia', 'monospace'].map(font => <option key={font}>{font}</option>)}</select>
          <NumberField label="Peso da fonte" value={Number(selected.props.fontWeight || 400)} min={100} max={900} onChange={fontWeight => changeProps({ fontWeight })} />
          <select aria-label="Alinhamento horizontal" value={String(selected.props.textAlign || 'left')} onChange={event => changeProps({ textAlign: event.target.value })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select>
          <NumberField label="Espaçamento interno px" value={Number(selected.props.padding ?? 16)} min={0} max={200} onChange={padding => changeProps({ padding })} />
        </section><section className="design-inspector-section" aria-label="Preenchimento do cartão"><h3>Preenchimento</h3>
          <label>Cor de fundo<input aria-label="Cor de fundo" type="color" value={String(selected.props.fill || '#ffffff').slice(0, 7)} onChange={event => changeProps({ fill: event.target.value })} /></label>
          <NumberField label="Raio px" value={Number(selected.props.radius ?? 16)} min={0} max={500} onChange={radius => changeProps({ radius })} />
        </section><section className="design-inspector-section" aria-label="Borda do cartão"><h3>Borda</h3>
          <NumberField label="Largura px" value={Number(selected.props.borderWidth ?? 1)} min={0} max={40} onChange={borderWidth => changeProps({ borderWidth })} />
          <label>Cor da borda<input aria-label="Cor da borda" type="color" value={String(selected.props.borderColor || '#d9dde5').slice(0, 7)} onChange={event => changeProps({ borderColor: event.target.value })} /></label>
        </section></> : <p className="design-inspector-empty">Este elemento foi preservado. Edite suas propriedades pelo MCP até o painel visual oferecer suporte completo.</p>}
      </>}
      {!selected && <p className="design-inspector-empty">Selecione um quadro ou cartão para editar.</p>}
    </aside>
  </div>;
}
