import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type { ServiceResponse } from '@memo/api-client';

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockService1: ServiceResponse = {
  id: 'svc-1',
  title: 'Картина маслом',
  description: 'Мастер-класс по рисованию маслом',
  image_url: '',
  specialty: 'Живопись',
  min_age: 12,
  max_age: 18,
  duration: 150,
  record_info: '',
  material_hint: 'Фартук',
  tariffs: [
    { id: 't-1', service_id: 'svc-1', title: 'Взрослый', description: null, price: 3500 },
    { id: 't-2', service_id: 'svc-1', title: 'Детский', description: null, price: 2500 },
  ],
  tags: [{ id: 'tag-1', tag: 'масло' }],
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockService2: ServiceResponse = {
  id: 'svc-2',
  title: 'Картина акрилом',
  description: 'Акриловая живопись',
  image_url: '',
  specialty: 'Графика',
  min_age: 6,
  max_age: 14,
  duration: 120,
  record_info: '',
  material_hint: null,
  tariffs: [
    { id: 't-3', service_id: 'svc-2', title: 'Взрослый', description: null, price: 2800 },
  ],
  tags: [{ id: 'tag-2', tag: 'акрил' }],
  is_active: true,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

const mockService3: ServiceResponse = {
  id: 'svc-3',
  title: 'Ручная лепка',
  description: 'Лепка из глины',
  image_url: '',
  specialty: 'Керамика',
  min_age: 5,
  max_age: 12,
  duration: 90,
  record_info: '',
  material_hint: null,
  tariffs: [],
  tags: [],
  is_active: false,
  created_at: '2024-03-01T00:00:00Z',
  updated_at: '2024-03-01T00:00:00Z',
};

const TEST_SERVICES: ServiceResponse[] = [
  mockService1,
  mockService2,
  mockService3,
];

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockShowToast = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  // `keepPreviousData` is a sentinel symbol in real react-query; the component
  // imports it for `placeholderData`. Provide a stable sentinel so the import
  // resolves. The mocked `useQuery` ignores `placeholderData` anyway.
  keepPreviousData: Symbol('keepPreviousData'),
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

// Spy on getServices (preserve other api-client exports via importOriginal)
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getServices: vi.fn() };
});

vi.mock('@/hooks/useServicesMutations', () => ({
  useCreateService: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useUpdateService: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  usePatchService: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useDeleteService: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    showToast: mockShowToast,
    deleteMode: false,
    toasts: [],
  }),
}));

import { useQuery } from '@tanstack/react-query';
import { getServices } from '@memo/api-client';

const mockUseQuery = vi.mocked(useQuery);
const mockGetServices = vi.mocked(getServices);

import { ServicesTable } from '../app/(main)/services/components/ServicesTable';

// ─── Helpers ───────────────────────────────────────────────────────────────

// Simulate the server's archive filtering per `ListParams.status`. The mock
// `useQuery` discards the `queryFn`'s resolved value and returns the injected
// `data` synchronously, so we must inject already-filtered lists matching the
// status the component requested. This mirrors how the real backend responds.
const ACTIVE_SERVICES = TEST_SERVICES.filter((s) => s.is_active);
const ARCHIVED_SERVICES = TEST_SERVICES.filter((s) => !s.is_active);

function setupQuery(services: ServiceResponse[] = ACTIVE_SERVICES, isLoading = false) {
  // Resolve the getServices spy with the supplied list so the component's
  // `queryFn` (which calls `getServices(...).then(r => r.items)`) settles.
  mockGetServices.mockResolvedValue({
    items: services,
    total: services.length,
    page: 1,
    per_page: 100,
  });
  // Drive `useQuery` through `mockImplementation` so the real `queryFn` is
  // invoked on every render — this is what lets the getServices spy record
  // the call args (including the current `status`). The resolved promise is
  // discarded; we inject the static `data` synchronously to keep these unit
  // tests independent of react-query's async fetch machinery.
  mockUseQuery.mockImplementation((((opts: { queryFn?: () => unknown }) => {
    try {
      void opts?.queryFn?.();
    } catch {
      // queryFn errors don't affect the injected static data
    }
    return {
      data: services,
      isLoading,
      error: null,
      refetch: vi.fn(),
      isSuccess: true,
      isError: false,
      isPending: false,
      isFetching: false,
      status: 'success',
      fetchStatus: 'idle',
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
      failureCount: 0,
      failureReason: null,
      errorUpdateCount: 0,
      isFetched: true,
      isFetchedAfterMount: true,
      isInitialLoading: false,
      isLoadingError: false,
      isPlaceholderData: false,
      isRefetchError: false,
      isStale: false,
      isRefetching: false,
      isLoadingSuccess: true,
      remove: vi.fn(),
      promise: Promise.resolve({ data: services }),
    };
  }) as unknown) as typeof useQuery);
  return mockGetServices;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ServicesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupQuery();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders active service titles by default', () => {
    render(<ServicesTable />);
    expect(screen.getByText('Картина маслом')).toBeTruthy();
    expect(screen.getByText('Картина акрилом')).toBeTruthy();
    // Archived service is filtered out server-side (status: 'active' default)
    expect(screen.queryByText('Ручная лепка')).toBeNull();
    // Default server-side filter requests status: 'active' (GH #195)
    expect(mockGetServices).toHaveBeenCalledWith({
      per_page: 100,
      status: 'active',
    });
  });

  it('renders all services when status filter is "all"', () => {
    // Simulate server returning all services (active + archived) for status='all'
    setupQuery(TEST_SERVICES);
    render(<ServicesTable />);
    const statusSelect = screen.getByLabelText(/Фильтр по статусу/);
    fireEvent.change(statusSelect, { target: { value: 'all' } });
    expect(screen.getByText('Картина маслом')).toBeTruthy();
    expect(screen.getByText('Картина акрилом')).toBeTruthy();
    expect(screen.getByText('Ручная лепка')).toBeTruthy();
    expect(mockGetServices).toHaveBeenCalledWith({
      per_page: 100,
      status: 'all',
    });
  });

  it('renders duration formatted as minutes', () => {
    render(<ServicesTable />);
    expect(screen.getByText('150 мин')).toBeTruthy();
    expect(screen.getByText('120 мин')).toBeTruthy();
  });

  it('renders age range', () => {
    render(<ServicesTable />);
    expect(screen.getByText('12–18')).toBeTruthy();
    expect(screen.getByText('6–14')).toBeTruthy();
  });

  it('renders tariff count and min price', () => {
    render(<ServicesTable />);
    expect(screen.getByText('2 тарифа')).toBeTruthy();
    expect(screen.getByText('от 2 500₽')).toBeTruthy();
    expect(screen.getByText('1 тариф')).toBeTruthy();
  });

  it('renders material hint', () => {
    render(<ServicesTable />);
    expect(screen.getByText('Фартук')).toBeTruthy();
  });

  it('shows "—" for services without material hint', () => {
    render(<ServicesTable />);
    // Картина акрилом has material_hint: null — shows "—"
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts by title when clicking header (asc)', () => {
    render(<ServicesTable />);
    const titleHeader = screen.getByText(/Название/);
    fireEvent.click(titleHeader);
    // Ascending: Картина акрилом before Картина маслом
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Картина акрилом')).toBeTruthy();
    expect(within(rows[2]).getByText('Картина маслом')).toBeTruthy();
  });

  it('sorts by title when clicking header (desc)', () => {
    render(<ServicesTable />);
    const titleHeader = screen.getByText(/Название/);
    // Click twice: asc → desc
    fireEvent.click(titleHeader);
    fireEvent.click(titleHeader);
    // Descending: Картина маслом before Картина акрилом
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Картина маслом')).toBeTruthy();
    expect(within(rows[2]).getByText('Картина акрилом')).toBeTruthy();
  });

  it('filters by search text', () => {
    render(<ServicesTable />);
    const searchInput = screen.getByLabelText(/Поиск по названию/);
    fireEvent.change(searchInput, { target: { value: 'масл' } });
    expect(screen.getByText('Картина маслом')).toBeTruthy();
    expect(screen.queryByText('Картина акрилом')).toBeNull();
  });

  it('filters by status (archived)', () => {
    // Simulate server returning only archived services for status='archived'
    setupQuery(ARCHIVED_SERVICES);
    render(<ServicesTable />);
    const statusSelect = screen.getByLabelText(/Фильтр по статусу/);
    // Switch to archived — request now carries status: 'archived' (GH #195)
    fireEvent.change(statusSelect, { target: { value: 'archived' } });
    expect(screen.getByText('Ручная лепка')).toBeTruthy();
    expect(mockGetServices).toHaveBeenCalledWith({
      per_page: 100,
      status: 'archived',
    });
  });

  it('shows empty state when no services match', () => {
    setupQuery([]);
    render(<ServicesTable />);
    expect(screen.getByText('Услуги не найдены')).toBeTruthy();
  });

  it('opens edit modal on row click', () => {
    render(<ServicesTable />);
    const row = screen.getByText('Картина маслом').closest('tr')!;
    fireEvent.click(row);
    expect(screen.getByText('Редактировать услугу')).toBeTruthy();
  });

  // ─── Create functionality ────────────────────────────────────────────

  it('renders "Добавить услугу" button', () => {
    render(<ServicesTable />);
    expect(screen.getByText('+ Добавить услугу')).toBeTruthy();
  });

  it('opens create modal when "Добавить услугу" clicked', () => {
    render(<ServicesTable />);
    const addBtn = screen.getByText('+ Добавить услугу');
    fireEvent.click(addBtn);
    expect(screen.getByText('Новая услуга')).toBeTruthy();
  });

  it('opens create modal with empty title field', () => {
    render(<ServicesTable />);
    fireEvent.click(screen.getByText('+ Добавить услугу'));
    // Modal should be open with the "Новая услуга" title
    expect(screen.getByText('Новая услуга')).toBeTruthy();
    // The title input should be empty
    const titleInput = screen.getByPlaceholderText('Мастер-класс по рисованию');
    expect(titleInput).toHaveValue('');
  });

  // ─── Delete functionality ────────────────────────────────────────────

  it('shows "Удалить" option in action dropdown', () => {
    render(<ServicesTable />);
    // Open action menu for first service
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeTruthy();
  });

  it('calls deleteService when "Удалить" clicked and confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ServicesTable />);
    // Open action menu
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    // Click delete
    fireEvent.click(screen.getByText('Удалить'));
    expect(window.confirm).toHaveBeenCalledWith('Удалить услугу?');
    expect(mockMutateAsync).toHaveBeenCalled();
  });

  it('does not call deleteService when confirmation cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ServicesTable />);
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));
    expect(window.confirm).toHaveBeenCalledWith('Удалить услугу?');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});