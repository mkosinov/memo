import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, useMutationState } from '@tanstack/react-query';
import { Topbar } from '../app/components/layout/Topbar';
import { UIProvider } from '../contexts/UIContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';
import { getUserSettings, patchUserSettings } from '@memo/api-client';
import {
  createMockScheduleData,
  createMockUseScheduleView,
  createMockScheduleView,
  createMockGridSettings,
} from './helpers/mockContexts';
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';
import type { ScheduleView } from '@/hooks/useScheduleView';
import type { ScheduleViewContextType } from '@/contexts/schedule/ScheduleViewContext';
import type { GridSettingsContextType } from '@/contexts/schedule/GridSettingsContext';

// #138 Task 3: NavigationContext is gone from the Topbar tree. The URL hook
// is mocked with the shared fixture — this file only asserts zoom/grid UI.

vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getMasters: vi.fn().mockResolvedValue(wrap([])),
  getLocations: vi.fn().mockResolvedValue(wrap([])),
  getServices: vi.fn().mockResolvedValue(wrap([])),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  getUserSettings: vi.fn(),
  patchUserSettings: vi.fn(),
  });
});

// GH #267: Topbar now consumes useUserSettings — provider is auth-gated, so
// mock the auth hook to report `authenticated`.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ status: 'authenticated', user: { id: 'u1' }, permissions: [], master: null, login: vi.fn(), logout: vi.fn(), can: vi.fn(() => false), refresh: vi.fn() })),
}));

// Partial mock — real QueryClient/QueryClientProvider stay intact; only
// useMutationState (the saving-indicator source, spec §5) is faked.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useMutationState: vi.fn(() => [] as boolean[]),
  };
});

// Partial mock — SCHEDULE_ACTIVITY_MUTATION_KEY stays the real export.
vi.mock('@/contexts/schedule/ScheduleDataContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/schedule/ScheduleDataContext')>();
  return {
    ...actual,
    useScheduleData: vi.fn(() => createMockScheduleData()),
  };
});

// URL hook + context mocked with the shared fixtures (zoom tests need no URL).
vi.mock('@/hooks/useScheduleView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useScheduleView')>();
  return {
    ...actual,
    useScheduleView: vi.fn(() => createMockUseScheduleView()),
  };
});

vi.mock('@/contexts/schedule/ScheduleViewContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/schedule/ScheduleViewContext')>();
  return {
    ...actual,
    useScheduleView: vi.fn(() => createMockScheduleView()),
  };
});

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => createMockGridSettings()),
}));

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView as useUrlHook } from '@/hooks/useScheduleView';
import { useScheduleView as useViewContext } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';

interface TopbarMockOverrides {
  data?: Partial<ScheduleDataContextType>;
  view?: Partial<ScheduleView>;
  context?: Partial<ScheduleViewContextType>;
  grid?: Partial<GridSettingsContextType>;
}

function renderTopbar(overrides: TopbarMockOverrides = {}) {
  // One fixture per render call — re-renders must keep the SAME vi.fn() setters.
  const fixture = createMockUseScheduleView(overrides.view);
  vi.mocked(useUrlHook).mockReturnValue(fixture);
  vi.mocked(useScheduleData).mockReturnValue(createMockScheduleData(overrides.data));
  vi.mocked(useViewContext).mockReturnValue(createMockScheduleView(overrides.context));
  vi.mocked(useGridSettings).mockReturnValue(createMockGridSettings(overrides.grid));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <UserSettingsProvider>
          <Topbar />
        </UserSettingsProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('Topbar — Cell Height Zoom Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMutationState).mockReturnValue([]);
    // Settings fixture: remote GET resolves; PUT/PATCH no-op.
    vi.mocked(getUserSettings).mockResolvedValue({
      user_id: 'u1',
      theme: 'light',
      language: 'ru',
      column_order_staff: [],
      column_order_locations: [],
      show_archived_masters: true,
      show_archived_locations: false,
    } as never);
    vi.mocked(patchUserSettings).mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT render the old +/- height control', () => {
    renderTopbar();
    expect(screen.queryByTestId('cell-height-control')).not.toBeInTheDocument();
    expect(screen.queryByText('Высота')).not.toBeInTheDocument();
  });

  it('renders the zoom icon button', () => {
    renderTopbar();
    expect(screen.getByTestId('zoom-button')).toBeInTheDocument();
  });

  it('opens zoom popup when zoom button is clicked', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByTestId('zoom-popup')).toBeInTheDocument();
  });

  it('renders 3 options in the popup', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByTestId('zoom-option-40')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-option-50')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-option-60')).toBeInTheDocument();
  });

  it('highlights the currently active option', () => {
    renderTopbar({ grid: { cellHeight: 50 } });
    fireEvent.click(screen.getByTestId('zoom-button'));
    const activeOption = screen.getByTestId('zoom-option-50');
    expect(activeOption).toHaveAttribute('data-active', 'true');
  });

  it('calls setCellHeight and closes popup when option is selected', () => {
    const setCellHeight = vi.fn();
    renderTopbar({ grid: { cellHeight: 50, setCellHeight } });

    fireEvent.click(screen.getByTestId('zoom-button'));
    fireEvent.click(screen.getByTestId('zoom-option-60'));

    expect(setCellHeight).toHaveBeenCalledWith(60);
    expect(screen.queryByTestId('zoom-popup')).not.toBeInTheDocument();
  });

  it('closes popup on outside click', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByTestId('zoom-popup')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('zoom-popup')).not.toBeInTheDocument();
  });

  it('displays option labels in Russian', () => {
    renderTopbar();
    fireEvent.click(screen.getByTestId('zoom-button'));
    expect(screen.getByText('Мелкий')).toBeInTheDocument();
    expect(screen.getByText('Стандартный')).toBeInTheDocument();
    expect(screen.getByText('Крупный')).toBeInTheDocument();
  });
});
