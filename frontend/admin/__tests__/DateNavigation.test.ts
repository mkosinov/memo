import { describe, it, expect } from 'vitest';
import { formatWeekRange, formatDayLabel } from '@/lib/utils';

describe('formatWeekRange', () => {
  it('formats week in same month', () => {
    // Monday June 8, 2026
    const monday = new Date(2026, 5, 8);
    expect(formatWeekRange(monday)).toBe('8-14 июня');
  });

  it('formats week crossing month boundary', () => {
    // Monday June 29, 2026 → Sunday July 5
    const monday = new Date(2026, 5, 29);
    expect(formatWeekRange(monday)).toBe('29 июня - 5 июля');
  });

  it('formats week in January', () => {
    // Monday Jan 5, 2026
    const monday = new Date(2026, 0, 5);
    expect(formatWeekRange(monday)).toBe('5-11 января');
  });

  it('formats week crossing year boundary', () => {
    // Monday Dec 28, 2026 → Sunday Jan 3, 2027
    const monday = new Date(2026, 11, 28);
    expect(formatWeekRange(monday)).toBe('28 декабря - 3 января');
  });
});

describe('formatDayLabel', () => {
  it('formats a single day', () => {
    const date = new Date(2026, 5, 11); // June 11
    expect(formatDayLabel(date)).toBe('11 июня');
  });

  it('formats first day of month', () => {
    const date = new Date(2026, 0, 1); // Jan 1
    expect(formatDayLabel(date)).toBe('1 января');
  });

  it('formats last day of month', () => {
    const date = new Date(2026, 4, 31); // May 31
    expect(formatDayLabel(date)).toBe('31 мая');
  });
});
