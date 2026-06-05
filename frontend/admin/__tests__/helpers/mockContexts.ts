/**
 * Context mock factory functions for frontend tests.
 *
 * Usage in a test file:
 * ```ts
 * import { createMockScheduleContext } from './helpers/mockContexts';
 * vi.mock('@/contexts/ScheduleContext', () => ({
 *   useSchedule: vi.fn(() => createMockScheduleContext({ artists: myArtists })),
 * }));
 * ```
 */
import { vi } from 'vitest';
import type { ScheduleContextType } from '@/contexts/ScheduleContext';
import type { RecordsContextType } from '@/contexts/RecordsContext';
import { mockArtists, mockServices, mockLocations } from './mockData';

// ─── ScheduleContext ──────────────────────────────────────────────────────

type ScheduleOverrides = Partial<ScheduleContextType>;

export function createMockScheduleContext(
  overrides?: ScheduleOverrides,
): ScheduleContextType {
  return {
    artists: mockArtists,
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
    filterMasterId: null,
    filterLocationId: null,
    setFilterMasterId: vi.fn(),
    setFilterLocationId: vi.fn(),
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
    clients: new Map(),
    payments: new Map(),
    activities: new Map(),
    masters: new Map(),
    services: new Map(),
    locations: new Map(),
    loading: false,
    error: null,
    ...overrides,
  };
}

// ─── UIContext ────────────────────────────────────────────────────────────

interface UIContextMock {
  deleteMode: boolean;
  toggleDeleteMode: () => void;
  toasts: Array<{ id: string; message: string; undo?: () => void }>;
  showToast: (message: string, undo?: () => void) => void;
  hideToast: (id: string) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  rightPanelCollapsed: boolean;
  toggleRightPanel: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

type UIOverrides = Partial<UIContextMock>;

export function createMockUIContext(overrides?: UIOverrides): UIContextMock {
  return {
    deleteMode: false,
    toggleDeleteMode: vi.fn(),
    toasts: [],
    showToast: vi.fn(),
    hideToast: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    rightPanelCollapsed: true,
    toggleRightPanel: vi.fn(),
    theme: 'light' as const,
    toggleTheme: vi.fn(),
    ...overrides,
  };
}
