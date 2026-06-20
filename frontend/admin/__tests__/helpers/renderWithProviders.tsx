/**
 * Custom render function that wraps components with all context providers.
 *
 * Usage:
 * ```tsx
 * import { renderWithProviders } from './helpers/renderWithProviders';
 * renderWithProviders(<MyComponent />, { useSchedule: { masters: myMasters } });
 * ```
 */
import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import type { ScheduleContextType } from '@/contexts/ScheduleContext';
import type { RecordsContextType } from '@/contexts/RecordsContext';
import {
  createMockScheduleContext,
  createMockRecordsContext,
  createMockUIContext,
} from './mockContexts';

// ─── Setup mock modules ──────────────────────────────────────────────────
// These mocks are registered once; individual tests can override values
// by calling vi.mocked(useSchedule).mockReturnValue(...) in beforeEach.

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: vi.fn(() => createMockScheduleContext()),
}));

vi.mock('@/contexts/RecordsContext', () => ({
  useRecords: vi.fn(() => createMockRecordsContext()),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => createMockUIContext()),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    fetchQuery: vi.fn(),
  })),
}));

// Re-import mocked hooks so tests can override via mockReturnValue
import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';

export { useSchedule, useRecords, useUI };

// ─── AllProviders wrapper ────────────────────────────────────────────────

interface AllProvidersProps {
  children: React.ReactNode;
}

function AllProviders({ children }: AllProvidersProps): ReactElement {
  return <>{children}</>;
}

// ─── Custom render ───────────────────────────────────────────────────────

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  providers?: Partial<ScheduleContextType>;
}

export function renderWithProviders(
  ui: ReactElement,
  _options?: CustomRenderOptions,
) {
  return render(ui, { wrapper: AllProviders });
}
