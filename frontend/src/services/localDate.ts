/** Calendar date in the viewer's timezone, never a sliced UTC timestamp. */
export function localDate(value: Date = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function historyZoneQuery(): string {
  return `time_zone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`;
}
