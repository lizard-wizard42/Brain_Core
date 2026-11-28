import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, Ellipse, FabricImage, Gradient, Group, Line, Point, Rect, Shadow, Textbox, Triangle } from 'fabric';
import type { FabricObject } from 'fabric';
import { api } from '../../api/client';
import type { Page } from '../../types';
import { cardAppearance, cardDefaults } from './designCardModel';
import type { DesignCardProps } from './designCardModel';
import { dimensionsAfterTransform } from './designFabricGeometry';
import { absolutePosition, addDesignCard, addDesignFrame, addDesignImage, addDesignVector, changeDesignShape, designFrames, designShapes, duplicateDesignShape, groupDesignShapes, openDesignSnapshot, removeDesignShape, replaceDesignImage, ungroupDesignShape } from './designSnapshotAdapter';
import type { DesignShape, DesignSnapshot } from './designSnapshotAdapter';
import { attachDesignPan } from './designPan';
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

function isDescendant(shape: DesignShape, ancestorId: string, snapshot: DesignSnapshot): boolean {
  let parentId = shape.parentId;
  for (let depth = 0; depth < 32; depth++) {
    if (parentId === ancestorId) return true;
    const parent = snapshot.data.document.store[parentId];
    if (parent?.typeName !== 'shape') return false;
    parentId = String(parent.parentId);
  }
  return false;
}

function containingFrame(shape: DesignShape | undefined, snapshot: DesignSnapshot | null): string | null {
  if (!shape || !snapshot) return null;
  let current: DesignShape | undefined = shape;
  for (let depth = 0; depth < 32 && current; depth++) {
    if (current.type === 'frame') return current.id;
    const parentRecord: unknown = snapshot.data.document.store[current.parentId];
    current = parentRecord && typeof parentRecord === 'object' && (parentRecord as DesignShape).typeName === 'shape'
      ? parentRecord as DesignShape : undefined;
  }
  return null;
}

function shapeObject(shape: DesignShape, snapshot: DesignSnapshot): FabricObject {
  const { x, y } = absolutePosition(shape, snapshot);
  const w = Number(shape.props.w), h = Number(shape.props.h);
  if (shape.type === 'frame') return new Rect({ left: x, top: y, width: w, height: h,
    fill: '#ffffff', stroke: '#aab5c8', strokeWidth: 1, originX: 'left', originY: 'top',
    angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
    lockMovementX: shape.isLocked, lockMovementY: shape.isLocked, selectable: !shape.isLocked });
  if (shape.type === 'design-group') return new Rect({ left: x, top: y, width: w, height: h,
    fill: 'transparent', stroke: '#60a5fa', strokeWidth: 1, strokeDashArray: [8, 6],
    originX: 'left', originY: 'top', selectable: !shape.isLocked, excludeFromExport: true,
    lockMovementX: shape.isLocked, lockMovementY: shape.isLocked, lockScalingX: true, lockScalingY: true });
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
  if (shape.type === 'design-vector') {
    const common = { left: x, top: y, originX: 'left' as const, originY: 'top' as const,
      stroke: String(shape.props.stroke || '#176fa8'), strokeWidth: Number(shape.props.strokeWidth ?? 2),
      angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
      selectable: !shape.isLocked, lockMovementX: shape.isLocked, lockMovementY: shape.isLocked };
    if (shape.props.kind === 'line') return new Line([0, 0, w, 0], common);
    if (shape.props.kind === 'ellipse') return new Ellipse({ ...common, rx: w / 2, ry: h / 2, fill: String(shape.props.fill || '#ffffff') });
    const radius = Number(shape.props.radius ?? 0);
    return new Rect({ ...common, width: w, height: h, rx: radius, ry: radius, fill: String(shape.props.fill || '#ffffff') });
  }
  if (shape.type !== 'design-card') return new Group([
    new Rect({ left: 0, top: 0, width: Math.max(80, w || 160), height: Math.max(50, h || 80), fill: '#374151', stroke: '#9ca3af', strokeWidth: 1 }),
    new Textbox(shape.type === 'image' ? 'Imagem' : `Elemento ${shape.type}`, { left: 8, top: 8, width: Math.max(64, w - 16 || 144), fontSize: 14, fill: '#ffffff' }),
  ], { left: x, top: y, originX: 'left', originY: 'top', selectable: false, evented: false });
  const p = cardAppearance({ ...cardDefaults, ...shape.props } as DesignCardProps);
  const fill = p.gradientTo ? new Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 0, y2: h },
    colorStops: [{ offset: 0, color: p.fill }, { offset: 1, color: p.gradientTo }] }) : p.fill;
  const surface = new Rect({ left: 0, top: 0, width: w, height: h, rx: p.radius, ry: p.radius,
    originX: 'left', originY: 'top',
    fill, stroke: p.borderColor, strokeWidth: p.borderWidth,
    shadow: new Shadow({ color: p.shadowColor, offsetX: p.shadowX, offsetY: p.shadowY, blur: p.shadowBlur }) });
  const title = String(shape.props.text ?? ''), bodyValue = String(shape.props.body ?? '');
  const text = new Textbox(title, { left: p.padding, top: p.padding,
    originX: 'left', originY: 'top',
    width: Math.max(1, w - 2 * p.padding), fontSize: p.fontSize, fontFamily: p.fontFamily,
    fontWeight: p.fontWeight, textAlign: p.textAlign, fill: p.textColor,
    lineHeight: p.lineHeight, charSpacing: p.letterSpacing * 1000 / p.fontSize,
    selectable: false, evented: false });
  const body = bodyValue ? new Textbox(bodyValue, { left: p.padding, top: p.padding,
    originX: 'left', originY: 'top', width: Math.max(1, w - 2 * p.padding),
    fontSize: p.bodyFontSize, fontFamily: p.fontFamily, fontWeight: p.bodyFontWeight,
    textAlign: p.textAlign, fill: p.bodyColor, lineHeight: p.lineHeight,
    selectable: false, evented: false,
  }) : null;
  const contentHeight = (title ? text.height : 0) + (body ? (title ? p.bodyGap : 0) + body.height : 0);
  const start = p.verticalAlign === 'middle' ? Math.max(p.padding, (h - contentHeight) / 2)
    : p.verticalAlign === 'bottom' ? Math.max(p.padding, h - p.padding - contentHeight) : p.padding;
  text.set('top', start);
  if (body) body.set('top', start + (title ? text.height + p.bodyGap : 0));
  return new Group(body ? [surface, text, body] : [surface, text], { left: x, top: y, originX: 'left', originY: 'top',
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

function centerFrame(canvas: Canvas, frame: DesignShape): number {
  const width = Number(frame.props.w), height = Number(frame.props.h);
  const zoom = Math.min(1, Math.max(0.05, Math.min((canvas.getWidth() - 80) / width, (canvas.getHeight() - 80) / height)));
  canvas.setViewportTransform([zoom, 0, 0, zoom,
    (canvas.getWidth() - width * zoom) / 2 - frame.x * zoom,
    (canvas.getHeight() - height * zoom) / 2 - frame.y * zoom]);
  canvas.requestRenderAll();
  return Math.round(zoom * 100);
}

/** Export in document coordinates, independent of the editor's current zoom. */
function renderFramePng(canvas: Canvas, frame: DesignShape, multiplier: number): Promise<Blob> {
  const viewport: [number, number, number, number, number, number] = [...canvas.viewportTransform];
  try {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    return canvas.toBlob({ format: 'png', multiplier, left: frame.x, top: frame.y,
      filter: object => !object.excludeFromExport,
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
  const imageInput = useRef<HTMLInputElement>(null);
  const replaceImageRef = useRef<string | null>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const objectIds = useRef(new Map<FabricObject, string>());
  const shapeObjects = useRef(new Map<string, FabricObject>());
  const imageJobsRef = useRef<Promise<unknown>[]>([]);
  const previewedRevisionRef = useRef<number | null>(null);
  const importingRef = useRef(false);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multiCount, setMultiCount] = useState(0);
  const selectedIdRef = useRef<string | null>(null);
  const rebuildingRef = useRef(false);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | 'external'>('saved');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [scale, setScale] = useState<1 | 2>(1);
  const [batchBusy, setBatchBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [panEnabled, setPanEnabled] = useState(false);
  const [assetError, setAssetError] = useState('');
  const [assetProgress, setAssetProgress] = useState('');
  const uploadCancelRef = useRef(false);
  const historyRef = useRef<DesignSnapshot[]>([]);
  const redoRef = useRef<DesignSnapshot[]>([]);
  const [, setHistoryVersion] = useState(0);
  const panModeRef = useRef(false);
  const panControlsRef = useRef<ReturnType<typeof attachDesignPan> | null>(null);
  const initialized = useRef(false);

  const apply = useCallback((next: DesignSnapshot, recordHistory = true) => {
    const current = snapshotRef.current;
    if (recordHistory && current && JSON.stringify(current) !== JSON.stringify(next)) {
      historyRef.current.push(current);
      if (historyRef.current.length > 100) historyRef.current.shift();
      redoRef.current = [];
      setHistoryVersion(value => value + 1);
    } else if (!recordHistory) {
      historyRef.current = []; redoRef.current = []; setHistoryVersion(value => value + 1);
    }
    snapshotRef.current = next; setSnapshot(next);
  }, []);
  const selected = snapshot && selectedId ? designShapes(snapshot).find(shape => shape.id === selectedId) : undefined;
  const frames = snapshot ? designFrames(snapshot) : [];
  const frameId = containingFrame(selected, snapshot) || activeFrameId || frames[0]?.id;
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

  useEffect(() => {
    uploadCancelRef.current = false;
    return () => { uploadCancelRef.current = true; if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!snapshot || !canvasElement.current) return;
    const host = canvasElement.current.parentElement!;
    const canvas = new Canvas(canvasElement.current, { selection: true, backgroundColor: '#161616', preserveObjectStacking: true });
    canvasRef.current = canvas;
    panControlsRef.current = attachDesignPan(canvas, panModeRef);
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      if (width < 200 || height < 200) return;
      canvas.setDimensions({ width, height });
      if (!initialized.current) { fitFrames(canvas, snapshotRef.current!); setZoom(Math.round(canvas.getZoom() * 100)); initialized.current = true; }
      canvas.requestRenderAll();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const select = (event: { selected?: FabricObject[] }) => {
      if (rebuildingRef.current) return;
      setMultiCount(canvas.getActiveObjects().length);
      const id = event.selected?.[0] ? objectIds.current.get(event.selected[0]) ?? null : null;
      selectedIdRef.current = id;
      setSelectedId(id);
      const shape = id ? designShapes(snapshotRef.current!).find(item => item.id === id) : undefined;
      if (shape) setActiveFrameId(containingFrame(shape, snapshotRef.current));
    };
    canvas.on('selection:created', select);
    canvas.on('selection:updated', select);
    canvas.on('selection:cleared', () => {
      if (rebuildingRef.current) return;
      selectedIdRef.current = null;
      setSelectedId(null);
      setMultiCount(0);
    });
    canvas.on('object:moving', event => {
      const target = event.target;
      const id = target && objectIds.current.get(target);
      const doc = snapshotRef.current;
      const shape = doc && id ? designShapes(doc).find(item => item.id === id) : undefined;
      if (!shape || (shape.type !== 'frame' && shape.type !== 'design-group')) return;
      const origin = absolutePosition(shape, doc!);
      const dx = (target.left ?? 0) - origin.x, dy = (target.top ?? 0) - origin.y;
      for (const child of designShapes(doc!).filter(item => isDescendant(item, id!, doc!))) {
        const object = shapeObjects.current.get(child.id);
        if (object) { const position = absolutePosition(child, doc!); object.set({ left: position.x + dx, top: position.y + dy }); }
      }
      canvas.requestRenderAll();
    });
    canvas.on('object:modified', event => {
      const object = event.target;
      const id = object && objectIds.current.get(object);
      const doc = snapshotRef.current;
      const shape = doc && id ? designShapes(doc).find(item => item.id === id) : undefined;
      if (!object || !id || !shape || !doc) return;
      const parent = designShapes(doc).find(item => item.id === shape.parentId);
      const parentPosition = parent ? absolutePosition(parent, doc) : { x: 0, y: 0 };
      const parentX = parentPosition.x, parentY = parentPosition.y;
      const dimensions = dimensionsAfterTransform(shape, object, event.action);
      apply(changeDesignShape(doc, id, { x: (object.left ?? 0) - parentX, y: (object.top ?? 0) - parentY,
        rotation: (object.angle ?? 0) * Math.PI / 180,
        ...(dimensions ? { props: dimensions } : {}) }));
    });
    canvas.on('mouse:wheel', event => {
      const wheel = event.e as WheelEvent;
      wheel.preventDefault(); wheel.stopPropagation();
      const next = Math.min(8, Math.max(0.05, canvas.getZoom() * Math.exp(-wheel.deltaY / 500)));
      canvas.zoomToPoint(new Point(wheel.offsetX, wheel.offsetY), next);
      setZoom(Math.round(next * 100));
    });
    return () => { observer.disconnect(); panControlsRef.current?.dispose(); panControlsRef.current = null;
      objectIds.current.clear(); shapeObjects.current.clear(); canvasRef.current = null; void canvas.dispose(); };
  }, [apply, initial.snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    let cancelled = false;
    const images = new AbortController();
    rebuildingRef.current = true;
    canvas.clear(); canvas.backgroundColor = '#161616';
    objectIds.current.clear(); shapeObjects.current.clear();
    imageJobsRef.current = [];
    const shapes = designShapes(snapshot);
    const depth = (shape: DesignShape) => { let count = 0, parentId = shape.parentId;
      while (count < 32 && snapshot.data.document.store[parentId]?.typeName === 'shape') { count++; parentId = String(snapshot.data.document.store[parentId].parentId); }
      return count;
    };
    for (const shape of [...shapes].sort((a, b) => depth(a) - depth(b))) {
      const object = shapeObject(shape, snapshot);
      canvas.add(object);
      objectIds.current.set(object, shape.id);
      shapeObjects.current.set(shape.id, object);
      if (shape.type === 'image') {
        const asset = snapshot.data.document.store[String(shape.props.assetId)];
        const src = asset?.typeName === 'asset' && typeof (asset.props as { src?: unknown } | undefined)?.src === 'string'
          ? (asset.props as { src: string }).src : '';
        if (/^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(src)) {
          const job = FabricImage.fromURL(src, { signal: images.signal }).then(image => {
            if (cancelled || !canvasRef.current || shapeObjects.current.get(shape.id) !== object) return;
            const position = canvas.getObjects().indexOf(object);
            if (position < 0) return;
            const absolute = absolutePosition(shape, snapshot);
            image.set({ left: absolute.x, top: absolute.y, originX: 'left', originY: 'top',
              scaleX: Number(shape.props.w) / Math.max(1, image.width), scaleY: Number(shape.props.h) / Math.max(1, image.height),
              angle: shape.rotation * 180 / Math.PI, opacity: shape.opacity,
              selectable: !shape.isLocked, lockMovementX: shape.isLocked, lockMovementY: shape.isLocked,
              lockScalingX: false, lockScalingY: false });
            canvas.remove(object);
            canvas.insertAt(position, image);
            objectIds.current.delete(object);
            objectIds.current.set(image, shape.id);
            shapeObjects.current.set(shape.id, image);
            if (selectedIdRef.current === shape.id) canvas.setActiveObject(image);
            canvas.requestRenderAll();
          }).catch(() => { /* Keep a visible placeholder if an owned upload is unavailable. */ });
          imageJobsRef.current.push(job);
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
    if (!snapshot || importingRef.current || status !== 'saved' || JSON.stringify(snapshot) !== savedRef.current ||
        previewedRevisionRef.current === revisionRef.current) return;
    const revision = revisionRef.current, document = snapshot;
    let cancelled = false;
    const timer = window.setTimeout(() => { void (async () => {
      await Promise.allSettled(imageJobsRef.current);
      const canvas = canvasRef.current;
      if (cancelled || !canvas || revisionRef.current !== revision || snapshotRef.current !== document) return;
      for (const frame of designFrames(document).slice(0, 40)) {
        if (cancelled || revisionRef.current !== revision || snapshotRef.current !== document) return;
        try {
          let png = await renderFramePng(canvas, frame, 1);
          if (png.size > 3 * 1024 * 1024) png = await renderFramePng(canvas, frame, 0.5);
          await api.uploadDesignPreview(page.id, frame.id, revision, png);
        } catch { /* Preview remains optional if an asset is unavailable. */ }
      }
      previewedRevisionRef.current = revision;
    })(); }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [snapshot, status, page.id, previewRefresh]);

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
        apply(incoming, false);
        setStatus('saved');
      } catch { /* Keep the local canvas during a transient failure. */ }
    })(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [apply, page.id, snapshot !== null]);

  const change = (patch: Parameters<typeof changeDesignShape>[2]) => {
    if (!snapshot || !selected) return;
    apply(changeDesignShape(snapshot, selected.id, patch));
  };
  const changeProps = (props: Record<string, unknown>) => change({ props });
  const undo = () => {
    const previous = historyRef.current.pop(), current = snapshotRef.current;
    if (!previous || !current) return;
    redoRef.current.push(current);
    snapshotRef.current = previous; setSnapshot(previous); setHistoryVersion(value => value + 1);
    setSelectedId(null);
  };
  const redo = () => {
    const next = redoRef.current.pop(), current = snapshotRef.current;
    if (!next || !current) return;
    historyRef.current.push(current);
    snapshotRef.current = next; setSnapshot(next); setHistoryVersion(value => value + 1);
    setSelectedId(null);
  };
  const removeSelected = () => {
    const current = snapshotRef.current, id = selectedIdRef.current;
    if (!current || !id) return;
    apply(removeDesignShape(current, id)); setSelectedId(null); selectedIdRef.current = null;
  };
  const duplicateSelected = () => {
    const current = snapshotRef.current, id = selectedIdRef.current;
    if (!current || !id) return;
    const copy = duplicateDesignShape(current, id);
    apply(copy.snapshot); setSelectedId(copy.id); selectedIdRef.current = copy.id;
  };
  const groupSelected = () => {
    const current = snapshotRef.current, canvas = canvasRef.current;
    if (!current || !canvas) return;
    const ids = canvas.getActiveObjects().map(object => objectIds.current.get(object)).filter((id): id is string => !!id);
    if (ids.length < 2) return;
    try { const result = groupDesignShapes(current, ids); apply(result.snapshot); setSelectedId(result.id); setMultiCount(0); }
    catch { setAssetError('Selecione elementos do mesmo quadro para agrupar.'); }
  };
  const ungroupSelected = () => {
    const current = snapshotRef.current, id = selectedIdRef.current;
    if (!current || !id) return;
    try { apply(ungroupDesignShape(current, id)); setSelectedId(null); }
    catch { setAssetError('Não foi possível desagrupar este elemento.'); }
  };
  const focusFrame = (frame: DesignShape) => {
    setActiveFrameId(frame.id); setSelectedId(frame.id);
    const canvas = canvasRef.current;
    if (canvas) setZoom(centerFrame(canvas, frame));
  };
  const onImageSelected = async (selectedFiles: FileList | null) => {
    const files = Array.from(selectedFiles ?? []);
    if (!files.length || !snapshotRef.current) return;
    setAssetError('');
    if (files.length > 50 || files.reduce((sum, file) => sum + file.size, 0) > 250 * 1024 * 1024) {
      setAssetError('Selecione até 50 imagens, com no máximo 250 MB no total.'); return;
    }
    const replaceId = replaceImageRef.current;
    if (replaceId && files.length > 1) { setAssetError('Selecione uma única imagem para substituir.'); return; }
    importingRef.current = files.length > 1;
    let completed = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (uploadCancelRef.current) return;
        setAssetProgress(`Importando ${index + 1}/${files.length}…`);
        const bitmap = await createImageBitmap(file);
        const naturalWidth = bitmap.width, naturalHeight = bitmap.height;
        bitmap.close();
        if (naturalWidth > 10000 || naturalHeight > 10000) throw new Error('Dimensões excedem o limite');
        if (index > 0) await new Promise(resolve => setTimeout(resolve, 10_500));
        if (uploadCancelRef.current) return;
        let src = '';
        for (let attempt = 0; attempt < 4; attempt++) {
          try { src = await api.uploadImage(file); break; }
          catch (error) {
            if (!(error instanceof Error) || !error.message.includes('429') || attempt === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 12_000));
          }
        }
        if (uploadCancelRef.current) return;
        const current = snapshotRef.current;
        if (!current) return;
        if (replaceId) apply(replaceDesignImage(current, replaceId, src));
        else if (files.length > 1 || !designFrames(current).length) {
          const name = file.name.replace(/\.[^.]+$/, '').slice(0, 160) || `Imagem ${index + 1}`;
          const artboard = addDesignFrame(current, name, naturalWidth, naturalHeight);
          const image = addDesignImage(artboard.snapshot, artboard.id, src, naturalWidth, naturalHeight);
          apply(changeDesignShape(image.snapshot, image.id, { x: 0, y: 0 }));
          setActiveFrameId(artboard.id); setSelectedId(image.id);
        } else {
          const target = designFrames(current).find(item => item.id === frameId) ?? designFrames(current)[0];
          if (!target) throw new Error('Crie um quadro antes de adicionar uma imagem');
          const ratio = Math.min(1, (Number(target.props.w) - 80) / naturalWidth, (Number(target.props.h) - 80) / naturalHeight);
          const result = addDesignImage(current, target.id, src, Math.max(1, Math.round(naturalWidth * ratio)), Math.max(1, Math.round(naturalHeight * ratio)));
          apply(result.snapshot); setSelectedId(result.id); setActiveFrameId(target.id);
        }
        completed++;
      }
    } catch { setAssetError(`Importadas ${completed}/${files.length} imagens. Verifique o formato ou a conexão e tente novamente.`); }
    finally { importingRef.current = false; setPreviewRefresh(value => value + 1); replaceImageRef.current = null; setAssetProgress(''); if (imageInput.current) imageInput.current.value = ''; }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  const exportAllFrames = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !frames.length || batchBusy) return;
    if (frames.length > 50) { setPreviewError('Exporte até 50 quadros por vez.'); return; }
    setBatchBusy(true); setPreviewError('');
    try {
      const files: Record<string, Uint8Array> = {};
      let total = 0;
      for (const [index, frame] of frames.entries()) {
        const blob = await renderFramePng(canvas, frame, scale);
        total += blob.size;
        if (total > 250 * 1024 * 1024) throw new Error('O lote excede 250 MB');
        const label = String(frame.props.name || 'quadro').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80);
        files[`${String(index + 1).padStart(2, '0')}-${label}.png`] = new Uint8Array(await blob.arrayBuffer());
      }
      const { zip } = await import('fflate');
      const archive = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)));
      const url = URL.createObjectURL(new Blob([new Uint8Array(archive)], { type: 'application/zip' }));
      const link = document.createElement('a'); link.href = url; link.download = `${page.title || 'design'}-quadros.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setPreviewError('Não foi possível exportar os quadros em ZIP.'); }
    finally { setBatchBusy(false); }
  };

  if (!snapshot) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--theme-muted)]" role="alert">
    {initial.error}. O conteúdo original foi preservado.
  </div>;

  const layerRows = (parentId: string, depth = 0): Array<{ shape: DesignShape; depth: number }> => {
    if (depth > 32) return [];
    return designShapes(snapshot).filter(shape => shape.parentId === parentId)
      .flatMap(shape => [{ shape, depth }, ...layerRows(shape.id, depth + 1)]);
  };

  return <div className="flex min-h-0 flex-1 bg-[#161616]">
    <aside className="hidden w-48 shrink-0 overflow-auto border-r border-[var(--theme-border)] bg-[var(--theme-card)] p-2 lg:block" aria-label="Camadas Design">
      <strong className="block px-2 py-2 text-xs">Quadros e camadas</strong>
      {frames.map(frame => <div key={frame.id}><button type="button" className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--theme-hover)]" onClick={() => focusFrame(frame)}>{String(frame.props.name || 'Quadro')}</button>
        {layerRows(frame.id).map(({ shape, depth }) => <button key={shape.id} type="button" className="block w-full truncate rounded py-1 pr-2 text-left text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]" style={{ paddingLeft: Math.min(32, 20 + depth * 10) }} onClick={() => { setActiveFrameId(frame.id); setSelectedId(shape.id); }}>{String(shape.props.name || shape.props.text || (shape.type === 'text' ? plainText(shape.props.richText) : shape.type))}</button>)}
      </div>)}
      {archived.length > 0 && <details className="mt-4 border-t border-[var(--theme-border)] px-2 pt-2 text-xs"><summary>Anotações preservadas ({archived.length})</summary>{archived.map((item, index) => <p key={index} className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>)}</details>}
    </aside>
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2 shadow-xl" aria-label="Ferramentas de Design">
        <input ref={imageInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Selecionar imagem para Design" className="hidden" onChange={event => { void onImageSelected(event.target.files); }} />
        <button type="button" aria-pressed={panEnabled} title="Arraste o canvas; também funciona com Espaço ou botão do meio" className={`rounded px-2 py-1 text-xs ${panEnabled ? 'bg-[var(--theme-primary)] text-white' : 'hover:bg-[var(--theme-hover)]'}`} onClick={() => {
          panModeRef.current = !panModeRef.current;
          setPanEnabled(panModeRef.current);
          panControlsRef.current?.sync();
        }}>✋ Pan</button>
        {presets.map(preset => <button key={preset.name} type="button" className="rounded px-2 py-1 text-xs hover:bg-[var(--theme-hover)]" onClick={() => { const result = addDesignFrame(snapshotRef.current!, preset.name, preset.w, preset.h); apply(result.snapshot); setActiveFrameId(result.id); setSelectedId(result.id); }}>+ {preset.name}</button>)}
        <button type="button" disabled={!frameId} className="rounded px-2 py-1 text-xs hover:bg-[var(--theme-hover)] disabled:opacity-40" onClick={() => { const result = addDesignCard(snapshotRef.current!, frameId!); apply(result.snapshot); setSelectedId(result.id); }}>+ Cartão</button>
        <select aria-label="Adicionar forma" value="" disabled={!frameId} className="rounded bg-[var(--theme-card)] px-2 py-1 text-xs disabled:opacity-40" onChange={event => {
          const kind = event.target.value as 'rectangle' | 'ellipse' | 'line';
          if (!frameId) return;
          const result = addDesignVector(snapshotRef.current!, frameId, kind);
          apply(result.snapshot); setSelectedId(result.id);
        }}><option value="" disabled>+ Forma</option><option value="rectangle">Retângulo</option><option value="ellipse">Círculo</option><option value="line">Linha</option></select>
        <button type="button" className="rounded px-2 py-1 text-xs hover:bg-[var(--theme-hover)]" onClick={() => { replaceImageRef.current = null; imageInput.current?.click(); }}>+ Imagens</button>
        <button type="button" disabled={!selected} title="Ctrl+D" className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={duplicateSelected}>Duplicar</button>
        <button type="button" disabled={multiCount < 2} className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={groupSelected}>Agrupar</button>
        <button type="button" disabled={selected?.type !== 'design-group'} className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={ungroupSelected}>Desagrupar</button>
        <button type="button" disabled={!selected} title="Delete" className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={removeSelected}>Excluir</button>
        <button type="button" disabled={!historyRef.current.length} title="Ctrl+Z" className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={undo}>Desfazer</button>
        <button type="button" disabled={!redoRef.current.length} title="Ctrl+Y" className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={redo}>Refazer</button>
        <button type="button" disabled={!frames.length} className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={() => exportFrame(false)}>Prévia</button>
        <select aria-label="Escala PNG" value={scale} onChange={event => setScale(Number(event.target.value) as 1 | 2)} className="rounded bg-[var(--theme-card)] text-xs"><option value={1}>1×</option><option value={2}>2×</option></select>
        <button type="button" disabled={!frames.length} className="rounded bg-[var(--theme-primary)] px-2 py-1 text-xs text-white disabled:opacity-40" onClick={() => exportFrame(true)}>Baixar PNG</button>
        <button type="button" disabled={!frames.length || batchBusy} className="rounded px-2 py-1 text-xs disabled:opacity-40" onClick={() => { void exportAllFrames(); }}>{batchBusy ? 'Preparando ZIP…' : 'Baixar quadros ZIP'}</button>
      </div>
      <div className="absolute inset-0"><canvas ref={canvasElement} /></div>
      <div className="absolute bottom-3 left-3 rounded bg-[var(--theme-card)] px-2 py-1 text-xs text-[var(--theme-muted)]" role="status">
        {status === 'saving' ? 'Salvando…' : status === 'error' ? <button type="button" onClick={() => { saveBlockedRef.current = false; void save(true); }}>Falha ao salvar · tentar novamente</button> : status === 'external' ? 'Alteração externa detectada · recarregue a página' : 'Salvo'} · {zoom}%
      </div>
      {previewError && <div className="absolute bottom-12 left-3 rounded bg-red-900 px-2 py-1 text-xs text-white" role="alert">{previewError}</div>}
      {assetError && <div className="absolute bottom-20 left-3 rounded bg-red-900 px-2 py-1 text-xs text-white" role="alert">{assetError}</div>}
      {assetProgress && <div className="absolute bottom-20 right-3 rounded bg-[var(--theme-card)] px-2 py-1 text-xs" role="status">{assetProgress}</div>}
      {preview && <div role="dialog" aria-modal="true" aria-label="Prévia do quadro" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"><button type="button" onClick={() => setPreview(null)} className="self-end rounded bg-white/15 px-3 py-1 text-sm text-white">Fechar</button><img src={preview} alt="Prévia do quadro Design" className="max-h-[85vh] max-w-full object-contain" /></div>}
    </div>
    <aside className="design-inspector" aria-label="Propriedades de Design">
      <div className="design-inspector-heading"><strong>Design</strong><span>{selected ? selected.type === 'frame' ? 'Quadro selecionado'
        : selected.type === 'design-card' ? 'Cartão selecionado' : selected.type === 'design-group' ? 'Grupo selecionado'
          : selected.type === 'image' ? 'Imagem selecionada' : 'Elemento selecionado' : 'Selecione um elemento'}</span></div>
      {selected && <><section className="design-inspector-section" aria-label="Layout"><h3>Layout</h3><div className="design-inspector-grid">
        <NumberField label="X" value={selected.x} onChange={x => change({ x })} />
        <NumberField label="Y" value={selected.y} onChange={y => change({ y })} />
        {selected.type !== 'design-group' && typeof selected.props.w === 'number' && <NumberField label="Largura" value={selected.props.w} min={1} max={10000} onChange={w => changeProps({ w })} />}
        {selected.type !== 'design-group' && typeof selected.props.h === 'number' && <NumberField label="Altura" value={selected.props.h} min={1} max={10000} onChange={h => changeProps({ h })} />}
        <NumberField label="Opacidade" value={selected.opacity} min={0} max={1} onChange={opacity => change({ opacity })} />
      </div></section>
      {selected.type === 'frame' ? <section className="design-inspector-section"><h3>Quadro</h3><label className="design-inspector-text"><span>Nome</span><input value={String(selected.props.name || '')} maxLength={160} onChange={event => changeProps({ name: event.target.value })} /></label></section>
        : selected.type === 'design-group' ? <section className="design-inspector-section"><h3>Grupo</h3><label className="design-inspector-text"><span>Nome</span><input value={String(selected.props.name || '')} maxLength={160} onChange={event => changeProps({ name: event.target.value })} /></label></section>
        : selected.type === 'design-card' ? <><section className="design-inspector-section" aria-label="Conteúdo do cartão"><h3>Conteúdo</h3><label className="design-inspector-text"><span>Texto</span><textarea aria-label="Texto do cartão" value={String(selected.props.text || '')} maxLength={5000} rows={6} onChange={event => changeProps({ text: event.target.value })} /></label>
          <label className="design-inspector-text"><span>Corpo com estilo próprio</span><textarea aria-label="Corpo do cartão" value={String(selected.props.body || '')} maxLength={5000} rows={4} onChange={event => changeProps({ body: event.target.value })} /></label>
          <NumberField label="Fonte px" value={Number(selected.props.fontSize || 24)} min={8} max={160} onChange={fontSize => changeProps({ fontSize })} />
          <label>Cor do texto<input aria-label="Cor do texto" type="color" value={String(selected.props.textColor || '#111827').slice(0, 7)} onChange={event => changeProps({ textColor: event.target.value })} /></label>
          <select aria-label="Família da fonte" value={String(selected.props.fontFamily || 'Inter')} onChange={event => changeProps({ fontFamily: event.target.value })}>{['Inter', 'Arial', 'Georgia', 'monospace'].map(font => <option key={font}>{font}</option>)}</select>
          <NumberField label="Peso da fonte" value={Number(selected.props.fontWeight || 400)} min={100} max={900} onChange={fontWeight => changeProps({ fontWeight })} />
          <NumberField label="Fonte do corpo px" value={Number(selected.props.bodyFontSize ?? 16)} min={8} max={160} onChange={bodyFontSize => changeProps({ bodyFontSize })} />
          <NumberField label="Peso do corpo" value={Number(selected.props.bodyFontWeight ?? 400)} min={100} max={900} onChange={bodyFontWeight => changeProps({ bodyFontWeight })} />
          <NumberField label="Distância título/corpo" value={Number(selected.props.bodyGap ?? 8)} min={0} max={200} onChange={bodyGap => changeProps({ bodyGap })} />
          <label>Cor do corpo<input aria-label="Cor do corpo" type="color" value={String(selected.props.bodyColor || '#111827').slice(0, 7)} onChange={event => changeProps({ bodyColor: event.target.value })} /></label>
          <select aria-label="Alinhamento horizontal" value={String(selected.props.textAlign || 'left')} onChange={event => changeProps({ textAlign: event.target.value })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select>
          <select aria-label="Alinhamento vertical" value={String(selected.props.verticalAlign || 'top')} onChange={event => changeProps({ verticalAlign: event.target.value })}><option value="top">Topo</option><option value="middle">Centro</option><option value="bottom">Base</option></select>
          <NumberField label="Espaçamento interno px" value={Number(selected.props.padding ?? 16)} min={0} max={200} onChange={padding => changeProps({ padding })} />
          <NumberField label="Altura de linha" value={Number(selected.props.lineHeight ?? 1.2)} min={0.8} max={3} onChange={lineHeight => changeProps({ lineHeight })} />
          <NumberField label="Espaçamento entre letras" value={Number(selected.props.letterSpacing ?? 0)} min={-5} max={20} onChange={letterSpacing => changeProps({ letterSpacing })} />
        </section><section className="design-inspector-section" aria-label="Preenchimento do cartão"><h3>Preenchimento</h3>
          <label>Cor de fundo<input aria-label="Cor de fundo" type="color" value={String(selected.props.fill || '#ffffff').slice(0, 7)} onChange={event => changeProps({ fill: event.target.value })} /></label>
          <label><input aria-label="Usar gradiente" type="checkbox" checked={typeof selected.props.gradientTo === 'string'} onChange={event => changeProps({ gradientTo: event.target.checked ? '#ffffff' : undefined })} /> Gradiente</label>
          {typeof selected.props.gradientTo === 'string' && <label>Cor final<input aria-label="Cor final do gradiente" type="color" value={selected.props.gradientTo.slice(0, 7)} onChange={event => changeProps({ gradientTo: event.target.value })} /></label>}
          <NumberField label="Raio px" value={Number(selected.props.radius ?? 16)} min={0} max={500} onChange={radius => changeProps({ radius })} />
        </section><section className="design-inspector-section" aria-label="Borda do cartão"><h3>Borda</h3>
          <NumberField label="Largura px" value={Number(selected.props.borderWidth ?? 1)} min={0} max={40} onChange={borderWidth => changeProps({ borderWidth })} />
          <label>Cor da borda<input aria-label="Cor da borda" type="color" value={String(selected.props.borderColor || '#d9dde5').slice(0, 7)} onChange={event => changeProps({ borderColor: event.target.value })} /></label>
        </section><section className="design-inspector-section" aria-label="Sombra do cartão"><h3>Sombra</h3>
          <NumberField label="Deslocamento X" value={Number(selected.props.shadowX ?? 0)} min={-200} max={200} onChange={shadowX => changeProps({ shadowX })} />
          <NumberField label="Deslocamento Y" value={Number(selected.props.shadowY ?? 8)} min={-200} max={200} onChange={shadowY => changeProps({ shadowY })} />
          <NumberField label="Desfoque" value={Number(selected.props.shadowBlur ?? 20)} min={0} max={200} onChange={shadowBlur => changeProps({ shadowBlur })} />
          <label>Cor da sombra<input aria-label="Cor da sombra" type="color" value={String(selected.props.shadowColor || '#000000').slice(0, 7)} onChange={event => changeProps({ shadowColor: event.target.value })} /></label>
        </section></> : selected.type === 'design-vector' ? <section className="design-inspector-section" aria-label="Forma"><h3>Forma</h3>
          <select aria-label="Tipo de forma" value={String(selected.props.kind || 'rectangle')} onChange={event => changeProps({ kind: event.target.value })}><option value="rectangle">Retângulo</option><option value="ellipse">Círculo</option><option value="line">Linha</option></select>
          {selected.props.kind !== 'line' && <label>Preenchimento<input aria-label="Preenchimento da forma" type="color" value={String(selected.props.fill || '#ffffff').slice(0, 7)} onChange={event => changeProps({ fill: event.target.value })} /></label>}
          <label>Contorno<input aria-label="Contorno da forma" type="color" value={String(selected.props.stroke || '#176fa8').slice(0, 7)} onChange={event => changeProps({ stroke: event.target.value })} /></label>
          <NumberField label="Largura do contorno" value={Number(selected.props.strokeWidth ?? 2)} min={0} max={40} onChange={strokeWidth => changeProps({ strokeWidth })} />
          {selected.props.kind === 'rectangle' && <NumberField label="Raio da forma" value={Number(selected.props.radius ?? 0)} min={0} max={500} onChange={radius => changeProps({ radius })} />}
        </section> : selected.type === 'image' ? <section className="design-inspector-section" aria-label="Imagem"><h3>Imagem</h3><button type="button" onClick={() => { replaceImageRef.current = selected.id; imageInput.current?.click(); }}>Trocar imagem</button></section>
          : <p className="design-inspector-empty">Este elemento foi preservado. Edite suas propriedades pelo MCP até o painel visual oferecer suporte completo.</p>}
      </>}
      {!selected && <p className="design-inspector-empty">Selecione um quadro ou cartão para editar.</p>}
    </aside>
  </div>;
}
