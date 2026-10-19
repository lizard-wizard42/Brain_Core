import { randomUUID } from 'crypto';
import type { NotebookDoc } from '../types';

export class InvalidNotebook extends Error {}

export function defaultNotebook(): NotebookDoc {
  return { notebook: true, version: 1, sheets: [{ id: randomUUID(), paper: 'ruled', spacing: 32,
    tint: '#fffdf7', strokes: [], texts: [] }] };
}

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
