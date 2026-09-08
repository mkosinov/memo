/**
 * Timezone DnD Regression Tests (GH #142 — minutes canon)
 *
 * Historic bug this file guards: under TZ=Europe/Moscow (UTC+3) a
 * drag-and-dropped activity shifted by −3h AND jumped forward a day, because
 * the legacy pipeline (the deleted index-builder and its UTC-based day-date
 * helper, decimal hours instead of minutes) mixed UTC getters (toISOString,
 * UTC reparse) with naive studio-local timestamps. That legacy API is gone;
 * the regression guard lives on through the NEW canonical flow (spec §7):
 *
 *   READ   parseLocalISO(start) → { date, time, startMinutes, dayIndex }
 *          — a naive string is floating-local (RFC 5545 studio wall clock):
 *          `new Date()` parses it as LOCAL per the ES spec, so local getters
 *          return exactly the embedded wall time under any browser TZ.
 *   WRITE  composeLocalISO(dayIndexToDate(monday, dayIndex), startMinutes)
 *          — the DnD/mutation path (ScheduleDataContext.updateActivity) composes
 *          the same naive string back. Integer minutes end-to-end, no Date
 *          round-trip through UTC.
 *
 * Tests below: (1) buildAdminSchedule extracts local wall time at the Sunday
 * near-midnight edge — the original day-jump scenario; (2) the DnD write→read
 * round-trip is identity — no −3h shift, no day jump; (3) grid and the single
 * parser agree on one fixture (US-1/US-5 anchor: grid / records / quickcard
 * all read parseLocalISO now).
 *
 * TZ is pinned to Europe/Moscow (UTC+3) BEFORE any Date usage so any residual
 * UTC-conversion path becomes observable (vitest pool: 'forks' — the env var
 * applies in this forked process before the module loads).
 */

// Set timezone to UTC+3 BEFORE any Date usage
process.env.TZ = 'Europe/Moscow';

import { describe, it, expect } from 'vitest';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import { composeLocalISO, dayIndexToDate, parseLocalISO } from '@/lib/datetime';
import type { ActivityResponse, ServiceResponse } from '@memo/api-client';
import { mockMasterResponse, createMockLocationResponse } from './helpers/mockData';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MONDAY = new Date('2026-06-01T00:00:00'); // Monday June 1, 2026, local midnight

const mockService: ServiceResponse = {
  id: 's1',
  title: 'Гончарный круг',
  description: '',
  image_url: '',
  specialty: 'ceramics',
  min_age: 6,
  max_age: 99,
  duration: 120,
  record_info: '',
  tariffs: [{ id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 2500 }],
  tags: [{ id: 'tag1', tag: 'глина' }],
  materials: [],
  archived: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockLocation = createMockLocationResponse({ id: 'l1', name: 'Основной зал' });

const makeActivity = (overrides: Partial<ActivityResponse> = {}): ActivityResponse => ({
  id: 'a1',
  master_id: mockMasterResponse.id,
  service_id: mockService.id,
  location_id: mockLocation.id,
  start: '2026-06-01T10:00:00',
  duration: 120, // integer minutes (GH #142 canon)
  occupied: 2,
  capacity: 6,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

// ─── Test 1: buildAdminSchedule extracts LOCAL wall time (day-jump edge) ─────

describe('Timezone DnD bug — buildAdminSchedule local extraction', () => {
  it('reads naive Sunday 23:30 as day 6 / 1410 min — no day jump, no −3h shift', () => {
    // The backend returns naive floating-local strings. Sunday 23:30 is the
    // historic worst case: a UTC round-trip shifted it −3h (→ 20:30, 1230 min)
    // or pushed it into the next day (→ '2026-06-08', day 0 of the next week).
    const { items } = buildAdminSchedule(
      [makeActivity({ start: '2026-06-07T23:30:00' })], // Sunday
      [mockMasterResponse],
      [mockService],
      [mockLocation],
      MONDAY,
    );

    expect(items).toHaveLength(1);
    expect(items[0].startMinutes).toBe(1410); // 23:30, NOT 1230 (−3h shift)
    expect(items[0].time).toBe('23:30');
    expect(items[0].date).toBe('2026-06-07'); // NOT '2026-06-08' (day jump)
    expect(items[0].day).toBe(6); // Sunday, Mon=0..Sun=6 — stays in the week
  });
});

// ─── Test 2: DnD round-trip — compose (write) → parse (read) is identity ─────

describe('Timezone DnD bug — DnD round-trip via composeLocalISO/parseLocalISO', () => {
  it('drops Tuesday 09:30 and reads back exactly 570 min / dayIndex 1', () => {
    // Write path (ScheduleDataContext.updateActivity after a drop): dayIndex +
    // integer minutes → naive floating-local string, never through UTC.
    const composed = composeLocalISO(dayIndexToDate(MONDAY, 1), 570);
    expect(composed).toBe('2026-06-02T09:30:00'); // no 'Z', no offset

    // Read path (grid/records/quickcard): the single parser.
    const parsed = parseLocalISO(composed);
    // Legacy bug reparse via UTC yielded 390 min ('06:30') and/or dayIndex 0|2.
    expect(parsed.startMinutes).toBe(570);
    expect(parsed.dayIndex).toBe(1);
    expect(parsed.date).toBe('2026-06-02');
    expect(parsed.time).toBe('09:30');
  });
});

// ─── Test 3: grid parity — buildAdminSchedule ≡ parseLocalISO (US-1/US-5) ────

describe('Timezone DnD bug — grid parity through the single parser', () => {
  it('the same fixture yields identical startMinutes/time via parser and grid', () => {
    const start = '2026-06-02T09:30:00'; // Tuesday 09:30 studio wall clock

    const parsed = parseLocalISO(start);
    const { items } = buildAdminSchedule(
      [makeActivity({ start })],
      [mockMasterResponse],
      [mockService],
      [mockLocation],
      MONDAY,
    );

    expect(items).toHaveLength(1);
    // Anchor absolutes so parity cannot pass trivially on a shared wrong value.
    expect(parsed.startMinutes).toBe(570);
    expect(parsed.time).toBe('09:30');
    expect(parsed.dayIndex).toBe(1);
    // Grid item ≡ parser output — buildAdminSchedule reads parseLocalISO.
    expect(items[0].startMinutes).toBe(parsed.startMinutes);
    expect(items[0].time).toBe(parsed.time);
    expect(items[0].date).toBe(parsed.date);
    expect(items[0].day).toBe(parsed.dayIndex);
  });
});
