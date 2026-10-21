import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { InkPoint, NotebookSheet, NotebookStroke } from '../../types';
import { clamp, moveSelection, paperBackground, SHEET_HEIGHT, SHEET_WIDTH, strokeHit, strokeIntersectsRect, strokePath, textHeight, ZOOM_MAX, ZOOM_MIN } from './notebookModel';
import type { ZoomFocal } from './useNotebookZoom';

export type NotebookTool = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text' | 'hand';
/** What kind of pointer was last seen on the sheet; lets the editor show whether the pen is recognized. */
export type NotebookInput = { kind: 'pen' | 'touch' | 'mouse'; pressure: number; smallTouch: boolean };
/** How a sheet edit enters the undo history: `track: false` leaves no step, `group` merges quick successive edits. */
export type NotebookChangeOptions = { track?: boolean; group?: string };
type Gesture = { pointerId: number; touch: boolean; start: InkPoint; current: InkPoint } & (
  { kind: 'ink'; stroke: NotebookStroke } | { kind: 'erase'; sheet: NotebookSheet } |
  { kind: 'select' } | { kind: 'move'; original: NotebookSheet } |
  { kind: 'pan'; clientX: number; clientY: number }
);

type Contact = { x: number; y: number; at: number; palm: boolean };
type Pinch = { ids: [number, number]; startDist: number; startZoom: number; origin: { x: number; y: number }; startMid: { x: number; y: number };
  mid: { x: number; y: number }; zoom: number; raf: number };
const PEN_WINDOW_MS = 700, STALE_CONTACT_MS = 1500;
const isPalm = (e: { width: number; height: number }) => e.width > 45 || e.height > 45;

const Ink = memo(function Ink({ stroke, selected }: { stroke: NotebookStroke; selected: boolean }) {
  return <path d={strokePath(stroke)} fill={stroke.tool === 'pen' ? stroke.color : 'none'}
    stroke={stroke.tool === 'highlighter' ? stroke.color : undefined}
    strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round"
    opacity={stroke.tool === 'highlighter' ? .32 : 1}
    style={selected ? { filter: 'drop-shadow(0 0 2px #2563eb)' } : undefined} />;
});

export function NotebookCanvas({ sheet, tool, color, width, fingerDrawing, zoom, locked, onChange, onLimit, onInput, onZoom, onDoubleTap }: {
  sheet: NotebookSheet; tool: NotebookTool; color: string; width: number; fingerDrawing: boolean;
  zoom: number; locked: boolean; onChange: (sheet: NotebookSheet, options?: NotebookChangeOptions) => boolean; onLimit: () => void;
  onInput?: (input: NotebookInput) => void;
  /** Called once when a two-finger pinch ends. */
  onZoom?: (zoom: number, focal: ZoomFocal) => void;
  /** Called on a double tap of the bare sheet (fit/100%). */
  onDoubleTap?: (focal: ZoomFocal) => void;
}) {
  const surface = useRef<SVGSVGElement>(null), livePath = useRef<SVGPathElement>(null);
  const gesture = useRef<Gesture | null>(null), frame = useRef<number>(0), penAt = useRef(0);
  const lastEvent = useRef(0), lastKind = useRef(''), ring = useRef<SVGCircleElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const contacts = useRef(new Map<number, Contact>()), pinch = useRef<Pinch | null>(null);
  const background = useRef<{ id: number; x: number; y: number } | null>(null);
  const tapStart = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const multiTouch = useRef(false);
  const touchHandlers = useRef<{ down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }>(null!);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<NotebookSheet | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const visible = preview ?? sheet;
  const selectedStrokes = visible.strokes.filter(s => selected.has(s.id));
  const selectedTexts = visible.texts.filter(t => selected.has(t.id));
  const allPoints = [...selectedStrokes.flatMap(s => s.points), ...selectedTexts.flatMap(t => [{ x: t.x, y: t.y }, { x: Math.min(800, t.x + t.width), y: Math.min(1120, t.y + textHeight(t)) }])];
  const bounds = allPoints.length ? {
    x: Math.min(...allPoints.map(p => p.x)) - 6, y: Math.min(...allPoints.map(p => p.y)) - 6,
    width: Math.max(...allPoints.map(p => p.x)) - Math.min(...allPoints.map(p => p.x)) + 12,
    height: Math.max(...allPoints.map(p => p.y)) - Math.min(...allPoints.map(p => p.y)) + 12,
  } : null;

  useEffect(() => () => { cancelAnimationFrame(frame.current); if (pinch.current) cancelAnimationFrame(pinch.current.raf); }, []);

  const point = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): InkPoint => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: Math.round(clamp((e.clientX - rect.left) * SHEET_WIDTH / rect.width, 0, SHEET_WIDTH) * 100) / 100,
      y: Math.round(clamp((e.clientY - rect.top) * SHEET_HEIGHT / rect.height, 0, SHEET_HEIGHT) * 100) / 100,
      pressure: e.pointerType === 'pen' ? Math.round(clamp(e.pressure || .5, .05, 1) * 1000) / 1000 : .65 };
  };
  const erase = (current: NotebookSheet, p: InkPoint) => ({ ...current,
    strokes: current.strokes.filter(s => !strokeHit(s, p, 12)) });
  const paint = () => {
    frame.current = 0;
    const current = gesture.current;
    if (current?.kind === 'ink') livePath.current?.setAttribute('d', strokePath(current.stroke));
  };
  // Report the pointer kind only when it changes, so the editor can say "pen detected" without re-rendering on every move.
  const report = (e: ReactPointerEvent<SVGSVGElement>) => {
    const kind = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
    const smallTouch = kind === 'touch' && e.width <= 4 && e.height <= 4;
    const key = `${kind}${smallTouch ? '-small' : ''}`;
    if (lastKind.current !== key) { lastKind.current = key; onInput?.({ kind, pressure: e.pressure, smallTouch }); }
  };
  // A gesture whose pointerup/cancel never arrived (lost capture, re-render, browser quirk) must not block the pen forever.
  const dropGesture = () => {
    const held = gesture.current;
    if (!held) return;
    if (held.kind === 'ink' && held.stroke.points.length > 1 && !onChange({ ...sheet, strokes: [...sheet.strokes, held.stroke] })) onLimit();
    gesture.current = null; setPreview(null); setSelection(null);
    cancelAnimationFrame(frame.current); frame.current = 0;
    livePath.current?.setAttribute('d', '');
  };
  const moveRing = (e: ReactPointerEvent<SVGSVGElement>) => {
    const dot = ring.current;
    if (!dot) return;
    if (e.pointerType !== 'pen' || e.buttons !== 0 || gesture.current) { dot.style.visibility = 'hidden'; return; }
    const p = point(e);
    dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y)); dot.style.visibility = 'visible';
  };
  // A pinch is drawn as a CSS transform of the sheet, with no re-render, and applied to the real zoom once at the end.
  const clearPinchTransform = () => {
    const held = pinch.current;
    if (held) cancelAnimationFrame(held.raf);
    pinch.current = null;
    if (wrap.current) { wrap.current.style.transform = ''; wrap.current.style.transformOrigin = ''; wrap.current.style.willChange = ''; }
  };
  const endPinch = (apply: boolean) => {
    const held = pinch.current;
    if (!held) return;
    clearPinchTransform();
    if (apply && Math.abs(held.zoom - held.startZoom) > 1e-3) {
      onZoom?.(held.zoom, { clientX: held.mid.x, clientY: held.mid.y, fromX: held.startMid.x, fromY: held.startMid.y });
    }
  };
  const paintPinch = () => {
    const held = pinch.current;
    if (!held || !wrap.current) return;
    held.raf = 0;
    wrap.current.style.transform = `translate(${held.mid.x - held.startMid.x}px, ${held.mid.y - held.startMid.y}px) scale(${held.zoom / held.startZoom})`;
  };
  // Starting a pinch ends the one-finger gesture that began it: a pan is dropped, real finger ink is kept.
  const discardForPinch = () => {
    const held = gesture.current;
    if (!held) return;
    if (held.kind === 'ink' && held.stroke.points.length >= 3 && !onChange({ ...sheet, strokes: [...sheet.strokes, held.stroke] })) onLimit();
    try { if (surface.current?.hasPointerCapture?.(held.pointerId)) surface.current.releasePointerCapture(held.pointerId); } catch { /* already released */ }
    gesture.current = null; setPreview(null); setSelection(null);
    cancelAnimationFrame(frame.current); frame.current = 0;
    livePath.current?.setAttribute('d', '');
  };
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const touchDown = (e: PointerEvent) => {
    const now = Date.now();
    if (e.pointerType === 'pen') { penAt.current = now; if (pinch.current) endPinch(false); return; }
    if (e.pointerType !== 'touch') return;
    for (const [id, c] of contacts.current) if (now - c.at > STALE_CONTACT_MS) contacts.current.delete(id); // release lost
    contacts.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: now, palm: isPalm(e) });
    const onBackground = e.target === e.currentTarget || (e.target as Element).classList?.contains('notebook-paper-wrap');
    if (onBackground && contacts.current.size === 1) background.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (contacts.current.size === 1) { multiTouch.current = false; tapStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: now }; }
    else { multiTouch.current = true; tapStart.current = null; background.current = null; }
    if (pinch.current || contacts.current.size !== 2 || now - penAt.current < PEN_WINDOW_MS) return;
    if (gesture.current && !gesture.current.touch) return; // a pen or mouse gesture is in progress
    const [a, b] = [...contacts.current.entries()];
    if (a[1].palm || b[1].palm) return;
    discardForPinch();
    const rect = wrap.current?.getBoundingClientRect();
    const mid = { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 };
    pinch.current = { ids: [a[0], b[0]], startDist: Math.max(distance(a[1], b[1]), 1), startZoom: latest.current.zoom,
      origin: { x: rect ? mid.x - rect.left : 0, y: rect ? mid.y - rect.top : 0 }, startMid: mid, mid, zoom: latest.current.zoom, raf: 0 };
    if (wrap.current) { wrap.current.style.transformOrigin = `${pinch.current.origin.x}px ${pinch.current.origin.y}px`; wrap.current.style.willChange = 'transform'; }
  };
  const touchMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') { penAt.current = Date.now(); if (pinch.current) endPinch(false); return; }
    if (e.pointerType !== 'touch') return;
    const contact = contacts.current.get(e.pointerId);
    if (contact) { contact.x = e.clientX; contact.y = e.clientY; contact.at = Date.now(); }
    const held = pinch.current;
    if (held) {
      const a = contacts.current.get(held.ids[0]), b = contacts.current.get(held.ids[1]);
      if (!a || !b || !held.ids.includes(e.pointerId)) return;
      held.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      held.zoom = clamp(held.startZoom * distance(a, b) / held.startDist, ZOOM_MIN, ZOOM_MAX);
      if (!held.raf) held.raf = requestAnimationFrame(paintPinch);
      return;
    }
    const drag = background.current;
    if (drag && drag.id === e.pointerId) {
      wrap.current?.closest('.notebook-workspace')?.scrollBy(drag.x - e.clientX, drag.y - e.clientY);
      drag.x = e.clientX; drag.y = e.clientY;
    }
  };
  const touchUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const ended = pinch.current?.ids.includes(e.pointerId);
    contacts.current.delete(e.pointerId);
    if (background.current?.id === e.pointerId) background.current = null;
    if (ended) endPinch(true);
    const start = tapStart.current;
    tapStart.current = null;
    if (contacts.current.size === 0) multiTouch.current = false;
    if (!start || start.id !== e.pointerId || e.type !== 'pointerup' || ended || multiTouch.current) return;
    const now = Date.now();
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 10 || now - start.at >= 300 || now - penAt.current < PEN_WINDOW_MS) { lastTap.current = null; return; }
    const previous = lastTap.current, cfg = latest.current;
    const panning = cfg.locked || cfg.tool === 'hand' || !cfg.fingerDrawing;
    if (previous && now - previous.at < 350 && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 24 && cfg.tool !== 'text' && panning) {
      lastTap.current = null; cfg.onDoubleTap?.({ clientX: e.clientX, clientY: e.clientY });
    } else lastTap.current = { x: e.clientX, y: e.clientY, at: now };
  };
  const latest = useRef({ zoom, tool, locked, fingerDrawing, onDoubleTap });
  useEffect(() => {
    latest.current = { zoom, tool, locked, fingerDrawing, onDoubleTap };
    touchHandlers.current = { down: touchDown, move: touchMove, up: touchUp };
  });
  // Touch handling listens on the workspace so a pinch also works when the fingers land beside the sheet.
  useEffect(() => {
    const host = surface.current?.closest('.notebook-workspace') ?? wrap.current?.parentElement;
    if (!host) return;
    const down = (e: Event) => touchHandlers.current.down(e as PointerEvent);
    const move = (e: Event) => touchHandlers.current.move(e as PointerEvent);
    const up = (e: Event) => touchHandlers.current.up(e as PointerEvent);
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    return () => {
      host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up);
    };
  }, []);

  const pointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('foreignObject')) return;
    report(e);
    if (pinch.current && e.pointerType === 'pen') endPinch(false); // the pen always wins, whichever listener runs first
    if (pinch.current) return;
    if (gesture.current && (e.pointerType === 'pen' || Date.now() - lastEvent.current > 1500)) dropGesture();
    lastEvent.current = Date.now();
    if (e.pointerType === 'pen') penAt.current = Date.now();
    if (gesture.current || (e.pointerType === 'touch' && (Date.now() - penAt.current < 700 || e.width > 45 || e.height > 45))) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const p = point(e), base = { pointerId: e.pointerId, touch: e.pointerType === 'touch', start: p, current: p };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (locked || tool === 'hand' || e.button === 1 || (e.pointerType === 'touch' && !fingerDrawing && tool !== 'text')) {
      gesture.current = { ...base, kind: 'pan', clientX: e.clientX, clientY: e.clientY }; return;
    }
    e.preventDefault();
    // The pen's side button erases while held, then the current tool is back for the next stroke.
    const sideButton = e.pointerType === 'pen' && (e.buttons & 2) !== 0;
    if (tool === 'text' && !sideButton) {
      const id = crypto.randomUUID();
      const next = { ...sheet, texts: [...sheet.texts, { id, x: Math.min(p.x, 680), y: Math.min(p.y, 1030),
        width: Math.min(320, SHEET_WIDTH - Math.min(p.x, 680) - 16), text: '', color, fontSize: 20 }] };
      if (onChange(next, { track: false })) setEditing(id); else onLimit();
    } else if (tool === 'eraser' || sideButton || e.button === 5 || (e.buttons & 32) !== 0) {
      const next = erase(sheet, p); gesture.current = { ...base, kind: 'erase', sheet: next }; setPreview(next);
    } else if (tool === 'select') {
      if (bounds && p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height) {
        gesture.current = { ...base, kind: 'move', original: sheet };
      } else { setSelected(new Set()); gesture.current = { ...base, kind: 'select' }; }
    } else {
      const stroke: NotebookStroke = { id: crypto.randomUUID(), tool: tool === 'highlighter' ? 'highlighter' : 'pen', color, width: tool === 'highlighter' ? width * 4 : width, points: [p] };
      gesture.current = { ...base, kind: 'ink', stroke };
      if (livePath.current) {
        livePath.current.setAttribute('fill', tool === 'pen' ? color : 'none');
        livePath.current.setAttribute('stroke', tool === 'highlighter' ? color : 'none');
        livePath.current.setAttribute('stroke-width', String(stroke.width));
        livePath.current.setAttribute('opacity', tool === 'highlighter' ? '.32' : '1');
      }
      paint();
    }
  };
  const pointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'pen') penAt.current = Date.now();
    report(e); lastEvent.current = Date.now(); moveRing(e);
    const current = gesture.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const p = point(e); current.current = p;
    if (current.kind === 'pan') {
      const scroller = surface.current?.closest('.notebook-workspace');
      scroller?.scrollBy(current.clientX - e.clientX, current.clientY - e.clientY);
      current.clientX = e.clientX; current.clientY = e.clientY;
    } else if (current.kind === 'ink') {
      const samples = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const sample of samples.length ? samples : [e.nativeEvent]) {
        const next = point(sample), previous = current.stroke.points.at(-1)!;
        if (Math.hypot(next.x - previous.x, next.y - previous.y) >= .5 && current.stroke.points.length < 9999) current.stroke.points.push(next);
      }
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    } else if (current.kind === 'erase') {
      // Interpolate across the movement so a fast eraser does not skip narrow strokes.
      const distance = Math.hypot(p.x - current.start.x, p.y - current.start.y);
      const steps = Math.max(1, Math.ceil(distance / 8));
      for (let i = 1; i <= steps; i++) current.sheet = erase(current.sheet, { ...p,
        x: current.start.x + (p.x - current.start.x) * i / steps, y: current.start.y + (p.y - current.start.y) * i / steps });
      current.start = p; setPreview(current.sheet);
    } else if (current.kind === 'select') {
      setSelection({ x: Math.min(p.x, current.start.x), y: Math.min(p.y, current.start.y), width: Math.abs(p.x - current.start.x), height: Math.abs(p.y - current.start.y) });
    } else if (current.kind === 'move') {
      setPreview(moveSelection(current.original, selected, p.x - current.start.x, p.y - current.start.y));
    }
  };
  const finish = (e: ReactPointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== e.pointerId) return;
    if (current.kind === 'ink') {
      if (e.type === 'pointerup') {
        const last = current.stroke.points.at(-1)!, end = point(e);
        if (Math.hypot(last.x - end.x, last.y - end.y) >= .5 && current.stroke.points.length < 10000) current.stroke.points.push(end);
      }
      // A cancelled pen gesture still preserves the ink already received.
      if (!onChange({ ...sheet, strokes: [...sheet.strokes, current.stroke] })) onLimit();
    } else if (current.kind === 'erase' && current.sheet.strokes.length !== sheet.strokes.length) {
      onChange(current.sheet);
    } else if (current.kind === 'select' && e.type !== 'pointercancel') {
      const p = current.current, a = current.start;
      const left = Math.min(p.x, a.x), right = Math.max(p.x, a.x), top = Math.min(p.y, a.y), bottom = Math.max(p.y, a.y);
      const ids = sheet.strokes.filter(s => strokeIntersectsRect(s, left, top, right, bottom)).map(s => s.id);
      const texts = sheet.texts.filter(t => t.x <= right && t.x + t.width >= left && t.y <= bottom && t.y + textHeight(t) >= top).map(t => t.id);
      setSelected(new Set([...ids, ...texts]));
    } else if (current.kind === 'move') { onChange(moveSelection(current.original, selected, current.current.x - current.start.x, current.current.y - current.start.y)); }
    gesture.current = null; setPreview(null); setSelection(null);
    cancelAnimationFrame(frame.current); frame.current = 0;
    livePath.current?.setAttribute('d', '');
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return <div ref={wrap} className="notebook-paper-wrap" style={{ width: `${zoom * 800}px` }}>
    <div className="notebook-paper" style={{ backgroundColor: sheet.tint, aspectRatio: '5 / 7', ...paperBackground(sheet.paper, sheet.spacing * zoom) }}>
      {sheet.paper === 'oxford' && <div className="notebook-margin" style={{ left: `${zoom * 80}px` }} />}
      <svg ref={surface} viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`} className="notebook-canvas"
        role="img" aria-label="Folha do caderno: escreva com caneta ou mouse; use Texto para digitar"
        style={{ touchAction: 'none', cursor: locked || tool === 'hand' ? 'grab' : tool === 'text' ? 'text' : 'crosshair' }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onPointerLeave={() => { if (ring.current) ring.current.style.visibility = 'hidden'; }}
        onContextMenu={e => e.preventDefault()}>
        {visible.strokes.map(stroke => <Ink key={stroke.id} stroke={stroke} selected={selected.has(stroke.id) && tool === 'select'} />)}
        <path ref={livePath} strokeLinecap="round" strokeLinejoin="round" />
        <circle ref={ring} r="7" fill="none" stroke="#2563eb" strokeWidth="1.5" opacity=".75" pointerEvents="none" style={{ visibility: 'hidden' }} />
        {visible.texts.map(text => <foreignObject key={text.id} x={text.x} y={text.y} width={text.width} height={textHeight(text)}
          style={{ pointerEvents: tool === 'text' && !locked ? 'auto' : 'none' }}>
          <textarea aria-label="Texto na folha" autoFocus={editing === text.id} value={text.text} readOnly={locked || tool !== 'text'}
            maxLength={10000} placeholder="Escreva aqui…" className="notebook-text"
            style={{ color: text.color, fontSize: text.fontSize, lineHeight: '1.5', outline: selected.has(text.id) ? '2px dashed #2563eb' : undefined }}
            onFocus={() => setEditing(text.id)}
            onBlur={() => {
              setEditing(null);
              // A box that never got any text is clutter; removing it leaves no undo step of its own.
              if (!text.text.trim()) onChange({ ...sheet, texts: sheet.texts.filter(t => t.id !== text.id) }, { track: false });
            }}
            onChange={e => onChange({ ...sheet, texts: sheet.texts.map(t => t.id === text.id ? { ...t, text: e.target.value } : t) }, { group: `text:${text.id}` })} />
        </foreignObject>)}
        {tool === 'select' && (selection ?? bounds) && <rect {...(selection ?? bounds)!} fill="rgba(37,99,235,.06)" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 4" pointerEvents="none" />}
      </svg>
    </div>
    {tool === 'select' && selected.size > 0 && !locked && <div className="notebook-selection-actions">
      <span>{selected.size} selecionado(s) · arraste para mover</span>
      <button type="button" onClick={() => { onChange({ ...sheet, strokes: sheet.strokes.filter(s => !selected.has(s.id)), texts: sheet.texts.filter(t => !selected.has(t.id)) }); setSelected(new Set()); }}>Apagar seleção</button>
    </div>}
  </div>;
}
