/**
 * GH #318 (spec §3 D5, plan Task 6) — TagsTable delete flow THROUGH THE REAL
 * PIPELINE. The unit TagsTable.test.tsx mocks useDeleteTag, so the pending
 * stack never runs there; these tests wire the REAL chain —
 *
 *   TagsTable → useDeleteTag (real) → PendingActionsProvider (real)
 *            → UIProvider (real) + ToastContainer (real)
 *
 * with only the api-client boundary mocked (getTags / dryRunDeleteTag /
 * resolveDeleteTag). This is the only vitest place asserting what the user
 * actually SEES: the «Удалено. Отменить» toast carrying the countdown ring
 * (`toast-countdown`, #94), and — after the 5s window — the commit payload
 * {resolutions, expected} on the 409-confirmed cascade path.
 *
 * Fake timers follow the PendingActionsContext.test.tsx pattern: installed
 * up-front, async work flushed with advanceTimersByTimeAsync(0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getTags: vi.fn(),
    dryRunDeleteTag: vi.fn(),
    resolveDeleteTag: vi.fn(),
  };
});

import {
  getTags,
  dryRunDeleteTag,
  resolveDeleteTag,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, TagResponse } from '@memo/api-client';
import { TagsTable } from '@/app/(main)/tags/components/TagsTable';
import { TagsProvider } from '@/contexts/TagsContext';
import { UIProvider } from '@/contexts/UIContext';
import { PendingActionsProvider } from '@/contexts/PendingActionsContext';
import { ToastContainer } from '@/app/components/toast/ToastContainer';

const mockGetTags = vi.mocked(getTags);
const mockDryRun = vi.mocked(dryRunDeleteTag);
const mockResolveDeleteTag = vi.mocked(resolveDeleteTag);

const TEST_TAGS: TagResponse[] = [
  { id: 't-1', title: 'Живопись' },
  { id: 't-2', title: 'Керамика' },
];

const TAG_DEPS: DependencyNode[] = [
  {
    entity: 'service_tags',
    auto: false,
    relation: 'Услуга',
    count: 2,
    allowed_actions: ['cascade'],
    message: null,
    items: [
      { id: 'svc-1', label: 'Стрижка' },
      { id: 'svc-2', label: 'Маникюр' },
    ],
  },
];

/** Full provider chain — everything real except the api-client boundary. */
function renderFlow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <PendingActionsProvider>
          <TagsProvider>
            <TagsTable />
            <ToastContainer />
          </TagsProvider>
        </PendingActionsProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

/** Load the table page, then open the row menu and hit «Удалить» (t-1). */
async function clickDeleteOnFirstRow(): Promise<void> {
  fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));
}

describe('TagsTable delete flow — full pipeline (GH #318 D5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // shouldAdvanceTime lets real-time polling (findByText/waitFor) tick while
    // keeping setTimeout/setInterval under fake control for the 5s commit
    // window (PendingActionsContext.test.tsx uses plain fake timers because
    // its harness is synchronous; this file renders through react-query).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const envelope: PaginatedResponse<TagResponse> = {
      items: TEST_TAGS,
      total: TEST_TAGS.length,
      page: 1,
      per_page: 10,
    };
    mockGetTags.mockResolvedValue(envelope);
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteTag.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clean tag: «Удалить» → row gone + ring toast «Удалено. Отменить»; «Отменить» → row back, no DELETE', async () => {
    renderFlow();
    await screen.findByText('Живопись');

    await clickDeleteOnFirstRow();

    // Row disappears optimistically (dry-run 204 inside the real hook).
    await waitFor(() =>
      expect(screen.queryByTestId('tag-row-t-1')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('tag-row-t-2')).toBeInTheDocument();

    // The pending toast carries the countdown ring (#94) — the plan's
    // «тост с кольцом» — and the undo label.
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();
    expect(mockResolveDeleteTag).not.toHaveBeenCalled();

    // Undo inside the window: the row returns, the server DELETE never fires.
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));

    await waitFor(() =>
      expect(screen.getByTestId('tag-row-t-1')).toBeInTheDocument(),
    );
    expect(mockResolveDeleteTag).not.toHaveBeenCalled();
    expect(mockDryRun).toHaveBeenCalledTimes(1);
  });

  it('busy tag: 409 → dialog → confirm → ring toast; window expiry commits {resolutions, expected}', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, TAG_DEPS),
    );
    renderFlow();
    await screen.findByText('Живопись');

    await clickDeleteOnFirstRow();

    // Dry-run conflict parks the tree and opens the dialog; row stays.
    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('tag-row-t-1')).toBeInTheDocument();

    // Confirm checkbox (choice deps exist) + «Удалить».
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    // Dialog closes immediately (enqueue is sync); row gone + ring toast.
    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('tag-row-t-1')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();

    // Commit fires ONLY after the 5s undo window — with the dialog-built
    // resolutions and the expected id-sets from the tree's items (D6).
    expect(mockResolveDeleteTag).not.toHaveBeenCalled();
    // Server truth after the commit: the tag is gone — the post-invalidate
    // refetch must not resurrect the row.
    mockGetTags.mockResolvedValue({
      items: [TEST_TAGS[1]],
      total: 1,
      page: 1,
      per_page: 10,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockResolveDeleteTag).toHaveBeenCalledTimes(1);
    expect(mockResolveDeleteTag).toHaveBeenCalledWith('t-1', {
      resolutions: { service_tags: 'cascade' },
      expected: { service_tags: ['svc-1', 'svc-2'] },
    });
    // Nothing resurrected the row after the commit + refetch.
    expect(screen.queryByTestId('tag-row-t-1')).not.toBeInTheDocument();
  });
});
