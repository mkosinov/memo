import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  mixWithWhite,
  formatDate,
  formatActivityContext,
  formatActivityDateTime,
  formatActivityLabel,
  formatRecordLabel,
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

describe('formatActivityContext', () => {
  it('formats Saturday June 6, 2026 14:00 correctly', () => {
    const date = new Date(2026, 5, 6, 14, 0); // June 6, 2026 = Saturday
    expect(formatActivityContext(date)).toBe('Сб, 6 июня · 14:00');
  });
});

describe('formatActivityDateTime', () => {
  it('formats ISO datetime date-first as "dd.mm.yyyy HH:mm" (local time)', () => {
    expect(formatActivityDateTime('2026-06-07T14:05:00')).toBe('07.06.2026 14:05');
  });

  it('zero-pads single-digit days, months, hours and minutes', () => {
    expect(formatActivityDateTime('2026-01-05T09:07:00')).toBe('05.01.2026 09:07');
  });
});

describe('formatActivityLabel', () => {
  // Active-only /locations/all map — archived locations are NOT present.
  const locationsMap = new Map([['loc-1', { title: 'Студия на Невском' }]]);

  it('builds the full canonical label «dd.mm.yyyy HH:mm — location — service»', () => {
    const label = formatActivityLabel(
      { start: '2026-06-07T14:05:00', location_id: 'loc-1', service_title: 'Гончарный МК' },
      locationsMap,
    );
    expect(label).toBe('07.06.2026 14:05 — Студия на Невском — Гончарный МК');
  });

  it('omits the location segment when location_id is absent (2 segments)', () => {
    const label = formatActivityLabel(
      { start: '2026-06-07T14:05:00', service_title: 'Гончарный МК' },
      locationsMap,
    );
    expect(label).toBe('07.06.2026 14:05 — Гончарный МК');
  });

  it('omits the service segment when service_title is absent (2 segments)', () => {
    const label = formatActivityLabel(
      { start: '2026-06-07T14:05:00', location_id: 'loc-1' },
      locationsMap,
    );
    expect(label).toBe('07.06.2026 14:05 — Студия на Невском');
  });

  it('returns only the date-time when neither location nor service is present', () => {
    const label = formatActivityLabel({ start: '2026-06-07T14:05:00' }, locationsMap);
    expect(label).toBe('07.06.2026 14:05');
  });

  it('omits the location segment when the id does not resolve (archived location)', () => {
    const label = formatActivityLabel(
      { start: '2026-06-07T14:05:00', location_id: 'loc-archived', service_title: 'Гончарный МК' },
      locationsMap,
    );
    expect(label).toBe('07.06.2026 14:05 — Гончарный МК');
  });

  it('returns only the date-time for an unresolvable location with no service (no dangling separator)', () => {
    const label = formatActivityLabel(
      { start: '2026-06-07T14:05:00', location_id: 'loc-archived' },
      locationsMap,
    );
    expect(label).toBe('07.06.2026 14:05');
  });

  it('treats explicit null location_id and service_title as absent', () => {
    const label = formatActivityLabel(
      { start: '2026-06-07T14:05:00', location_id: null, service_title: null },
      locationsMap,
    );
    expect(label).toBe('07.06.2026 14:05');
  });
});

describe('formatRecordLabel', () => {
  it('formats an ISO activity start as "day month · HH:MM" (Addendum 13 dialog label)', () => {
    expect(formatRecordLabel('2026-05-15T14:00:00')).toBe('15 мая · 14:00');
  });

  it('returns the generic «запись» when no activity start is known', () => {
    expect(formatRecordLabel(null)).toBe('запись');
    expect(formatRecordLabel(undefined)).toBe('запись');
    expect(formatRecordLabel('')).toBe('запись');
  });
});
