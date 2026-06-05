import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { RecordsContextType } from '../contexts/RecordsContext';
import type {
  RecordResponse,
  ClientResponse,
  ActivityResponse,
  ServiceResponse,
  MasterResponse,
  LocationResponse,
  PaymentResponse,
} from '@memo/api-client';

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockClient: ClientResponse = {
  id: 'client-1',
  name: 'Анна Смирнова',
  phone: '+7 900 111-22-33',
  email: null,
  channel: 'phone',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  is_active: true,
};

const mockActivity: ActivityResponse = {
  id: 'act-1',
  master_id: 'master-1',
  service_id: 'svc-1',
  location_id: 'loc-1',
  start: '2024-06-15T10:00:00Z',
  duration: 120,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2024-06-15T10:00:00Z',
  updated_at: '2024-06-15T10:00:00Z',
  is_active: true,
  occupied: 2,
};

const mockService: ServiceResponse = {
  id: 'svc-1',
  title: 'Рисование акварелью',
  description: 'Мастер-класс',
  image_url: '',
  specialty: 'art',
  min_age: 6,
  max_age: 99,
  duration: 120,
  record_info: '',
  tariffs: [{ id: 't-1', service_id: 'svc-1', title: 'Стандарт', description: null, price: 2500 }],
  tags: [],
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockMaster: MasterResponse = {
  id: 'master-1',
  first_name: 'Мария',
  last_name: 'Иванова',
  color: '#E74C3C',
  position: 'artist',
  specialty: 'art',
  avatar_url: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockLocation: LocationResponse = {
  id: 'loc-1',
  name: 'Студия на Арбате',
  address: null,
  description: null,
  capacity: 12,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockRecord: RecordResponse = {
  id: 'rec-1',
  activity_id: 'act-1',
  client_id: 'client-1',
  status: 'waiting',
  seats: 2,
  comment: null,
  created_at: '2024-06-15T10:00:00Z',
  updated_at: '2024-06-15T10:00:00Z',
  is_active: true,
  visits: [
    {
      id: 'vis-1',
      record_id: 'rec-1',
      visitor_id: 'v-1',
      price: 2500,
      status: 'active',
      created_at: '2024-06-15T10:00:00Z',
      updated_at: '2024-06-15T10:00:00Z',
      is_active: true,
    },
  ],
};

const mockPayment: PaymentResponse = {
  id: 'pay-1',
  record_id: 'rec-1',
  amount: 2500,
  method: 'card',
  created_at: '2024-06-15T10:00:00Z',
  updated_at: '2024-06-15T10:00:00Z',
  is_active: true,
};

// ─── Mutable mock context ───────────────────────────────────────────────────

let mockContextValue: RecordsContextType = {
  records: [mockRecord],
  clients: new Map([['client-1', mockClient]]),
  payments: new Map([['rec-1', [mockPayment]]]),
  activities: new Map([['act-1', mockActivity]]),
  masters: new Map([['master-1', mockMaster]]),
  services: new Map([['svc-1', mockService]]),
  locations: new Map([['loc-1', mockLocation]]),
  loading: false,
  error: null,
};

vi.mock('@/contexts/RecordsContext', () => ({
  useRecords: () => mockContextValue,
}));

import { RecordsTable } from '../app/(main)/records/components/RecordsTable';

const filters = {
  dateFrom: '',
  dateTo: '',
  locationId: '',
  serviceId: '',
  masterId: '',
  status: '',
};

describe('RecordsTable', () => {
  beforeEach(() => {
    // Reset to default context
    mockContextValue = {
      records: [mockRecord],
      clients: new Map([['client-1', mockClient]]),
      payments: new Map([['rec-1', [mockPayment]]]),
      activities: new Map([['act-1', mockActivity]]),
      masters: new Map([['master-1', mockMaster]]),
      services: new Map([['svc-1', mockService]]),
      locations: new Map([['loc-1', mockLocation]]),
      loading: false,
      error: null,
    };
  });

  it('renders client name from context', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
  });

  it('renders service title from context', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('Рисование акварелью')).toBeTruthy();
  });

  it('renders master color dot', () => {
    const { container } = render(<RecordsTable filters={filters} />);
    const dot = container.querySelector('[title="Мария"]');
    expect(dot).toBeTruthy();
  });

  it('renders location name from context', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('Студия на Арбате')).toBeTruthy();
  });

  it('shows total price from visits', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('2 500₽')).toBeTruthy();
  });

  it('shows payment status when fully paid', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('✓ Оплачено')).toBeTruthy();
  });

  it('shows empty state when no records', () => {
    mockContextValue = {
      ...mockContextValue,
      records: [],
    };
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('Записи не найдены')).toBeTruthy();
  });

  it('renders client name from client_id lookup', () => {
    // Record with known client_id should show client name
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
  });

  it('shows dash when record has no client_id', () => {
    // Record without client_id should show '—' as fallback
    const recordNoClient: RecordResponse = {
      ...mockRecord,
      id: 'rec-no-client',
      client_id: null,
    };
    mockContextValue = {
      ...mockContextValue,
      records: [recordNoClient],
    };
    render(<RecordsTable filters={filters} />);
    // The client column should show '—' (em dash) when client_id is null
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows dash when client_id not found in clients map', () => {
    // Record with client_id that doesn't exist in the clients map
    const recordUnknownClient: RecordResponse = {
      ...mockRecord,
      id: 'rec-unknown-client',
      client_id: 'nonexistent-client',
    };
    mockContextValue = {
      ...mockContextValue,
      records: [recordUnknownClient],
    };
    render(<RecordsTable filters={filters} />);
    // Should show '—' when client is not in the map
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });

  it('renders multiple records with mixed client_id presence', () => {
    const recordNoClient: RecordResponse = {
      ...mockRecord,
      id: 'rec-no-client',
      client_id: null,
    };
    mockContextValue = {
      ...mockContextValue,
      records: [mockRecord, recordNoClient],
    };
    render(<RecordsTable filters={filters} />);
    // Should show the known client name
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
    // Should show dash for the record without client_id
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });
});
