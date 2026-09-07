/**
 * Custom render function that wraps components with all context providers.
 *
 * Usage:
 * ```tsx
 * import { renderWithProviders } from './helpers/renderWithProviders';
 * renderWithProviders(<MyComponent />);
 * ```
 */
import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import type { RecordsContextType } from '@/contexts/RecordsContext';
import {
  createMockRecordsContext,
  createMockUIContext,
  createMockScheduleData,
  createMockScheduleView,
  createMockGridSettings,
} from './mockContexts';

// ─── Setup mock modules ──────────────────────────────────────────────────
// These mocks are registered once; individual tests can override values
// by calling vi.mocked(useScheduleData).mockReturnValue(...) in beforeEach.

vi.mock('@/contexts/RecordsContext', () => ({
  useRecords: vi.fn(() => createMockRecordsContext()),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => createMockUIContext()),
}));

// Schedule split contexts (GH #141)
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(() => createMockScheduleData()),
}));

vi.mock('@/contexts/schedule/ScheduleViewContext', () => ({
  useScheduleView: vi.fn(() => createMockScheduleView()),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => createMockGridSettings()),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useMutationState: vi.fn(() => []),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    fetchQuery: vi.fn(),
  })),
}));

// Re-import mocked hooks so tests can override via mockReturnValue
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';

export {
  useRecords,
  useUI,
  useScheduleData,
  useScheduleView,
  useGridSettings,
};

// ─── AllProviders wrapper ────────────────────────────────────────────────

interface AllProvidersProps {
  children: React.ReactNode;
}

function AllProviders({ children }: AllProvidersProps): ReactElement {
  return <>{children}</>;
}

// ─── Custom render ───────────────────────────────────────────────────────

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {}

export function renderWithProviders(
  ui: ReactElement,
  _options?: CustomRenderOptions,
) {
  return render(ui, { wrapper: AllProviders });
}
