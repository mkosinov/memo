/**
 * lib/datetime.ts — floating-local time module (GH #142)
 *
 * Single-TZ app: naive strings = studio wall clock (RFC 5545 floating time).
 * TZ=Europe/Moscow (UTC+3) exercises the timezone edge cases, following the
 * pattern of __tests__/timezone-dnd-bug.test.ts (vitest pool: 'forks' — the
 * env var is applied in this forked process before any Date usage).
 */

// Set timezone to UTC+3 BEFORE any Date usage
process.env.TZ = 'Europe/Moscow';

import { describe, it, expect } from 'vitest';
import {
  parseLocalISO,
  dateToLocalISO,
  composeLocalISO,
  toISODate,
  dayIndexToDate,
  weekDayIndex,
  formatTime,
  hhmmToMinutes,
  getMonday,
  generateTimeSlots,
  calculateGridTimeRange,
} from '@/lib/datetime';

// ─── parseLocalISO ────────────────────────────────────────────────────────────

describe('parseLocalISO', () => {
  it('parses a naive datetime string as studio wall clock (no TZ shift)', () => {
    // Regression core of GH #142: under TZ=Europe/Moscow a naive string must
    // yield the embedded wall time — 10:30 → 630 min, NOT shifted −3h → 450.
    const parsed = parseLocalISO('2026-09-03T10:30:00');
    expect(parsed.date).toBe('2026-09-03');
    expect(parsed.time).toBe('10:30');
    expect(parsed.startMinutes).toBe(630);
    // 2026-09-03 is a Thursday → Mon=0..Sun=6 → 3
    expect(parsed.dayIndex).toBe(3);
  });

  it('parses a Z-suffixed string to browser-local wall time (accepted fixture semantics)', () => {
    // 10:30Z → 13:30 in Moscow. Z/offset strings appear only in test fixtures
    // (spec §7): local getters show browser-local wall time — accepted.
    const parsed = parseLocalISO('2026-09-03T10:30:00Z');
    expect(parsed.date).toBe('2026-09-03');
    expect(parsed.time).toBe('13:30');
    expect(parsed.startMinutes).toBe(810);
  });

  it('parses an offset-suffixed string to browser-local wall time', () => {
    // 10:30+05:00 → 05:30 UTC → 08:30 in Moscow.
    const parsed = parseLocalISO('2026-09-03T10:30:00+05:00');
    expect(parsed.date).toBe('2026-09-03');
    expect(parsed.time).toBe('08:30');
    expect(parsed.startMinutes).toBe(510);
  });

  it('handles midnight and end-of-day boundaries', () => {
    expect(parseLocalISO('2026-09-07T00:00:00').startMinutes).toBe(0);
    expect(parseLocalISO('2026-09-07T23:59:00').startMinutes).toBe(1439);
  });
});

// ─── Round-trips ──────────────────────────────────────────────────────────────

describe('dateToLocalISO / composeLocalISO / parseLocalISO round-trips', () => {
  it('dateToLocalISO composes the floating-local string from a Date (local getters)', () => {
    // Month is 0-indexed: 8 = September.
    expect(dateToLocalISO(new Date(2026, 8, 3, 10, 30, 0))).toBe('2026-09-03T10:30:00');
    expect(dateToLocalISO(new Date(2026, 0, 5, 0, 5, 0))).toBe('2026-01-05T00:05:00');
  });

  it('composeLocalISO builds `${date}T${HH}:${MM}:00` from integer minutes', () => {
    expect(composeLocalISO('2026-09-03', 630)).toBe('2026-09-03T10:30:00');
    expect(composeLocalISO('2026-09-03', 0)).toBe('2026-09-03T00:00:00');
    expect(composeLocalISO('2026-09-03', 1439)).toBe('2026-09-03T23:59:00');
  });

  it('parseLocalISO ∘ composeLocalISO is identity on startMinutes', () => {
    for (const minutes of [0, 1, 59, 60, 630, 1259, 1439]) {
      expect(parseLocalISO(composeLocalISO('2026-09-03', minutes)).startMinutes).toBe(minutes);
    }
  });

  it('composeLocalISO ∘ parseLocalISO is identity on naive strings', () => {
    const naive = '2026-09-03T10:30:00';
    const parsed = parseLocalISO(naive);
    expect(composeLocalISO(parsed.date, parsed.startMinutes)).toBe(naive);
  });

  it('parseLocalISO ∘ dateToLocalISO preserves local wall time (no UTC drift)', () => {
    // 00:30 local in Moscow = 21:30 UTC of the PREVIOUS day — .toISOString()
    // would drift the date; local getters must not.
    const d = new Date(2026, 8, 3, 0, 30, 0);
    const parsed = parseLocalISO(dateToLocalISO(d));
    expect(parsed.date).toBe('2026-09-03');
    expect(parsed.startMinutes).toBe(30);
  });
});

// ─── toISODate / weekDayIndex / dayIndexToDate ───────────────────────────────

describe('toISODate', () => {
  it('uses local getters, not toISOString (no UTC date drift)', () => {
    // 00:30 Moscow = 21:30 UTC prev day; local date must stay 2026-09-03.
    expect(toISODate(new Date(2026, 8, 3, 0, 30))).toBe('2026-09-03');
    expect(toISODate(new Date(2026, 8, 3, 23, 59))).toBe('2026-09-03');
    expect(toISODate(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});

describe('weekDayIndex', () => {
  it('returns Mon=0 .. Sun=6', () => {
    expect(weekDayIndex(new Date(2026, 8, 7))).toBe(0); // Monday Sep 7, 2026
    expect(weekDayIndex(new Date(2026, 8, 13))).toBe(6); // Sunday Sep 13, 2026
    expect(weekDayIndex(new Date(2026, 8, 10))).toBe(3); // Thursday
  });
});

describe('dayIndexToDate', () => {
  const monday = new Date(2026, 8, 7); // Monday Sep 7, 2026

  it('maps dayIndex 0 to the Monday itself', () => {
    expect(dayIndexToDate(monday, 0)).toBe('2026-09-07');
  });

  it('maps dayIndex 6 to Sunday (week edge)', () => {
    expect(dayIndexToDate(monday, 6)).toBe('2026-09-13');
  });

  it('round-trips a Sunday activity: parseLocalISO.dayIndex → dayIndexToDate', () => {
    const sundayActivity = parseLocalISO('2026-09-13T10:00:00');
    expect(sundayActivity.dayIndex).toBe(6);
    expect(dayIndexToDate(monday, sundayActivity.dayIndex)).toBe('2026-09-13');
  });

  it('crosses the month boundary correctly', () => {
    const monthEdgeMonday = new Date(2026, 7, 31); // Monday Aug 31, 2026
    expect(dayIndexToDate(monthEdgeMonday, 0)).toBe('2026-08-31');
    expect(dayIndexToDate(monthEdgeMonday, 6)).toBe('2026-09-06');
  });
});

// ─── formatTime / hhmmToMinutes ──────────────────────────────────────────────

describe('formatTime', () => {
  it('formats integer minutes as HH:MM (display only)', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(630)).toBe('10:30');
    expect(formatTime(1439)).toBe('23:59');
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(540)).toBe('09:00');
  });
});

describe('hhmmToMinutes', () => {
  it('parses valid HH:MM to integer minutes', () => {
    expect(hhmmToMinutes('10:30')).toBe(630);
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('23:59')).toBe(1439);
    expect(hhmmToMinutes('9:05')).toBe(545);
  });

  it('returns NaN for invalid input (callers guard, as today)', () => {
    expect(hhmmToMinutes('abc')).toBeNaN();
    expect(hhmmToMinutes('')).toBeNaN();
    expect(hhmmToMinutes('10')).toBeNaN();
    expect(hhmmToMinutes('10:xx')).toBeNaN();
  });
});

// ─── getMonday ────────────────────────────────────────────────────────────────

describe('getMonday', () => {
  it('returns the same date at midnight for a Monday', () => {
    const result = getMonday(new Date(2026, 8, 7, 15, 45));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(7);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it('goes back to Monday from mid-week and from Sunday', () => {
    // Wednesday Sep 9 → Monday Sep 7
    expect(toISODate(getMonday(new Date(2026, 8, 9, 12, 0)))).toBe('2026-09-07');
    // Sunday Sep 13 → Monday Sep 7 (day===0 → −6, NOT +1)
    expect(toISODate(getMonday(new Date(2026, 8, 13, 23, 30)))).toBe('2026-09-07');
  });

  it('crosses the month boundary backwards', () => {
    // Wednesday Oct 1, 2026 → Monday Sep 28... Sep 28 is Monday? Sep 7 Mon →
    // Sep 28 Mon ✓
    expect(toISODate(getMonday(new Date(2026, 9, 1, 10, 0)))).toBe('2026-09-28');
  });

  it('does not mutate the input Date', () => {
    const input = new Date(2026, 8, 9, 12, 0);
    getMonday(input);
    expect(input.getDate()).toBe(9);
    expect(input.getHours()).toBe(12);
  });
});

// ─── generateTimeSlots ────────────────────────────────────────────────────────

describe('generateTimeSlots', () => {
  it('generates minute slots with exclusive end boundary (utils semantics)', () => {
    expect(generateTimeSlots(30, 540, 660)).toEqual([540, 570, 600, 630]);
  });

  it('covers full working hours at 30/60/15-minute frequencies', () => {
    expect(generateTimeSlots(60, 540, 1260)).toHaveLength(12);
    expect(generateTimeSlots(30, 540, 1260)).toHaveLength(24);
    expect(generateTimeSlots(15, 600, 645)).toEqual([600, 615, 630]);
  });

  it('returns an empty array when start >= end', () => {
    expect(generateTimeSlots(30, 660, 660)).toEqual([]);
    expect(generateTimeSlots(30, 700, 660)).toEqual([]);
  });
});

// ─── calculateGridTimeRange ───────────────────────────────────────────────────

describe('calculateGridTimeRange', () => {
  it('returns working-hours default for empty acts', () => {
    expect(calculateGridTimeRange([], 9, 21)).toEqual({ startMinutes: 540, endMinutes: 1260 });
  });

  it('never shrinks below working hours for activities inside them', () => {
    const acts = [{ startMinutes: 600, durationMinutes: 120 }];
    expect(calculateGridTimeRange(acts, 9, 21)).toEqual({ startMinutes: 540, endMinutes: 1260 });
  });

  it('extends the start with ≥60min padding for an early activity', () => {
    // 08:30 start → floor to hour (480) − 60 → 420; padding 510−420 = 90 ≥ 60
    const acts = [{ startMinutes: 510, durationMinutes: 60 }];
    const range = calculateGridTimeRange(acts, 9, 21);
    expect(range.startMinutes).toBe(420);
    expect(510 - range.startMinutes).toBeGreaterThanOrEqual(60);
    expect(range.endMinutes).toBe(1260);
  });

  it('extends the end with ≥60min padding for a late activity', () => {
    // 20:30 + 60 → ends 1290 > 1260 → ceil to hour (1320) + 60 → 1380
    const acts = [{ startMinutes: 1230, durationMinutes: 60 }];
    const range = calculateGridTimeRange(acts, 9, 21);
    expect(range.startMinutes).toBe(540);
    expect(range.endMinutes).toBe(1380);
    expect(range.endMinutes - 1290).toBeGreaterThanOrEqual(60);
  });

  it('clamps the start to 0 (midnight)', () => {
    // 00:30 start → floor(30/60)*60 − 60 = −60 → clamped to 0
    const acts = [{ startMinutes: 30, durationMinutes: 60 }];
    expect(calculateGridTimeRange(acts, 9, 21).startMinutes).toBe(0);
  });

  it('clamps the end to 1440 (end of day)', () => {
    // 23:00 + 120 → ends 1500 → ceil (1500) + 60 = 1560 → clamped to 1440
    const acts = [{ startMinutes: 1380, durationMinutes: 120 }];
    expect(calculateGridTimeRange(acts, 9, 21).endMinutes).toBe(1440);
  });

  it('uses the earliest start and latest end across multiple acts', () => {
    const acts = [
      { startMinutes: 600, durationMinutes: 120 }, // ends 720
      { startMinutes: 480, durationMinutes: 60 }, // 08:00 < wh start 09:00 → floor(480) − 60 = 420
      { startMinutes: 1200, durationMinutes: 180 }, // ends 1380 > 1260 → ceil 1380 + 60 = 1440 (clamped)
    ];
    expect(calculateGridTimeRange(acts, 9, 21)).toEqual({ startMinutes: 420, endMinutes: 1440 });
  });

  it('honors non-default working hours', () => {
    const acts = [{ startMinutes: 420, durationMinutes: 60 }]; // 07:00–08:00
    // wh 8..20 → 420 < 480 → floor(420) − 60 = 360
    expect(calculateGridTimeRange(acts, 8, 20)).toEqual({ startMinutes: 360, endMinutes: 1200 });
  });
});
