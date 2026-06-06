/**
 * Timezone DnD Regression Tests
 *
 * Regression tests for the timezone bug where:
 *   1. Drag-and-drop moves activity with -3h offset (UTC+3)
 *   2. Activity jumps forward by 1 day
 *
 * These tests verify that buildAdminSchedule and toScheduleIndex
 * handle naive datetime strings correctly in non-UTC timezones.
 * Setting TZ=Europe/Moscow (UTC+3) to exercise timezone edge cases.
 */

// Set timezone to UTC+3 BEFORE any Date usage
process.env.TZ = 'Europe/Moscow';

import { describe, it, expect } from 'vitest';
import { buildAdminSchedule, toScheduleIndex } from '@/lib/buildSchedule';
import type { ScheduleItem } from '@/lib/buildSchedule';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MONDAY = new Date('2026-06-01T00:00:00'); // Monday June 1, 2026

const mockMaster: MasterResponse = {
  id: 'm1',
  first_name: 'Анна',
  last_name: 'Иванова',
  color: '#FF5733',
  avatar_url: null,
  position: 'master',
  specialty: 'ceramics',
  is_active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

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
  material_hint: 'глина',
  tariffs: [{ id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 2500 }],
  tags: [{ id: 'tag1', tag: 'глина' }],
  is_active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockLocation: LocationResponse = {
  id: 'l1',
  name: 'Основной зал',
  address: 'ул. Примерная, 1',
  description: null,
  capacity: 10,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  location_hint: null,
  is_active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const makeActivity = (overrides: Partial<ActivityResponse> = {}): ActivityResponse => ({
  id: 'a1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'l1',
  start: '2026-06-01T10:00:00',
  duration: 120,
  occupied: 2,
  capacity: 6,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  is_active: true,
  ...overrides,
});

function makeScheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'a1',
    masterId: 'm1',
    serviceId: 's1',
    locationId: 'l1',
    day: 0,
    startTime: 10,
    duration: 2,
    occupied: 0,
    capacity: 6,
    isPrivate: false,
    serviceName: 'Гончарный круг',
    minAge: '6',
    ...overrides,
  };
}

// ─── Test 1: buildAdminSchedule extracts LOCAL time, not UTC ──────────────────

describe('Timezone DnD bug — buildAdminSchedule', () => {
  it('extracts LOCAL time from naive datetime string (not shifted by timezone)', () => {
    // The backend returns naive datetime strings like "2026-06-01T10:30:00"
    // These are local times. String slicing should extract them correctly
    // regardless of timezone.
    const { items } = buildAdminSchedule(
      [makeActivity({ start: '2026-06-01T10:30:00' })],
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );

    expect(items).toHaveLength(1);
    // startTime should be 10.5 (10:30), NOT 7.5 (07:30)
    expect(items[0].startTime).toBe(10.5);
    expect(items[0].time).toBe('10:30');
    // date should be "2026-06-01", NOT "2026-05-31"
    expect(items[0].date).toBe('2026-06-01');
  });
});

// ─── Test 2: dayToDate produces correct local date key ───────────────────────

describe('Timezone DnD bug — dayToDate via toScheduleIndex', () => {
  it('uses correct LOCAL date as byDate key (not UTC-shifted)', () => {
    // dayToDate() in buildSchedule.ts uses .toISOString().slice(0, 10)
    // In UTC+3, new Date('2026-06-01T00:00:00').toISOString()
    //   = "2026-05-31T21:00:00.000Z" → slice → "2026-05-31"
    // Expected: "2026-06-01" (the actual local date)
    //
    // BUG: toScheduleIndex → addToActivityIndex → dayToDate → .toISOString()
    // produces "2026-05-31" instead of "2026-06-01" in UTC+3

    const items: ScheduleItem[] = [
      makeScheduleItem({
        id: 'a1',
        day: 0, // Monday
        startTime: 10,
      }),
    ];

    const index = toScheduleIndex(items, MONDAY);

    // Should be indexed under "2026-06-01" (Monday June 1)
    expect(index.index.byDate.has('2026-06-01')).toBe(true);
    expect(index.index.byDate.get('2026-06-01')).toHaveLength(1);

    // BUG: In UTC+3, this will be under "2026-05-31" because
    // dayToDate uses .toISOString() which converts local midnight → UTC prev day
    expect(index.index.byDate.has('2026-05-31')).toBe(false);
  });

  it('dayToDate bug affects all days of the week when date is near midnight boundary', () => {
    // Activity on Sunday June 7 at 10:00 (day=6 from Monday June 1)
    const sundayActivity = makeScheduleItem({
      id: 'a-sun',
      day: 6,
      startTime: 10,
    });

    const index = toScheduleIndex([sundayActivity], MONDAY);

    // Should be under "2026-06-07"
    expect(index.index.byDate.has('2026-06-07')).toBe(true);

    // BUG: Will be under "2026-06-06" in UTC+3
    // because dayToDate creates Date at local midnight June 7,
    // .toISOString() gives June 6 21:00 UTC
  });
});


