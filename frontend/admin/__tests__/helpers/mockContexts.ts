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
import type { ClientFilters } from '@/contexts/ClientsContext';
import { defaultFilters as defaultClientFilters } from '@/contexts/ClientsContext';
import type {
  PagedListContextValue,
  PagedListFiltersState,
} from '@/contexts/createPagedListContext';
import type { PhotosContextType } from '@/contexts/PhotosContext';
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';
import type { ScheduleViewContextType } from '@/contexts/schedule/ScheduleViewContext';
import type { GridSettingsContextType } from '@/contexts/schedule/GridSettingsContext';
import type { ClientWithStats } from '@memo/api-client';
import { mockMasters, mockServices, mockLocations } from './mockData';

// ─── ScheduleContext ──────────────────────────────────────────────────────

type ScheduleOverrides = Partial<ScheduleContextType>;

export function createMockScheduleContext(
  overrides?: ScheduleOverrides,
): ScheduleContextType {
  return {
    masters: mockMasters,
    services: mockServices,
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
    gridStartMinutes: 540,
    gridEndMinutes: 1260,
    prevPeriod: vi.fn(),
    nextPeriod: vi.fn(),
    ...overrides,
  };
}

// ─── Schedule split contexts (GH #141) ────────────────────────────────────

export function createMockScheduleData(
  overrides?: Partial<ScheduleDataContextType>,
): ScheduleDataContextType {
  return {
    masters: mockMasters,
    services: mockServices,
    locations: mockLocations,
    activities: [],
    scheduleIndex: {
      byId: new Map(),
      byDate: new Map(),
      byMasterId: new Map(),
      byLocation: { all: { byDate: new Map(), byServiceId: new Map() } },
    },
    loading: false,
    error: null,
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    copyLastWeek: vi.fn(),
    gridStartMinutes: 540,
    gridEndMinutes: 1260,
    ...overrides,
  };
}

export function createMockScheduleView(
  overrides?: Partial<ScheduleViewContextType>,
): ScheduleViewContextType {
  return {
    viewMode: 'week',
    setViewMode: vi.fn(),
    selectedDay: new Date(),
    setSelectedDay: vi.fn(),
    columnMode: 'masters',
    setColumnMode: vi.fn(),
    filterMasterIds: [],
    filterLocationIds: [],
    setFilterMasterIds: vi.fn(),
    setFilterLocationIds: vi.fn(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setStamp: vi.fn(),
    currentWeek: new Date('2026-06-01'),
    setCurrentWeek: vi.fn(),
    prevPeriod: vi.fn(),
    nextPeriod: vi.fn(),
    ...overrides,
  };
}

export function createMockGridSettings(
  overrides?: Partial<GridSettingsContextType>,
): GridSettingsContextType {
  return {
    cellHeight: 50,
    setCellHeight: vi.fn(),
    gridFrequency: 30,
    setGridFrequency: vi.fn(),
    workingHoursStart: 9,
    setWorkingHoursStart: vi.fn(),
    workingHoursEnd: 21,
    setWorkingHoursEnd: vi.fn(),
    ...overrides,
  };
}

// ─── RecordsContext ──────────────────────────────────────────────────────

type RecordsOverrides = Partial<RecordsContextType>;

export function createMockRecordsContext(
  overrides?: RecordsOverrides,
): RecordsContextType {
  const base: RecordsContextType = {
    items: [],
    records: [],
    total: 0,
    page: 1,
    perPage: 10,
    filters: { locationId: '', serviceId: '', masterId: '', status: '', search: '' },
    sortBy: 'date',
    sortOrder: 'asc',
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setFilters: vi.fn(),
    setSort: vi.fn(),
    resetFilters: vi.fn(),
    isLoading: false,
    loading: false,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
  // If the test passes a `records` override (or `items`), mirror it into the
  // other alias so the migrated DataTable and pre-#139 consumers both see it.
  const merged = { ...base, ...overrides };
  if (overrides?.records !== undefined) merged.items = overrides.records;
  else if (overrides?.items !== undefined) merged.records = overrides.items;
  return merged;
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

// ─── ClientsTable state (GH #140 — factory paged-list value) ──────────────

type ClientsTableState = PagedListContextValue<ClientWithStats> &
  PagedListFiltersState<ClientFilters>;
type ClientsTableOverrides = Partial<ClientsTableState>;

/**
 * Fixture for `useClientsTable()` consumers (GH #140). Returns the full
 * factory `PagedListContextValue<ClientWithStats> & PagedListFiltersState<ClientFilters>`
 * with `vi.fn()` setters/refetch; pass any field via `overrides`.
 */
export function createMockClientsTableState(
  overrides: ClientsTableOverrides = {},
): ClientsTableState {
  return {
    items: [],
    visibleItems: undefined,
    total: 0,
    page: 1,
    perPage: 20,
    sortBy: 'name',
    sortOrder: 'asc',
    status: 'active',
    isPending: false,
    isLoading: false,
    isFetching: false,
    error: null,
    search: '',
    filters: { ...defaultClientFilters },
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    setStatus: vi.fn(),
    setSearch: vi.fn(),
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

// ─── PhotosContext (GH #211 — server-driven photos list) ──────────────────

type PhotosOverrides = Partial<PhotosContextType>;

export function createMockPhotosContext(
  overrides?: PhotosOverrides,
): PhotosContextType {
  return {
    items: [],
    visibleItems: [],
    total: 0,
    page: 1,
    perPage: 10,
    sortBy: 'created_at',
    sortOrder: 'desc',
    search: '',
    filters: { tag_id: [] },
    isPending: false,
    isLoading: false,
    isFetching: false,
    error: null,
    servicesMap: new Map(),
    locationsMap: new Map(),
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    setSearch: vi.fn(),
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}
