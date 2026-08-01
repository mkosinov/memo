import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { RecordsContextType } from '../contexts/RecordsContext';
import type {
  RecordResponse,
  ClientWithStats,
  ActivityResponse,
  ServiceResponse,
  MasterResponse,
  LocationResponse,
  PaymentResponse,
} from '@memo/api-client';
import { mockPayment } from './helpers/mockData';

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockClient: ClientWithStats = {
  id: 'client-1',
  name: 'Анна Смирнова',
  phone: '+7 900 111-22-33',
  email: null,
  channel: 'phone',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  is_active: true,
  records_count: 5,
  last_record: '2024-06-15',
  total_paid: 2500,
  missed_records: 0,
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
  anonym_visits: 0,
  comment: null,
  custom_price: null,
  created_at: '2024-06-15T10:00:00Z',
  updated_at: '2024-06-15T10:00:00Z',
  visits: [
    {
      id: 'vis-1',
      record_id: 'rec-1',
      visitor_id: 'v-1',
      price: 2500,
      custom_price: null,
      status: 'active',
      created_at: '2024-06-15T10:00:00Z',
      updated_at: '2024-06-15T10:00:00Z',
    },
  ],
};

// ─── Mutable mock context ───────────────────────────────────────────────────

let mockContextValue: RecordsContextType = {
  records: [mockRecord],
  clients: new Map([['client-1', mockClient]]),
  payments: new Map([['rec-1', 2500]]),
  activities: new Map([['act-1', mockActivity]]),
  masters: new Map([['master-1', mockMaster]]),
  services: new Map([['svc-1', mockService]]),
  locations: new Map([['loc-1', mockLocation]]),
  loading: false,
  error: null,
  refetch: vi.fn(),
};

vi.mock('@/contexts/RecordsContext', () => ({
  useRecords: () => mockContextValue,
}));

// ─── Mock useRecordData (per-record payments in detail panel) ───────────────

let mockRecordPayments: PaymentResponse[] = [mockPayment];

vi.mock('@/hooks/useRecordData', () => ({
  useRecordData: () => ({
    recordData: null,
    record: null,
    visitors: [],
    activity: undefined,
    services: [],
    masters: [],
    locations: [],
    payments: mockRecordPayments,
    visitorsMap: new Map(),
    tariffs: [],
    isLoading: false,
    status: 'waiting' as const,
  }),
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
    localStorage.clear();
    mockRecordPayments = [mockPayment];
    // Reset to default context
    mockContextValue = {
      records: [mockRecord],
      clients: new Map([['client-1', mockClient]]),
      payments: new Map([['rec-1', 2500]]),
      activities: new Map([['act-1', mockActivity]]),
      masters: new Map([['master-1', mockMaster]]),
      services: new Map([['svc-1', mockService]]),
      locations: new Map([['loc-1', mockLocation]]),
      loading: false,
      error: null,
      refetch: vi.fn(),
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
    const dot = container.querySelector('[title="Иванова Мария"]');
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

  it('record with no entry in totals map renders Не оплачено', () => {
    mockContextValue = {
      ...mockContextValue,
      payments: new Map(),
    };
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText('Не оплачено')).toBeTruthy();
  });

  it('sorts by payment status: paid, then partial, then unpaid', () => {
    const recordPaid: RecordResponse = {
      ...mockRecord,
      id: 'rec-paid',
      client_id: null,
    };
    const recordPartial: RecordResponse = {
      ...mockRecord,
      id: 'rec-partial',
      client_id: null,
    };
    const recordUnpaid: RecordResponse = {
      ...mockRecord,
      id: 'rec-unpaid',
      client_id: null,
    };
    mockContextValue = {
      ...mockContextValue,
      records: [recordUnpaid, recordPartial, recordPaid],
      payments: new Map([
        ['rec-paid', 2500],
        ['rec-partial', 1000],
      ]),
    };
    render(<RecordsTable filters={filters} />);

    // Click "Оплата" header to sort ascending
    fireEvent.click(screen.getByText(/Оплата/));

    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('✓ Оплачено');
    expect(rows[1].textContent).toContain('Частично');
    expect(rows[2].textContent).toContain('Не оплачено');
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

  // ─── Detail panel payments (per-payment list via useRecordData) ──────────

  it('detail panel lists payments with amount and method', () => {
    render(<RecordsTable filters={filters} />);
    fireEvent.click(screen.getByText('Анна Смирнова').closest('tr')!);
    expect(screen.getByText('Карта')).toBeInTheDocument();
    expect(screen.getByText('3 500₽')).toBeInTheDocument();
  });

  it('detail panel shows Нет платежей when record has no payments', () => {
    mockRecordPayments = [];
    render(<RecordsTable filters={filters} />);
    fireEvent.click(screen.getByText('Анна Смирнова').closest('tr')!);
    expect(screen.getByText('Нет платежей')).toBeInTheDocument();
  });

  // ─── Column picker ──────────────────────────────────────────────────────

  it('renders column picker gear button', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows all default column headers', () => {
    render(<RecordsTable filters={filters} />);
    expect(screen.getByText(/Дата \/ Время/)).toBeTruthy();
    expect(screen.getByText(/Клиент/)).toBeTruthy();
    expect(screen.getByText(/Гостей/)).toBeTruthy();
    expect(screen.getByText(/Услуга/)).toBeTruthy();
    expect(screen.getByText(/Мастер/)).toBeTruthy();
    expect(screen.getByText(/Локация/)).toBeTruthy();
    expect(screen.getByText(/Статус/)).toBeTruthy();
    expect(screen.getByText(/Сумма/)).toBeTruthy();
    expect(screen.getByText(/Оплата/)).toBeTruthy();
  });

  it('hides column when unchecked via ColumnPicker', () => {
    render(<RecordsTable filters={filters} />);

    // Open picker
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Uncheck "Клиент"
    fireEvent.click(screen.getByLabelText('Клиент'));

    // The "Клиент" th should be gone
    const thead = document.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Клиент/);
  });
});
