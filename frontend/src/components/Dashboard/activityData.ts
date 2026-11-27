import { localDate } from '../../services/localDate';

export function aggregateActivity(
  pages: ReadonlyArray<{ updated_at?: string | null }>,
  notes: ReadonlyArray<{ created_at?: string | null }>,
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const timestamp of [
    ...pages.map(page => page.updated_at),
    ...notes.map(note => note.created_at),
  ]) {
    if (!timestamp) continue;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const day = localDate(date);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return Array.from(counts, ([date, count]) => ({ date, count }));
}
