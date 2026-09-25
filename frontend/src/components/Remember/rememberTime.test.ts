import { describe, expect, it } from 'vitest';
import { spDateLong, spIsoDateLong, spTime, spTodayIso } from './rememberTime';

describe('rememberTime — anchored to America/Sao_Paulo', () => {
  it('spTodayIso returns the São Paulo civil date, not UTC', () => {
    // 2026-08-30 01:30 UTC is still 2026-08-29 (22:30) in São Paulo (UTC−3).
    const lateNightSP = new Date('2026-08-30T01:30:00Z');
    expect(spTodayIso(lateNightSP)).toBe('2026-08-29');
  });

  it('spTime formats the clock in São Paulo regardless of host timezone', () => {
    expect(spTime('2026-08-30T01:30:00Z')).toBe('22:30');
  });

  it('spTime returns "agora" for null', () => {
    expect(spTime(null)).toBe('agora');
  });

  it('spDateLong shifts an instant into the São Paulo day', () => {
    expect(spDateLong('2026-08-30T01:30:00Z')).toBe('29 de agosto de 2026');
  });

  it('spIsoDateLong renders a calendar-date string without drifting a day', () => {
    expect(spIsoDateLong('2026-08-29')).toBe('29 de agosto de 2026');
  });
});
