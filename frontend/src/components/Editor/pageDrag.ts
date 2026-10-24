export const PAGE_DRAG_TYPE = 'application/x-brain-core-page';
export interface PageDrag { id: string; title: string; origin: 'editor' | 'sidebar'; reference: boolean }
let active: PageDrag | null = null;
export function writePageDrag(transfer: DataTransfer | null | undefined, page: PageDrag) {
  active = page;
  if (!transfer) return;
  transfer.setData(PAGE_DRAG_TYPE, JSON.stringify(page));
  transfer.effectAllowed = 'move';
}
export function clearPageDrag() { active = null; }
export function readPageDrag(transfer: DataTransfer | null): PageDrag | null {
  if (!transfer || !Array.from(transfer.types).includes(PAGE_DRAG_TYPE)) return null;
  try {
    const raw = transfer.getData(PAGE_DRAG_TYPE);
    if (!raw) return active;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const page = value as Partial<PageDrag>;
    return typeof page.id === 'string' && page.id.length > 0 && typeof page.title === 'string'
      && (page.origin === 'editor' || page.origin === 'sidebar') && typeof page.reference === 'boolean'
      ? page as PageDrag : null;
  } catch { return null; }
}
export function pageDropZone(y: number, top: number, height: number): 'before' | 'inside' | 'after' {
  const fraction = (y - top) / Math.max(1, height);
  return fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside';
}
