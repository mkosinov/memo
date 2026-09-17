/**
 * CopyLastWeekPopover unit tests (#242, spec §6).
 *
 * Covers: net per-location counters (minus private, minus target-week dedup
 * keys), private hint, "first 100 of N" note, empty source, disable logic,
 * copy flow → toasts (success/info/error) → close on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock modules (before importing hooks) ────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getActivities: vi.fn(),
}));

vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { getActivities } from '@memo/api-client';
import type { ActivityResponse, PaginatedResponse } from '@memo/api-client';
import { CopyLastWeekPopover } from '../../app/components/schedule/CopyLastWeekPopover';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import {
  createMockScheduleData,
  createMockUIContext,
} from '../helpers/mockContexts';
import { qk } from '../../lib/queryKeys';

// ─── Fixtures ───────────────────────────────────────────────────────────────

// Monday of the TARGET (viewed) week; source = the 7 days before it.
const WEEK_START = '2026-09-14'; // Monday
const SRC_START = '2026-09-07';
const SRC_END = '2026-09-13';

function makeRow(overrides: Partial<ActivityResponse> & { id: string }): ActivityResponse {
  return {
    master_id: 'm1',
    service_id: 's1',
    location_id: 'alpika',
    start: '2026-09-07T10:00:00',
    duration: 60,
    capacity: 8,
    is_private: false,
    comment: null,
    record_info: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00',
    occupied: 0,
    ...overrides,
  };
}

function makePage(items: ActivityResponse[], total = items.length): PaginatedResponse<ActivityResponse> {
  return { items, total, page: 1, per_page: 100 };
}

/**
 * Base source week:
 *  - alpika: a1 dup of target t1 (same m/s + start+7d + duration), a2 counted,
 *    a3 private (counts toward K only), a5 on an ARCHIVED location (absent
 *    from the page dictionary → must not be listed);
 *  - grand: a4 counted.
 * Net counters: alpika 1, grand 1 → total 2.
 */
const BASE_SOURCE = [
  makeRow({ id: 'a1', master_id: 'm1', service_id: 's1', start: '2026-09-07T10:00:00', duration: 60 }),
  makeRow({ id: 'a2', master_id: 'm1', service_id: 's2', start: '2026-09-07T12:00:00', duration: 90 }),
  makeRow({ id: 'a3', master_id: 'm2', service_id: 's1', start: '2026-09-07T15:00:00', duration: 60, is_private: true }),
  makeRow({ id: 'a4', location_id: 'grand', master_id: 'm2', service_id: 's2', start: '2026-09-08T11:00:00', duration: 60 }),
  makeRow({ id: 'a5', location_id: 'old', master_id: 'm1', service_id: 's3', start: '2026-09-09T10:00:00', duration: 60 }),
];

/** Target week cache content: one row matching a1's dedup key after +7d shift. */
const TARGET_ROWS = [
  makeRow({ id: 't1', master_id: 'm1', service_id: 's1', start: '2026-09-14T10:00:00', duration: 60 }),
];

// ─── Harness ────────────────────────────────────────────────────────────────

const mockUseScheduleData = vi.mocked(useScheduleData);
const mockUseUI = vi.mocked(useUI);

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

interface HarnessOptions {
  copyLastWeek?: ReturnType<typeof vi.fn>;
  showToast?: ReturnType<typeof vi.fn>;
  locations?: { id: string; name: string }[];
  targetRows?: ActivityResponse[];
}

function renderPopover(opts: HarnessOptions = {}) {
  const queryClient = createTestQueryClient();
  // The target week is already loaded by the grid (spec §6) — prefill the cache.
  queryClient.setQueryData(qk.activityRange(WEEK_START, '2026-09-20'), opts.targetRows ?? TARGET_ROWS);

  const copyLastWeek =
    opts.copyLastWeek ??
    vi.fn().mockResolvedValue({ copied: 0, skipped_duplicates: 0, skipped_filtered: 0, skipped_no_master: 0 });
  mockUseScheduleData.mockReturnValue(
    createMockScheduleData({
      locations: opts.locations ?? [
        { id: 'alpika', name: 'Альпика', address: '' },
        { id: 'grand', name: 'Гранд Отель Поляна', address: '' },
      ],
      copyLastWeek: copyLastWeek as never,
    }),
  );

  const showToast = opts.showToast ?? vi.fn();
  mockUseUI.mockReturnValue(
    createMockUIContext({ showToast: showToast as never }),
  );

  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CopyLastWeekPopover weekStart={WEEK_START} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, copyLastWeek, showToast, queryClient };
}

/** Resolve the source-week fetch with the given page. */
function mockSource(items: ActivityResponse[], total = items.length) {
  vi.mocked(getActivities).mockResolvedValue(makePage(items, total));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSource(BASE_SOURCE);
});

// ─── Counters & list ────────────────────────────────────────────────────────

describe('CopyLastWeekPopover — source list', () => {
  it('fetches the source week with the activityRange params (per_page 100)', async () => {
    renderPopover();
    await waitFor(() => expect(screen.getByTestId('copy-last-week-popover')).toBeInTheDocument());
    expect(vi.mocked(getActivities)).toHaveBeenCalledWith({
      date_from: SRC_START,
      date_to: SRC_END,
      per_page: 100,
    });
  });

  it('renders per-location net counters (minus private, minus target-week duplicates)', async () => {
    renderPopover();
    // alpika: 3 public rows, one is a target duplicate → 1; grand: 1.
    await waitFor(() => expect(screen.getByTestId('copy-count-alpika')).toHaveTextContent('1'));
    expect(screen.getByTestId('copy-count-grand')).toHaveTextContent('1');
  });

  it('does not list archived locations (absent from the page dictionary)', async () => {
    renderPopover();
    await waitFor(() => expect(screen.getByTestId('copy-count-alpika')).toBeInTheDocument());
    // a5 sits on 'old' — not part of the active dictionary → no row rendered.
    expect(screen.queryByTestId('copy-count-old')).not.toBeInTheDocument();
    expect(screen.queryByText('Старая локация')).not.toBeInTheDocument();
  });

  it('shows the private-lessons hint when the source has private rows', async () => {
    renderPopover();
    await waitFor(() =>
      expect(screen.getByText('1 индивидуальных занятий не копируются')).toBeInTheDocument(),
    );
  });

  it('hides the private hint when there are no private rows', async () => {
    mockSource([
      makeRow({ id: 'a1', start: '2026-09-07T10:00:00' }),
      makeRow({ id: 'a4', location_id: 'grand', start: '2026-09-08T11:00:00' }),
    ]);
    renderPopover();
    await waitFor(() => expect(screen.getByTestId('copy-count-alpika')).toBeInTheDocument());
    expect(screen.queryByText(/не копируются/)).not.toBeInTheDocument();
  });

  it('shows the "first 100 of N" note when total > items.length', async () => {
    // per_page=100 caps items; total beyond that is server-reported.
    mockSource(BASE_SOURCE.slice(0, 3), 103);
    renderPopover();
    await waitFor(() =>
      expect(
        screen.getByText(
          'Показаны первые 100 из 103 занятий; за один заход копируется до 100 — сузьте выбор локаций или скопируйте в несколько заходов',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('hides the note when total <= items.length', async () => {
    renderPopover(); // 5 items, total 5
    await waitFor(() => expect(screen.getByTestId('copy-count-alpika')).toBeInTheDocument());
    expect(screen.queryByText(/Показаны первые 100/)).not.toBeInTheDocument();
  });

  it('renders the loading state while the source fetch is in flight', () => {
    vi.mocked(getActivities).mockReturnValue(new Promise(() => undefined));
    renderPopover();
    expect(screen.getByTestId('copy-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-confirm')).not.toBeInTheDocument();
  });

  it('renders the empty state with a disabled button for an empty source week', async () => {
    mockSource([], 0);
    renderPopover();
    await waitFor(() => expect(screen.getByTestId('copy-empty')).toBeInTheDocument());
    expect(screen.getByTestId('copy-confirm')).toBeDisabled();
  });
});

// ─── Disable logic ──────────────────────────────────────────────────────────

describe('CopyLastWeekPopover — confirm button', () => {
  it('is disabled when the total "to copy" is 0 (everything private or duplicate)', async () => {
    mockSource([
      makeRow({ id: 'a1', start: '2026-09-07T10:00:00' }), // dup of target
      makeRow({ id: 'a3', start: '2026-09-07T15:00:00', is_private: true }),
    ]);
    renderPopover();
    await waitFor(() => expect(screen.getByTestId('copy-confirm')).toBeInTheDocument());
    expect(screen.getByTestId('copy-confirm')).toBeDisabled();
  });

  it('is enabled when there is something to copy', async () => {
    renderPopover();
    await waitFor(() => expect(screen.getByTestId('copy-confirm')).toBeEnabled());
  });

  it('is disabled while the mutation is in flight', async () => {
    let resolveCopy: (v: unknown) => void = () => undefined;
    const copyLastWeek = vi.fn().mockReturnValue(new Promise((res) => { resolveCopy = res; }));
    const { onClose } = renderPopover({ copyLastWeek });
    await waitFor(() => expect(screen.getByTestId('copy-confirm')).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-confirm'));
    });
    expect(screen.getByTestId('copy-confirm')).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    resolveCopy({ copied: 2, skipped_duplicates: 0, skipped_filtered: 0, skipped_no_master: 0 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ─── Copy flow ──────────────────────────────────────────────────────────────

describe('CopyLastWeekPopover — copy flow', () => {
  it('calls copyLastWeek with the target Monday and all checked locations by default', async () => {
    const { copyLastWeek } = renderPopover();
    const confirm = await screen.findByTestId('copy-confirm');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(copyLastWeek).toHaveBeenCalledWith(WEEK_START, ['alpika', 'grand']);
  });

  it('excludes unchecked locations from the copy call', async () => {
    const { copyLastWeek } = renderPopover();
    const alpikaToggle = await screen.findByTestId('copy-loc-alpika');
    await act(async () => {
      fireEvent.click(alpikaToggle); // uncheck Альпика
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('copy-confirm'));
    });
    expect(copyLastWeek).toHaveBeenCalledWith(WEEK_START, ['grand']);
  });

  it('shows the success toast and closes the popup on success', async () => {
    const copyLastWeek = vi.fn().mockResolvedValue({
      copied: 2, skipped_duplicates: 0, skipped_filtered: 0, skipped_no_master: 0,
    });
    const { showToast, onClose } = renderPopover({ copyLastWeek });
    const confirm = await screen.findByTestId('copy-confirm');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(showToast).toHaveBeenCalledWith('Скопировано 2 занятий', 'success');
    expect(onClose).toHaveBeenCalled();
  });

  it('appends the duplicates and filtered lines to the success toast', async () => {
    const copyLastWeek = vi.fn().mockResolvedValue({
      copied: 1, skipped_duplicates: 1, skipped_filtered: 1, skipped_no_master: 1,
    });
    const { showToast } = renderPopover({ copyLastWeek });
    const confirm = await screen.findByTestId('copy-confirm');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(showToast).toHaveBeenCalledWith(
      'Скопировано 1 занятий (пропущено 1 — уже есть)\n' +
        'не скопировано ещё 2 — индивидуальные, архивная локация или без замены мастера',
      'success',
    );
  });

  it('shows the info toast when everything already exists', async () => {
    const copyLastWeek = vi.fn().mockResolvedValue({
      copied: 0, skipped_duplicates: 3, skipped_filtered: 0, skipped_no_master: 0,
    });
    const { showToast, onClose } = renderPopover({ copyLastWeek });
    const confirm = await screen.findByTestId('copy-confirm');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(showToast).toHaveBeenCalledWith('Всё уже есть', 'info');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the info toast when there was nothing to copy at all', async () => {
    const copyLastWeek = vi.fn().mockResolvedValue({
      copied: 0, skipped_duplicates: 0, skipped_filtered: 0, skipped_no_master: 0,
    });
    const { showToast } = renderPopover({ copyLastWeek });
    const confirm = await screen.findByTestId('copy-confirm');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(showToast).toHaveBeenCalledWith('Нечего копировать', 'info');
  });

  it('shows an error toast with the server message and keeps the popup open', async () => {
    const copyLastWeek = vi.fn().mockRejectedValue(new Error('Нельзя копировать в ту же неделю'));
    const { showToast, onClose } = renderPopover({ copyLastWeek });
    const confirm = await screen.findByTestId('copy-confirm');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(showToast).toHaveBeenCalledWith('Нельзя копировать в ту же неделю', 'error');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error toast when the source fetch fails', async () => {
    vi.mocked(getActivities).mockRejectedValue(new Error('Сеть недоступна'));
    const { showToast } = renderPopover();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Сеть недоступна', 'error'),
    );
  });

  it('closes on the close button', async () => {
    const { onClose } = renderPopover();
    const closeBtn = await screen.findByTestId('copy-close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
