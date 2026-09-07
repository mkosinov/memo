/**
 * Records ↔ grid time parity (GH #142 Task 9, spec US-5).
 *
 * The records world reads the same naive `activity_start` / `activity.start`
 * strings as the schedule grid ("2026-09-03T10:30:00" = studio wall clock,
 * RFC 5545 floating time). Before this task the records-side parsers used UTC
 * getters, so on any non-UTC browser the table / detail panel / ClientQuickCard
 * showed times shifted by the TZ offset (CI never caught it — UTC runners).
 *
 * TZ is pinned to Europe/Moscow (UTC+3) BEFORE any Date usage so the shift is
 * observable: the legacy UTC parse of 10:30 yields 630-180 = 450 ("07:30").
 * pool: 'forks' keeps this file's TZ isolated from the rest of the suite.
 */

// Set timezone to UTC+3 BEFORE any Date usage (pattern: timezone-dnd-bug.test.ts)
process.env.TZ = 'Europe/Moscow';

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type {
  ActivityResponse,
  RecordView,
  ServiceResponse,
} from '@memo/api-client';
import { mockMasterResponse, createMockLocationResponse } from './helpers/mockData';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import { parseLocalISO } from '@/lib/datetime';
import { recordColumns } from '../app/(main)/records/components/recordsColumns';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** Thursday 2026-09-03, 10:30 studio wall clock — naive (no Z, no offset). */
const NAIVE_START = '2026-09-03T10:30:00';
/** Monday of that week (2026-08-31 is a Monday). */
const MONDAY = new Date('2026-08-31T00:00:00');

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
  materials: [],
  archived: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockLocation = createMockLocationResponse({ id: 'l1', name: 'Основной зал' });

const mockActivity: ActivityResponse = {
  id: 'a1',
  master_id: mockMasterResponse.id,
  service_id: mockService.id,
  location_id: mockLocation.id,
  start: NAIVE_START,
  duration: 120,
  occupied: 2,
  capacity: 6,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

function makeRecordView(overrides: Partial<RecordView> = {}): RecordView {
  return {
    id: 'rec-1',
    activity_id: mockActivity.id,
    client_id: 'c1',
    status: 'confirmed',
    seats: 1,
    anonym_visits: 0,
    comment: null,
    custom_price: null,
    created_at: '2026-09-01T10:00:00',
    updated_at: '2026-09-01T10:00:00',
    visits: [
      {
        id: 'vis-1',
        record_id: 'rec-1',
        visitor_id: 'v1',
        price: 2500,
        custom_price: null,
        status: 'active',
        created_at: '2026-09-01T10:00:00',
        updated_at: '2026-09-01T10:00:00',
      },
    ],
    client_name: 'Анна Смирнова',
    activity_start: NAIVE_START,
    service_title: mockService.title,
    master_name: 'Середа Ольга',
    location_name: mockLocation.name,
    master_color: '#5B8C7A',
    is_private: false,
    paid: 0,
    ...overrides,
  };
}

/** Render one column cell for a record row (no JSX needed — render() takes the element). */
function renderCell(key: string, record: RecordView): void {
  const column = recordColumns({ onClientClick: vi.fn() }).find((c) => c.key === key)!;
  render(column.render!(record) as ReactElement);
}

// ─── Grid ↔ records parity on one naive start ──────────────────────────────

describe('records time parity — grid vs records on one naive start (US-5)', () => {
  it('buildAdminSchedule reads 10:30 as 630 minutes, not 450 (UTC-shifted)', () => {
    const { items } = buildAdminSchedule(
      [mockActivity],
      [mockMasterResponse],
      [mockService],
      [mockLocation],
      MONDAY,
    );

    expect(items).toHaveLength(1);
    expect(items[0].startMinutes).toBe(630);
    expect(items[0].time).toBe('10:30');
    expect(items[0].date).toBe('2026-09-03');
  });

  it('parseLocalISO — the single parser records now share — agrees with the grid', () => {
    const parsed = parseLocalISO(NAIVE_START);
    expect(parsed.startMinutes).toBe(630);
    expect(parsed.time).toBe('10:30');
    expect(parsed.date).toBe('2026-09-03');
    expect(parsed.dayIndex).toBe(3); // Thursday, Mon=0
  });

  it('the records table date cell renders the studio-local 10:30 (was 07:30 on UTC+3)', () => {
    renderCell('date', makeRecordView());

    expect(screen.getByText('3 сентября')).toBeInTheDocument();
    // Legacy UTC parse under TZ=Europe/Moscow rendered 07:30 here.
    expect(screen.getByText('10:30')).toBeInTheDocument();
  });
});
