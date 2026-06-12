import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  mixWithWhite,
  formatTime,
  getMonday,
  formatDate,
  formatDateISO,
  decimalToHHMM,
  hhmmToDecimal,
  formatActivityContext,
  generateTimeSlots,
  calculateGridTimeRange,
  HOURS_START,
  HOURS_END,
} from '@/lib/utils';

describe('hexToRgb', () => {
  it('converts hex to rgb object', () => {
    expect(hexToRgb('#5B8C7A')).toEqual({ r: 91, g: 140, b: 122 });
  });

  it('handles lowercase hex', () => {
    expect(hexToRgb('#a07060')).toEqual({ r: 160, g: 112, b: 96 });
  });

  it('handles 3-digit hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('mixWithWhite', () => {
  it('mixes grey with white at 0.5 ratio', () => {
    const result = mixWithWhite({ r: 100, g: 100, b: 100 }, 0.5);
    expect(result).toEqual({ r: 178, g: 178, b: 178 });
  });

  it('returns original at ratio 0', () => {
    const result = mixWithWhite({ r: 91, g: 140, b: 122 }, 0);
    expect(result).toEqual({ r: 91, g: 140, b: 122 });
  });

  it('returns white at ratio 1', () => {
    const result = mixWithWhite({ r: 0, g: 0, b: 0 }, 1);
    expect(result).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('formatTime', () => {
  it('formats whole hours', () => {
    expect(formatTime(10)).toBe('10:00');
  });

  it('formats half hours', () => {
    expect(formatTime(10.5)).toBe('10:30');
  });

  it('formats single digit hours', () => {
    expect(formatTime(9)).toBe('09:00');
  });

  it('formats 21:00', () => {
    expect(formatTime(21)).toBe('21:00');
  });

  // 5-minute grid
  it('formats 5-min intervals (9:05)', () => {
    expect(formatTime(9 + 5 / 60)).toBe('09:05');
  });

  it('formats 5-min intervals (10:10)', () => {
    expect(formatTime(10 + 10 / 60)).toBe('10:10');
  });

  it('formats 5-min intervals (10:25)', () => {
    expect(formatTime(10 + 25 / 60)).toBe('10:25');
  });

  // 15-minute grid
  it('formats 15-min intervals (9:15)', () => {
    expect(formatTime(9 + 15 / 60)).toBe('09:15');
  });

  it('formats 15-min intervals (10:45)', () => {
    expect(formatTime(10 + 45 / 60)).toBe('10:45');
  });

  it('formats 15-min intervals (14:30)', () => {
    expect(formatTime(14 + 30 / 60)).toBe('14:30');
  });

  // 5-min grid edge cases
  it('formats 5-min intervals (11:55)', () => {
    expect(formatTime(11 + 55 / 60)).toBe('11:55');
  });

  it('formats 5-min intervals (9:35)', () => {
    expect(formatTime(9 + 35 / 60)).toBe('09:35');
  });
});

describe('getMonday', () => {
  it('returns Monday for a Wednesday', () => {
    const wed = new Date(2026, 4, 13); // Wed May 13, 2026
    const monday = getMonday(wed);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(11);
  });

  it('returns same day for a Monday', () => {
    const mon = new Date(2026, 4, 11); // Mon May 11, 2026
    const result = getMonday(mon);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(11);
  });

  it('returns previous Monday for a Sunday', () => {
    const sun = new Date(2026, 4, 17); // Sun May 17, 2026
    const monday = getMonday(sun);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(11);
  });

  it('resets time to midnight', () => {
    const date = new Date(2026, 4, 13, 15, 30, 45);
    const monday = getMonday(date);
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
    expect(monday.getSeconds()).toBe(0);
  });
});

describe('formatDate', () => {
  it('formats date in Russian', () => {
    const date = new Date(2026, 4, 13); // May 13
    expect(formatDate(date)).toBe('13 мая');
  });

  it('formats January date', () => {
    const date = new Date(2026, 0, 1);
    expect(formatDate(date)).toBe('1 января');
  });

  it('formats December date', () => {
    const date = new Date(2026, 11, 31);
    expect(formatDate(date)).toBe('31 декабря');
  });
});

describe('formatDateISO', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2026, 4, 13); // May 13, 2026
    expect(formatDateISO(date)).toBe('2026-05-13');
  });

  it('pads single-digit month and day', () => {
    const date = new Date(2026, 0, 1); // Jan 1, 2026
    expect(formatDateISO(date)).toBe('2026-01-01');
  });

  it('formats December date', () => {
    const date = new Date(2026, 11, 31); // Dec 31, 2026
    expect(formatDateISO(date)).toBe('2026-12-31');
  });
});

describe('decimalToHHMM', () => {
  it('converts 1.5 to "01:30"', () => {
    expect(decimalToHHMM(1.5)).toBe('01:30');
  });

  it('converts 0 to "00:00"', () => {
    expect(decimalToHHMM(0)).toBe('00:00');
  });

  it('converts 2.25 to "02:15"', () => {
    expect(decimalToHHMM(2.25)).toBe('02:15');
  });
});

describe('hhmmToDecimal', () => {
  it('converts "01:30" to 1.5', () => {
    expect(hhmmToDecimal('01:30')).toBe(1.5);
  });

  it('converts "00:00" to 0', () => {
    expect(hhmmToDecimal('00:00')).toBe(0);
  });

  it('converts "02:15" to 2.25', () => {
    expect(hhmmToDecimal('02:15')).toBeCloseTo(2.25);
  });
});

describe('formatActivityContext', () => {
  it('formats Saturday June 6, 2026 14:00 correctly', () => {
    const date = new Date(2026, 5, 6, 14, 0); // June 6, 2026 = Saturday
    expect(formatActivityContext(date)).toBe('Сб, 6 июня · 14:00');
  });
});

describe('generateTimeSlots', () => {
  it('generates default slots from HOURS_START to HOURS_END', () => {
    const slots = generateTimeSlots(30);
    expect(slots[0]).toBe(HOURS_START);
    expect(slots[slots.length - 1]).toBeLessThan(HOURS_END);
    expect(slots.length).toBe((HOURS_END - HOURS_START) * 2);
  });

  it('generates slots with custom start and end', () => {
    const slots = generateTimeSlots(30, 7, 23);
    expect(slots[0]).toBe(7);
    expect(slots[slots.length - 1]).toBeCloseTo(22.5, 1);
    expect(slots.length).toBe((23 - 7) * 2);
  });

  it('generates 15-min frequency slots with custom range', () => {
    const slots = generateTimeSlots(15, 8, 12);
    expect(slots[0]).toBe(8);
    expect(slots).toContain(8.25);
    expect(slots).toContain(11.75);
    expect(slots.length).toBe((12 - 8) * 4);
  });
});

describe('calculateGridTimeRange', () => {
  it('returns working hours when no activities', () => {
    const range = calculateGridTimeRange([], 9, 21);
    expect(range).toEqual({ start: 9, end: 21 });
  });

  it('does not shrink below working hours range', () => {
    const activities = [{ startTime: 10, duration: 2 }]; // 10:00-12:00
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(9);
    expect(range.end).toBe(21);
  });

  it('extends end when activity goes past working hours', () => {
    // Activity: 20:00-23:00 (startTime=20, duration=3)
    const activities = [{ startTime: 20, duration: 3 }];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(9);
    expect(range.end).toBe(24); // ceil(23) + 1 = 24
  });

  it('extends start when activity starts before working hours', () => {
    // Activity: 7:00-9:00 (startTime=7, duration=2)
    const activities = [{ startTime: 7, duration: 2 }];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(6); // floor(7) - 1 = 6
    expect(range.end).toBe(21);
  });

  it('extends both start and end for early + late activities', () => {
    const activities = [
      { startTime: 6, duration: 1.5 },  // 6:00-7:30
      { startTime: 20.5, duration: 2.5 }, // 20:30-23:00
    ];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(5);  // floor(6) - 1 = 5
    expect(range.end).toBe(24);   // ceil(23) + 1 = 24
  });

  it('uses latest activity end time, not just start time', () => {
    // Short activity starting late: 21:00-21:30
    const activities = [{ startTime: 21, duration: 0.5 }];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(9);
    // ceil(21.5) + 1 = 23
    expect(range.end).toBe(23);
  });

  it('handles multiple activities at the same time', () => {
    const activities = [
      { startTime: 14, duration: 2 },
      { startTime: 14, duration: 1.5 },
    ];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range).toEqual({ start: 9, end: 21 });
  });

  it('caps endTime at 24 when activity would overflow past midnight', () => {
    // Activity: 21:00-25:00 (startTime=21, duration=4) → endTime=25
    const activities = [{ startTime: 21, duration: 4 }];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(9);
    expect(range.end).toBe(24); // clamped, not 25 or 26
  });

  it('caps endTime at 24 for extreme overnight activity', () => {
    // Activity: 23:00-30:00 (startTime=23, duration=7) → endTime=30
    const activities = [{ startTime: 23, duration: 7 }];
    const range = calculateGridTimeRange(activities, 9, 21);
    expect(range.start).toBe(9);
    expect(range.end).toBe(24); // Math.min(24, ceil(30)+1) = 24
  });
});
