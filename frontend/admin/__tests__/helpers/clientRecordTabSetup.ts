/**
 * Shared mock data and setup helpers for ClientRecordTab tests.
 *
 * Each test file must call vi.mock() for @memo/api-client and
 * @tanstack/react-query at its own top level. This module provides
 * the plain mock data objects and a reusable beforeEach setup function.
 */
import { vi, type Mock } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import type { RecordResponse } from '@memo/api-client';

// ─── Mock data ─────────────────────────────────────────────────────────────

export const mockRecord: RecordResponse = {
  id: 'r1',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'visited',
  seats: 1,
  anonym_visits: 0,
  comment: null,
  custom_price: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  is_active: true,
  visits: [
    {
      id: 'v1',
      record_id: 'r1',
      visitor_id: 'vis1',
      price: 3500,
      custom_price: null,
      status: 'waiting',
      created_at: '',
      updated_at: '',
    },
  ],
};

export const mockRecordMultipleVisits: RecordResponse = {
  ...mockRecord,
  id: 'r2',
  visits: [
    { ...mockRecord.visits[0], id: 'v1', price: 3500 },
    { ...mockRecord.visits[0], id: 'v2', visitor_id: 'vis2', price: 2500 },
  ],
};

export const mockVisitors = [
  { id: 'vis1', client_id: 'c1', name: 'Анна Иванова', age: 30, created_at: '', updated_at: '', is_active: true },
  { id: 'vis2', client_id: 'c1', name: 'Мария Петрова', age: 25, created_at: '', updated_at: '', is_active: true },
];

export const mockActivityResponse = {
  id: 'ev_1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'loc1',
  start: '2026-05-15T14:00:00',
  duration: 150,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2026-05-01T00:00:00',
  updated_at: '2026-05-01T00:00:00',
  is_active: true,
  occupied: 3,
};

export const mockServiceResponse = {
  id: 's1',
  title: 'Картина маслом',
  description: 'Рисуем картину маслом',
  image_url: '',
  specialty: 'живопись',
  min_age: 6,
  max_age: 99,
  duration: 150,
  record_info: '',
  tariffs: [
    { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
    { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
  ],
  tags: [],
  is_active: true,
  created_at: '',
  updated_at: '',
};

export const mockMasters = [
  { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'artist', specialty: 'живопись', avatar_url: null, is_active: true, created_at: '', updated_at: '' },
];

export const mockLocations = [
  { id: 'loc1', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 20, yandex_map_url: null, review_url: null, record_info: null, image_url: null, is_active: true, created_at: '', updated_at: '' },
];

export const mockPayments = [
  { id: 'p1', record_id: 'r1', amount: 1500, method: 'card', created_at: '', updated_at: '' },
];

// ─── Helper: build mockUseQuery implementation ─────────────────────────────

/**
 * Returns a standard mockUseQuery.mockImplementation that resolves
 * all known query keys to their mock data. Pass overrides to customize
 * individual keys for a specific test.
 */
export function buildDefaultQueryImpl(
  mockUseQuery: Mock<typeof useQuery>,
  overrides?: Partial<Record<string, unknown>>,
) {
  return mockUseQuery.mockImplementation((options) => {
    const key = options?.queryKey?.[0] as string | undefined;
    if (key && overrides && key in overrides) {
      return overrides[key] as any;
    }
    if (key === 'visitors') {
      return { data: mockVisitors, isLoading: false, error: null } as any;
    }
    if (key === 'activity') {
      return { data: mockActivityResponse, isLoading: false, error: null } as any;
    }
    if (key === 'services') {
      return { data: [mockServiceResponse], isLoading: false, error: null } as any;
    }
    if (key === 'masters') {
      return { data: mockMasters, isLoading: false, error: null } as any;
    }
    if (key === 'locations') {
      return { data: mockLocations, isLoading: false, error: null } as any;
    }
    if (key === 'payments') {
      return { data: mockPayments, isLoading: false, error: null } as any;
    }
    return { data: mockRecord, isLoading: false, error: null } as any;
  });
}
