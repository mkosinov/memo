/**
 * GH #324 (spec §6/§9.5/§9.6) — PositionsTable delete flow THROUGH THE REAL
 * PIPELINE, mirror of TagsTableDeleteFlow.test.tsx (#318): the REAL chain —
 *
 *   PositionsTable → useDeletePosition (real) → PendingActionsProvider
 *                 → UIProvider (real) + ToastContainer (real)
 *
 * with only the api-client boundary mocked (getPositions /
 * dryRunDeletePosition / resolveDeletePosition). Asserts what the user
 * actually SEES:
 * - §9.5 clean position: «Удалить» → NO window.confirm → row gone + ring
 *   toast; «Отменить» → row back, no DELETE ever fired.
 * - §9.5 busy position: dry-run 409 → DeleteDialog («Сотрудники — потеряют
 *   должность:») → confirm → ring; expiry commits
 *   {resolutions: {staff_positions: cascade}, expected: {staff_positions: ids}}.
 * - §9.6 system position: dry-run 422 POSITION_IS_SYSTEM → explanation
 *   toast «Встроенная должность не удаляется», NOTHING enqueued, row stays.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPositions: vi.fn(),
    dryRunDeletePosition: vi.fn(),
    resolveDeletePosition: vi.fn(),
  };
});

import {
  getPositions,
  dryRunDeletePosition,
  resolveDeletePosition,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, PositionResponse } from '@memo/api-client';
import { PositionsTable } from '@/app/(main)/positions/components/PositionsTable';
import { PositionsProvider } from '@/contexts/PositionsContext';
import { UIProvider } from '@/contexts/UIContext';
import { PendingActionsProvider } from '@/contexts/PendingActionsContext';
import { ToastContainer } from '@/app/components/toast/ToastContainer';

const mockGetPositions = vi.mocked(getPositions);
const mockDryRun = vi.mocked(dryRunDeletePosition);
const mockResolveDeletePosition = vi.mocked(resolveDeletePosition);

const TEST_POSITIONS: PositionResponse[] = [
  { id: 'master', title: 'Мастер', is_system: true, created_at: '2024-01-01T10:00:00Z', updated_at: '2024-01-01T10:00:00Z' },
  { id: 'smm', title: 'СММ', is_system: false, created_at: '2024-01-01T10:00:00Z', updated_at: '2024-01-01T10:00:00Z' },
];

const POSITION_DEPS: DependencyNode[] = [
  {
    entity: 'staff_positions',
    auto: false,
    relation: 'Сотрудник',
    count: 2,
    allowed_actions: ['cascade'],
    message: null,
    items: [
      { id: 'st-1', label: 'Анна Иванова' },
      { id: 'st-2', label: 'Мария Петрова' },
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
          <PositionsProvider>
            <PositionsTable />
            <ToastContainer />
          </PositionsProvider>
        </PendingActionsProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

function setupEnvelope(items: PositionResponse[]): PaginatedResponse<PositionResponse> {
  const envelope = { items, total: items.length, page: 1, per_page: 10 };
  mockGetPositions.mockResolvedValue(envelope);
  return envelope;
}

describe('PositionsTable delete flow — full pipeline (GH #324 §9.5/§9.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupEnvelope(TEST_POSITIONS);
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeletePosition.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('§9.5 clean position: «Удалить» → NO window.confirm → row gone + ring toast; «Отменить» → row back, no DELETE', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderFlow();
    await screen.findByText('СММ');

    // Open the row menu and hit «Удалить» on the user-defined row.
    const row = screen.getByTestId('position-row-smm');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    // The window.confirm instant path is GONE.
    expect(confirmSpy).not.toHaveBeenCalled();

    // Row disappears optimistically (dry-run 204 inside the real hook).
    await waitFor(() =>
      expect(screen.queryByTestId('position-row-smm')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('position-row-master')).toBeInTheDocument();

    // The pending toast carries the countdown ring (#94) + undo label.
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();
    expect(mockResolveDeletePosition).not.toHaveBeenCalled();

    // Undo inside the window: the row returns, the server DELETE never fires.
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));

    await waitFor(() =>
      expect(screen.getByTestId('position-row-smm')).toBeInTheDocument(),
    );
    expect(mockResolveDeletePosition).not.toHaveBeenCalled();
    expect(mockDryRun).toHaveBeenCalledTimes(1);
  });

  it('§9.5 clean position: window expiry commits {expected: {}}', async () => {
    renderFlow();
    await screen.findByText('СММ');

    const row = screen.getByTestId('position-row-smm');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() =>
      expect(screen.queryByTestId('position-row-smm')).not.toBeInTheDocument(),
    );

    setupEnvelope([TEST_POSITIONS[0]]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockResolveDeletePosition).toHaveBeenCalledTimes(1);
    expect(mockResolveDeletePosition).toHaveBeenCalledWith('smm', { expected: {} });
    expect(screen.queryByTestId('position-row-smm')).not.toBeInTheDocument();
  });

  it('§9.5 busy position: 409 → DeleteDialog «Сотрудники — потеряют должность:» → confirm → ring; expiry commits {resolutions, expected}', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, POSITION_DEPS),
    );
    renderFlow();
    await screen.findByText('СММ');

    const row = screen.getByTestId('position-row-smm');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    // Dry-run conflict parks the tree and opens the dialog; row stays.
    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('position-row-smm')).toBeInTheDocument();
    // The dialog wording: the staff cards SURVIVE — «потеряют должность».
    expect(screen.getByText('Сотрудники — потеряют должность:')).toBeInTheDocument();
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByText('Мария Петрова')).toBeInTheDocument();

    // Confirm checkbox (choice dep exists) + «Удалить».
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-checkbox'));
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    // Dialog closes immediately (enqueue is sync); row gone + ring toast.
    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('position-row-smm')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();

    // Commit fires ONLY after the 5s undo window — dialog-built resolutions
    // + expected id-sets from the tree's items.
    expect(mockResolveDeletePosition).not.toHaveBeenCalled();
    setupEnvelope([TEST_POSITIONS[0]]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockResolveDeletePosition).toHaveBeenCalledTimes(1);
    expect(mockResolveDeletePosition).toHaveBeenCalledWith('smm', {
      resolutions: { staff_positions: 'cascade' },
      expected: { staff_positions: ['st-1', 'st-2'] },
    });
    expect(screen.queryByTestId('position-row-smm')).not.toBeInTheDocument();
  });

  it('§9.6 system position: dry-run 422 POSITION_IS_SYSTEM → explanation toast, nothing enqueued, row stays', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(422, 'Встроенная должность не удаляется', 'POSITION_IS_SYSTEM'),
    );
    renderFlow();
    await screen.findByText('Мастер');

    const row = screen.getByTestId('position-row-master');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    // The explanation toast — clear text, no ring, no dialog.
    await waitFor(() =>
      expect(screen.getByText('Встроенная должность не удаляется')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toast-countdown')).not.toBeInTheDocument();
    // The row stays — nothing was deleted or enqueued (no pending toast).
    expect(screen.getByTestId('position-row-master')).toBeInTheDocument();
    expect(mockResolveDeletePosition).not.toHaveBeenCalled();
    expect(screen.queryByText('Удалено. Отменить')).not.toBeInTheDocument();
  });
});
