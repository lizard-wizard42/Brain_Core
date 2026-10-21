import type { InkPoint, NotebookDoc, NotebookSheet, NotebookStroke, NotebookText } from '../../types';

export const SHEET_WIDTH = 800;
export const SHEET_HEIGHT = 1120;
export const PAPER_STYLES = [
  { id: 'blank', label: 'Branco' }, { id: 'ruled', label: 'Pautado' },
  { id: 'grid', label: 'Quadriculado' }, { id: 'dots', label: 'Pontilhado' }, { id: 'oxford', label: 'Oxford' },
] as const;
export const INK_COLORS = ['#24344b', '#2563eb', '#dc4545', '#338565', '#8b5cf6', '#e6b437'];
export const PAPER_COLORS = ['#fffdf7', '#ffffff', '#eaf4ee', '#edf3fb'];
export const newSheet = (): NotebookSheet => ({ id: crypto.randomUUID(), paper: 'ruled', spacing: 32, tint: '#fffdf7', strokes: [], texts: [] });
export const newNotebook = (): NotebookDoc => ({ notebook: true, version: 1, sheets: [newSheet()] });
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const ZOOM_MIN = .25;
export const ZOOM_MAX = 3;
/** Horizontal padding of the workspace (both sides together) that the fitted sheet must leave free. */
export const WORKSPACE_PADDING_X = 40;
/** Vertical room kept around a sheet when fitting it by height. */
const WORKSPACE_PADDING_Y = 56;
/** Smallest zoom a landscape fit may pick because of height, so a wide screen never shows a tiny sheet. */
const LANDSCAPE_MIN_FIT = .8;

/**
 * Zoom that makes the sheet fill the workspace width. In landscape (wider than tall) the sheet would
 * become huge, so the fit is capped by the height, but never below LANDSCAPE_MIN_FIT to stay readable.
 */
export function fitZoom(containerWidth: number, containerHeight?: number): number {
  let zoom = (containerWidth - WORKSPACE_PADDING_X) / SHEET_WIDTH;
  if (containerHeight !== undefined && containerHeight > 0 && containerWidth > containerHeight) {
    zoom = Math.min(zoom, Math.max((containerHeight - WORKSPACE_PADDING_Y) / SHEET_HEIGHT, LANDSCAPE_MIN_FIT));
  }
  return clamp(Number.isFinite(zoom) ? zoom : ZOOM_MIN, ZOOM_MIN, ZOOM_MAX);
}
export const textHeight = (text: NotebookText) => Math.min(SHEET_HEIGHT - text.y,
  Math.max(84, (text.text.split('\n').length + Math.ceil(text.text.length / Math.max(1, text.width / (text.fontSize * .6)))) * text.fontSize * 1.5 + 16));

export function moveSelection(sheet: NotebookSheet, ids: Set<string>, dx: number, dy: number): NotebookSheet {
  const points = sheet.strokes.filter(s => ids.has(s.id)).flatMap(s => s.points);
  const texts = sheet.texts.filter(t => ids.has(t.id));
  const bounds = [...points, ...texts.flatMap(t => [{ x: t.x, y: t.y }, { x: Math.min(800, t.x + t.width), y: Math.min(1120, t.y + textHeight(t)) }])];
  if (!bounds.length) return sheet;
  dx = clamp(dx, -Math.min(...bounds.map(p => p.x)), SHEET_WIDTH - Math.max(...bounds.map(p => p.x)));
  dy = clamp(dy, -Math.min(...bounds.map(p => p.y)), SHEET_HEIGHT - Math.max(...bounds.map(p => p.y)));
  return { ...sheet,
    strokes: sheet.strokes.map(s => ids.has(s.id) ? { ...s, points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) } : s),
    texts: sheet.texts.map(t => ids.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t),
  };
}

export function paperBackground(paper: NotebookSheet['paper'], spacing: number): React.CSSProperties {
  const line = 'rgba(103,133,157,.24)';
  if (paper === 'blank') return {};
  if (paper === 'dots') return { backgroundImage: 'radial-gradient(rgba(103,133,157,.42) 1px, transparent 1px)', backgroundSize: `${spacing}px ${spacing}px` };
  const horizontal = `linear-gradient(to bottom, transparent calc(100% - 1px), ${line} 1px)`;
  if (paper === 'grid') return { backgroundImage: `${horizontal}, linear-gradient(to right, transparent calc(100% - 1px), ${line} 1px)`, backgroundSize: `${spacing}px ${spacing}px` };
  return { backgroundImage: horizontal, backgroundSize: `100% ${spacing}px` };
}

function smooth(points: Array<{ x: number; y: number }>, close = false): string {
  if (!points.length) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    d += ` Q ${a.x} ${a.y} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
  }
  const last = points[points.length - 1];
  return d + ` L ${last.x} ${last.y}` + (close ? ' Z' : '');
}

/** Pressure changes the outline, keeping ink editable and independent of viewport zoom. */
export function strokePath(stroke: NotebookStroke): string {
  const p = stroke.points;
  if (!p.length) return '';
  if (stroke.tool === 'highlighter') return smooth(p.length === 1 ? [p[0], { x: p[0].x + .01, y: p[0].y }] : p);
  if (p.length === 1) {
    const r = stroke.width * (.35 + p[0].pressure * .65) / 2;
    return `M ${p[0].x-r} ${p[0].y} a ${r} ${r} 0 1 0 ${r*2} 0 a ${r} ${r} 0 1 0 ${-r*2} 0`;
  }
  const left: InkPoint[] = [], right: InkPoint[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const radius = stroke.width * (.35 + p[i].pressure * .65) / 2;
    left.push({ ...p[i], x: p[i].x - dy / len * radius, y: p[i].y + dx / len * radius });
    right.push({ ...p[i], x: p[i].x + dy / len * radius, y: p[i].y - dx / len * radius });
  }
  return smooth([...left, ...right.reverse()], true);
}

export function strokeHit(stroke: NotebookStroke, point: InkPoint, radius = 10): boolean {
  const p = stroke.points;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx*dx + dy*dy || 1), 0, 1);
    if (Math.hypot(point.x - a.x - t*dx, point.y - a.y - t*dy) <= radius + stroke.width / 2) return true;
  }
  return false;
}

/** Segment clipping catches long strokes crossing the selection even when no sampled vertex is inside. */
export function strokeIntersectsRect(stroke: NotebookStroke, left: number, top: number, right: number, bottom: number): boolean {
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[i], b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
    let low = 0, high = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const edges = [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]];
    let intersects = true;
    for (const [p, q] of edges) {
      if (p === 0) { if (q < 0) { intersects = false; break; } }
      else if (p < 0) low = Math.max(low, q / p);
      else high = Math.min(high, q / p);
      if (low > high) { intersects = false; break; }
    }
    if (intersects) return true;
  }
  return false;
}

// Kept aligned with the API's bounded version-1 document contract.
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;
const color = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Bound work and reject malformed snapshots instead of replacing a damaged notebook with blank paper. */
export function isNotebookDoc(value: unknown): value is NotebookDoc {
  if (!record(value) || value.notebook !== true || value.version !== 1 || !Array.isArray(value.sheets)
    || value.sheets.length < 1 || value.sheets.length > 100) return false;
  let points = 0, items = 0, textLength = 0;
  const sheetIds = new Set<string>();
  for (const sheet of value.sheets) {
    if (!record(sheet) || !id(sheet.id) || sheetIds.has(sheet.id)
      || !['blank', 'ruled', 'grid', 'dots', 'oxford'].includes(String(sheet.paper))
      || ![24, 32, 40].includes(Number(sheet.spacing)) || typeof sheet.spacing !== 'number' || !color(sheet.tint)
      || !Array.isArray(sheet.strokes) || !Array.isArray(sheet.texts)) return false;
    sheetIds.add(sheet.id);
    const ids = new Set<string>();
    for (const stroke of sheet.strokes) {
      if (!record(stroke) || !id(stroke.id) || ids.has(stroke.id) || !['pen', 'highlighter'].includes(String(stroke.tool))
        || !color(stroke.color) || !number(stroke.width, 0.5, 24) || !Array.isArray(stroke.points)
        || stroke.points.length < 1 || stroke.points.length > 10000) return false;
      ids.add(stroke.id);
      points += stroke.points.length;
      if (points > 100000) return false;
      for (const point of stroke.points) {
        if (!record(point) || !number(point.x, 0, 800) || !number(point.y, 0, 1120) || !number(point.pressure, 0, 1)) return false;
      }
    }
    for (const text of sheet.texts) {
      if (!record(text) || !id(text.id) || ids.has(text.id) || !number(text.x, 0, 800) || !number(text.y, 0, 1120)
        || !number(text.width, 40, 800) || typeof text.text !== 'string' || text.text.length > 10000
        || !color(text.color) || !number(text.fontSize, 12, 48)) return false;
      ids.add(text.id);
      textLength += text.text.length;
      if (textLength > 200000) return false;
    }
    items += sheet.strokes.length + sheet.texts.length;
    if (items > 10000) return false;
  }
  return true;
}
