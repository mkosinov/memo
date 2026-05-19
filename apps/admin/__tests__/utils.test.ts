import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  mixWithWhite,
  formatTime,
  getMonday,
  formatDate,
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
