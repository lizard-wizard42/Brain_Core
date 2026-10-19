import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { InkPoint, NotebookSheet, NotebookStroke } from '../../types';
import { clamp, moveSelection, paperBackground, SHEET_HEIGHT, SHEET_WIDTH, strokeHit, strokeIntersectsRect, strokePath, textHeight } from './notebookModel';

export type NotebookTool = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text' | 'hand';
type Gesture = { pointerId: number; start: InkPoint; current: InkPoint } & (
  { kind: 'ink'; stroke: NotebookStroke } | { kind: 'erase'; sheet: NotebookSheet } |
  { kind: 'select' } | { kind: 'move'; original: NotebookSheet } |
  { kind: 'pan'; clientX: number; clientY: number }
);

const Ink = memo(function Ink({ stroke, selected }: { stroke: NotebookStroke; selected: boolean }) {
  return <path d={strokePath(stroke)} fill={stroke.tool === 'pen' ? stroke.color : 'none'}
    stroke={stroke.tool === 'highlighter' ? stroke.color : undefined}
    strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round"
    opacity={stroke.tool === 'highlighter' ? .32 : 1}
    style={selected ? { filter: 'drop-shadow(0 0 2px #2563eb)' } : undefined} />;
});

export function NotebookCanvas({ sheet, tool, color, width, fingerDrawing, zoom, locked, onChange, onLimit }: {
  sheet: NotebookSheet; tool: NotebookTool; color: string; width: number; fingerDrawing: boolean;
  zoom: number; locked: boolean; onChange: (sheet: NotebookSheet) => boolean; onLimit: () => void;
}) {
  const surface = useRef<SVGSVGElement>(null), livePath = useRef<SVGPathElement>(null);
  const gesture = useRef<Gesture | null>(null), frame = useRef<number>(0), penAt = useRef(0);
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

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

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
  const pointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('foreignObject')) return;
    if (e.pointerType === 'pen') penAt.current = Date.now();
    if (gesture.current || (e.pointerType === 'touch' && (Date.now() - penAt.current < 700 || e.width > 45 || e.height > 45))) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const p = point(e), base = { pointerId: e.pointerId, start: p, current: p };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (locked || tool === 'hand' || e.button === 1 || (e.pointerType === 'touch' && !fingerDrawing)) {
      gesture.current = { ...base, kind: 'pan', clientX: e.clientX, clientY: e.clientY }; return;
    }
    e.preventDefault();
    if (tool === 'text') {
      const id = crypto.randomUUID();
      const next = { ...sheet, texts: [...sheet.texts, { id, x: Math.min(p.x, 680), y: Math.min(p.y, 1030),
        width: Math.min(320, SHEET_WIDTH - Math.min(p.x, 680) - 16), text: '', color, fontSize: 20 }] };
      if (onChange(next)) setEditing(id); else onLimit();
    } else if (tool === 'eraser' || e.button === 5 || (e.buttons & 32) !== 0) {
      const next = erase(sheet, p); gesture.current = { ...base, kind: 'erase', sheet: next }; setPreview(next);
    } else if (tool === 'select') {
      if (bounds && p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height) {
        gesture.current = { ...base, kind: 'move', original: sheet };
      } else { setSelected(new Set()); gesture.current = { ...base, kind: 'select' }; }
    } else {
      const stroke: NotebookStroke = { id: crypto.randomUUID(), tool, color, width: tool === 'highlighter' ? width * 4 : width, points: [p] };
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

  return <div className="notebook-paper-wrap" style={{ width: `${zoom * 800}px` }}>
    <div className="notebook-paper" style={{ backgroundColor: sheet.tint, aspectRatio: '5 / 7', ...paperBackground(sheet.paper, sheet.spacing * zoom) }}>
      {sheet.paper === 'oxford' && <div className="notebook-margin" style={{ left: `${zoom * 80}px` }} />}
      <svg ref={surface} viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`} className="notebook-canvas"
        role="img" aria-label="Folha do caderno: escreva com caneta ou mouse; use Texto para digitar"
        style={{ touchAction: 'none', cursor: locked || tool === 'hand' ? 'grab' : tool === 'text' ? 'text' : 'crosshair' }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onContextMenu={e => e.preventDefault()}>
        {visible.strokes.map(stroke => <Ink key={stroke.id} stroke={stroke} selected={selected.has(stroke.id) && tool === 'select'} />)}
        <path ref={livePath} strokeLinecap="round" strokeLinejoin="round" />
        {visible.texts.map(text => <foreignObject key={text.id} x={text.x} y={text.y} width={text.width} height={textHeight(text)}
          style={{ pointerEvents: tool === 'text' && !locked ? 'auto' : 'none' }}>
          <textarea aria-label="Texto na folha" autoFocus={editing === text.id} value={text.text} readOnly={locked || tool !== 'text'}
            maxLength={10000} placeholder="Escreva aqui…" className="notebook-text"
            style={{ color: text.color, fontSize: text.fontSize, lineHeight: '1.5', outline: selected.has(text.id) ? '2px dashed #2563eb' : undefined }}
            onFocus={() => setEditing(text.id)} onBlur={() => setEditing(null)}
            onChange={e => onChange({ ...sheet, texts: sheet.texts.map(t => t.id === text.id ? { ...t, text: e.target.value } : t) })} />
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
