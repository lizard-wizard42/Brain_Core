/**
 * Time helpers for the Remember timeline, pinned to São Paulo.
 *
 * The app is Brazil-only, so every civil date/clock shown in the memory
 * timeline is anchored to `America/Sao_Paulo` instead of the viewer's device
 * clock or UTC. Using `Date#toISOString()` for "today" was returning tomorrow
 * between 21:00 and 23:59 local time (UTC−3).
 */
export const SP_TZ = 'America/Sao_Paulo';

/** Civil date (YYYY-MM-DD) for `at` as seen in São Paulo. */
export function spTodayIso(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ }).format(at);
}

/** `HH:MM` clock in São Paulo for an absolute instant. */
export function spTime(value: string | null): string {
  if (!value) return 'agora';
  return new Date(value).toLocaleTimeString('pt-BR', {
    timeZone: SP_TZ, hour: '2-digit', minute: '2-digit',
  });
}

/** Long date ("29 de agosto de 2026") in São Paulo for an absolute instant. */
export function spDateLong(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: SP_TZ, dateStyle: 'long' });
}

/** Long date for a calendar-date string (YYYY-MM-DD), no timezone shift. */
export function spIsoDateLong(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', {
    timeZone: SP_TZ, dateStyle: 'long',
  });
}

/** Full date + short time in São Paulo for an absolute instant. */
export function spDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { timeZone: SP_TZ });
}

/** Short date + short time in São Paulo (used for note titles). */
export function spDateTimeShort(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: SP_TZ, dateStyle: 'short', timeStyle: 'short',
  });
}
