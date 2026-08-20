/**
 * Context mock factory functions for frontend tests.
 *
 * Usage in a test file:
 * ```ts
 * import { createMockScheduleContext } from './helpers/mockContexts';
 * vi.mock('@/contexts/ScheduleContext', () => ({
 *   useSchedule: vi.fn(() => createMockScheduleContext({ masters: myMasters })),
 * }));
 * ```
 */
import { vi } from 'vitest';
import type { ScheduleContextType } from '@/contexts/ScheduleContext';
import type { RecordsContextType } from '@/contexts/RecordsContext';
import type { ClientsContextType } from '@/contexts/ClientsContext';
import { mockMasters, mockServices, mockLocations } from './mockData';

// ─── ScheduleContext ──────────────────────────────────────────────────────

type ScheduleOverrides = Partial<ScheduleContextType>;

export function createMockScheduleContext(
  overrides?: ScheduleOverrides,
): ScheduleContextType {
  return {
    masters: mockMasters,
    services: mockServices,
    servicesRaw: [],
    locations: mockLocations,
    activities: [],
    scheduleIndex: {
      byId: new Map(),
      byDate: new Map(),
      byMasterId: new Map(),
      byLocation: { all: { byDate: new Map(), byServiceId: new Map() } },
    },
    currentWeek: new Date('2026-06-01'),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setCurrentWeek: vi.fn(),
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    setStamp: vi.fn(),
    copyLastWeek: vi.fn(),
    loading: false,
    error: null,
    filterMasterIds: [],
    filterLocationIds: [],
    setFilterMasterIds: vi.fn(),
    setFilterLocationIds: vi.fn(),
    viewMode: 'week',
    setViewMode: vi.fn(),
    selectedDay: new Date(),
    setSelectedDay: vi.fn(),
    columnMode: 'masters',
    setColumnMode: vi.fn(),
    cellHeight: 50,
    setCellHeight: vi.fn(),
    gridFrequency: 30,
    setGridFrequency: vi.fn(),
    workingHoursStart: 9,
    setWorkingHoursStart: vi.fn(),
    workingHoursEnd: 21,
    setWorkingHoursEnd: vi.fn(),
    prevPeriod: vi.fn(),
    nextPeriod: vi.fn(),
    ...overrides,
  };
}

// ─── RecordsContext ──────────────────────────────────────────────────────

type RecordsOverrides = Partial<RecordsContextType>;

export function createMockRecordsContext(
  overrides?: RecordsOverrides,
): RecordsContextType {
  return {
    records: [],
    total: 0,
    page: 1,
    perPage: 10,
    filters: { locationId: '', serviceId: '', masterId: '', status: '' },
    sortBy: 'date',
    sortOrder: 'asc',
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setFilters: vi.fn(),
    setSort: vi.fn(),
    resetFilters: vi.fn(),
    clients: new Map(),
    payments: new Map(),
    activities: new Map(),
    masters: new Map(),
    services: new Map(),
    locations: new Map(),
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

// ─── UIContext ────────────────────────────────────────────────────────────

interface UIContextMock {
  deleteMode: boolean;
  toggleDeleteMode: () => void;
  toasts: Array<{ id: string; kind: 'info' | 'success' | 'error'; message: string; undo?: () => void }>;
  showToast: (message: string, kindOrUndo?: 'info' | 'success' | 'error' | (() => void), undo?: () => void) => void;
  hideToast: (id: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  rightPanelCollapsed: boolean;
  toggleRightPanel: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

type ToastOverride = { id: string; kind?: 'info' | 'success' | 'error'; message: string; undo?: () => void };

type UIOverrides = Partial<Omit<UIContextMock, 'toasts'>> & { toasts?: ToastOverride[] };

export function createMockUIContext(overrides?: UIOverrides): UIContextMock {
  const { toasts: rawToasts, ...rest } = overrides ?? {};
  return {
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: rawToasts?.map(t => ({ ...t, kind: t.kind ?? ('info' as const) })) ?? [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
    ...rest,
  };
}

// ─── ClientsContext ─────────────────────────────────────────────────────

type ClientsOverrides = Partial<ClientsContextType>;

export function createMockClientsContext(
  overrides?: ClientsOverrides,
): ClientsContextType {
  const base: ClientsContextType = {
    items: [],
    clients: [],
    total: 0,
    page: 1,
    perPage: 20,
    filters: {
      search: '',
      status: 'active',
      created_from: '',
      created_to: '',
      updated_from: '',
      updated_to: '',
      min_records: null,
      max_records: null,
      min_paid: null,
      max_paid: null,
      missed_from: null,
      missed_to: null,
    },
    sortBy: 'name',
    sortOrder: 'asc',
    isLoading: false,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setFilters: vi.fn(),
    setSort: vi.fn(),
    resetFilters: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
    patchClient: vi.fn(),
    deleteClient: vi.fn(),
    archiveClient: vi.fn(),
    restoreClient: vi.fn(),
    resolveDeleteClient: vi.fn(),
    dependencies: null,
  };
  // If the test passes a `clients` override (or `items`), mirror it into the
  // other alias so the migrated DataTable and pre-#139 consumers both see it.
  const merged = { ...base, ...overrides };
  if (overrides?.clients !== undefined) merged.items = overrides.clients;
  else if (overrides?.items !== undefined) merged.clients = overrides.items;
  return merged;
}
