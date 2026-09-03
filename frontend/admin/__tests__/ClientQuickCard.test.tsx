import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ActivityResponse,
  LocationResponse,
  RecordResponse,
  ServiceResponse,
  VisitResponse,
} from '@memo/api-client';
import { mockClient, mockLocationResponse } from './helpers/mockData';

// GH #213 §6.5: NO RecordsContext mock — the card renders without any
// RecordsProvider. `useRecords()` throws outside its provider, so a stray
// dependency on it fails every test here.

// ─── Mock api-client (modal fetches all of its own data, #191/#213) ────────

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getRecords: vi.fn(),
    getActivity: vi.fn(),
    getPaymentTotals: vi.fn(),
    getClientById: vi.fn(),
    getAllServices: vi.fn(),
    getAllLocations: vi.fn(),
  };
});

import {
  getRecords,
  getActivity,
  getPaymentTotals,
  getClientById,
  getAllServices,
  getAllLocations,
} from '@memo/api-client';
import { ClientQuickCard } from '../app/(main)/records/components/ClientQuickCard';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const service1: ServiceResponse = {
  id: 's1',
  title: 'Картина маслом',
  description: '',
  image_url: '',
  specialty: '',
  min_age: 12,
  max_age: 99,
  duration: 150,
  record_info: '',
  tariffs: [],
  tags: [],
  archived: false,
  created_at: '',
  updated_at: '',
};

const service2: ServiceResponse = {
  ...service1,
  id: 's2',
  title: 'Картина акрилом',
};

const location1: LocationResponse = { ...mockLocationResponse, id: 'loc-1', name: 'Альпика' };

const activity1: ActivityResponse = {
  id: 'a1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'loc-1',
  start: '2026-05-10T14:00:00Z',
  duration: 150,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '',
  updated_at: '',
  occupied: 3,
};

const activity2: ActivityResponse = {
  ...activity1,
  id: 'a2',
  service_id: 's2',
  start: '2026-04-20T16:30:00Z',
};

const activitiesById: Record<string, ActivityResponse> = { a1: activity1, a2: activity2 };

function makeVisit(id: string, recordId: string, price: number): VisitResponse {
  return {
    id,
    record_id: recordId,
    visitor_id: null,
    tariff_id: null,
    price,
    custom_price: null,
    status: 'waiting',
    created_at: '',
    updated_at: '',
  };
}

const record1: RecordResponse = {
  id: 'r1',
  activity_id: 'a1',
  client_id: 'c1',
  status: 'visited',
  seats: 2,
  anonym_visits: 0,
  comment: null,
  custom_price: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  visits: [makeVisit('v1', 'r1', 3500), makeVisit('v2', 'r1', 2500)],
};

const record2: RecordResponse = {
  ...record1,
  id: 'r2',
  activity_id: 'a2',
  status: 'confirmed',
  visits: [makeVisit('v3', 'r2', 3000)],
};

const record3: RecordResponse = {
  ...record1,
  id: 'r3',
  activity_id: 'a1',
  status: 'cancelled',
  visits: [makeVisit('v4', 'r3', 2000)],
};

const record4: RecordResponse = {
  ...record1,
  id: 'r4',
  activity_id: 'a2',
  status: 'confirmed',
  visits: [makeVisit('v5', 'r4', 1500)],
};

const clientRecords = [record1, record2, record3, record4];

// ─── Helpers ───────────────────────────────────────────────────────────────

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientQuickCard clientId="c1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('records-folder ClientQuickCard — re-homed off RecordsContext (#213)', () => {
  beforeEach(() => {
    // Header — per-id client query (key shared with ActivityDetailsModal,
    // TanStack dedupes).
    vi.mocked(getClientById).mockResolvedValue(mockClient);
    // Records-list labels — shared useServices()/useLocations() canonical keys.
    vi.mocked(getAllServices).mockResolvedValue([service1, service2]);
    vi.mocked(getAllLocations).mockResolvedValue([location1]);
    // Own queries (unchanged from #191).
    vi.mocked(getRecords).mockResolvedValue({
      items: clientRecords,
      total: clientRecords.length,
      page: 1,
      per_page: 100,
    });
    vi.mocked(getActivity).mockImplementation((id: string) =>
      Promise.resolve(activitiesById[id]),
    );
    // r4 has no payments → no entry in the totals map (paid 0 → Не оплачено)
    vi.mocked(getPaymentTotals).mockResolvedValue({ r1: 6000, r2: 1000, r3: 500 });
  });

  it('renders the client header from its own by-id query', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText(/Анна Иванова/)).toBeInTheDocument();
    });
    expect(screen.getByText('+7 (900) 123-45-67')).toBeInTheDocument();

    expect(vi.mocked(getClientById)).toHaveBeenCalledWith('c1');
  });

  it('shows a loading state while the client query is pending', () => {
    vi.mocked(getClientById).mockImplementation(() => new Promise(() => {}));
    renderModal();

    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
    expect(screen.queryByText('Клиент не найден')).not.toBeInTheDocument();
  });

  it('shows "Клиент не найден" when the by-id query fails', async () => {
    vi.mocked(getClientById).mockRejectedValue(new Error('404'));
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Клиент не найден')).toBeInTheDocument();
    });
  });

  it('renders service/location labels from the shared hooks', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getAllByText('Картина маслом')).toHaveLength(2);
    });
    expect(screen.getAllByText('Картина акрилом')).toHaveLength(2);
    expect(screen.getAllByText(/· Альпика/).length).toBeGreaterThanOrEqual(2);
  });

  it('fetches the client records via its own query (not the context page)', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getAllByText('Картина маслом')).toHaveLength(2);
    });

    expect(vi.mocked(getRecords)).toHaveBeenCalledWith({ client_id: 'c1', per_page: 100 });
  });

  it('renders payment badges from its own payment-totals query', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Оплачено')).toBeInTheDocument();
    });
    // r2 (1000/3000) and r3 (500/2000) are both partially paid
    expect(screen.getAllByText(/Частично/)).toHaveLength(2);
    expect(screen.getByText('Не оплачено')).toBeInTheDocument();

    expect(vi.mocked(getPaymentTotals)).toHaveBeenCalledWith(['r1', 'r2', 'r3', 'r4']);
  });

  it('Потрачено sums paid amounts over non-cancelled records only', async () => {
    renderModal();

    // r1 (visited, paid 6000) + r2 (confirmed, paid 1000) = 7000;
    // r3 is cancelled — its 500 must be excluded.
    await waitFor(() => {
      expect(screen.getByText(/7\D?000₽/)).toBeInTheDocument();
    });
  });

  it('resolves activity details per record (time and location)', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getAllByText(/14:00 · Альпика/)).toHaveLength(2);
    });
    expect(screen.getAllByText(/16:30 · Альпика/)).toHaveLength(2);
  });
});
