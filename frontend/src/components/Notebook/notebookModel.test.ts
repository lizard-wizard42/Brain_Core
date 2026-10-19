import { describe, expect, it } from 'vitest';
import { isNotebookDoc, moveSelection, newNotebook, strokeHit, strokePath } from './notebookModel';
import type { NotebookStroke } from '../../types';
const stroke: NotebookStroke = { id: 'ink', tool: 'pen', color: '#24344b', width: 2, points: [{ x: 10, y: 20, pressure: .2 }, { x: 700, y: 1000, pressure: 1 }] };
describe('notebook editable document', () => {
  it('accepts fresh documents but rejects damaged, duplicate or out-of-page content', () => {
    const doc = newNotebook();
    expect(isNotebookDoc(doc)).toBe(true);
    expect(isNotebookDoc({ ...doc, sheets: [] })).toBe(false);
    expect(isNotebookDoc({ ...doc, sheets: [doc.sheets[0], doc.sheets[0]] })).toBe(false);
    expect(isNotebookDoc({ ...doc, sheets: [{ ...doc.sheets[0], strokes: [{ ...stroke, points: [{ x: NaN, y: 1, pressure: 1 }] }] }] })).toBe(false);
    expect(isNotebookDoc({ ...doc, sheets: [{ ...doc.sheets[0], strokes: [{ ...stroke, points: [{ x: 801, y: 1, pressure: 1 }] }] }] })).toBe(false);
    expect(isNotebookDoc({ ...doc, sheets: [{ ...doc.sheets[0], strokes: [stroke, stroke] }] })).toBe(false);
  });
  it('hits between sparse pen samples, not just recorded points', () => {
    expect(strokeHit(stroke, { x: 355, y: 510, pressure: 1 })).toBe(true);
    expect(strokeHit(stroke, { x: 790, y: 10, pressure: 1 })).toBe(false);
  });
  it('moves selected ink together, clamps its extent and preserves unselected ink and pressure', () => {
    const sheet = { ...newNotebook().sheets[0], strokes: [stroke, { ...stroke, id: 'other' }] };
    const moved = moveSelection(sheet, new Set(['ink']), 500, -100);
    expect(moved.strokes[0].points).toEqual([{ x: 110, y: 0, pressure: .2 }, { x: 800, y: 980, pressure: 1 }]);
    expect(moved.strokes[1]).toBe(sheet.strokes[1]);
    expect(sheet.strokes[0].points[0].x).toBe(10);
  });
  it('renders dots and pressure-varying ink as finite editable paths', () => {
    expect(strokePath({ ...stroke, points: [stroke.points[0]] })).toContain(' a ');
    expect(strokePath(stroke)).not.toMatch(/NaN|Infinity/);
    expect(strokePath({ ...stroke, tool: 'highlighter' })).not.toContain(' Z');
    expect(strokePath(stroke)).toContain(' Z');
  });
});
