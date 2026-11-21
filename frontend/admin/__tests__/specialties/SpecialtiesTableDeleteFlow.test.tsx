/**
 * GH #599 Task 8.1 (spec §2.4/§7 scenarios 5a/5b/5c) — SpecialtiesTable
 * delete flow THROUGH THE REAL PIPELINE, mirror of
 * PositionsTableDeleteFlow.test.tsx (#324): the REAL chain —
 *
 *   SpecialtiesTable → useDeleteSpecialty (real) → PendingActionsProvider
 *                   → UIProvider (real) + ToastContainer (real)
 *
 * with only the api-client boundary mocked (getSpecialties /
 * dryRunDeleteSpecialty / resolveDeleteSpecialty). Asserts what the user
 * actually SEES:
 * - §7 5c free direction: «Удалить» → NO window.confirm → row gone + ring
 *   toast; «Отменить» → row back, no DELETE ever fired; expiry commits
 *   {expected: {}}.
 * - §7 5b staff-held direction: dry-run 409 (auto staff_specialties tree)
 *   → DeleteDialog Mode A («Сотрудники — потеряют направление:») → confirm
 *   → ring; expiry commits {resolutions: {}, expected: {staff_specialties:
 *   ids}} — the staff cards survive (the materials pattern).
 * - §7 5a service-held direction: dry-run 409 (blocking services node)
 *   → DeleteDialog BLOCKED («Нельзя удалить: есть N услуги.» + the backend
 *   way-out message, NO archive button) → «Понятно» closes; the row stays,
 *   NOTHING enqueued.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getSpecialties: vi.fn(),
    dryRunDeleteSpecialty: vi.fn(),
    resolveDeleteSpecialty: vi.fn(),
  };
});

import {
  getSpecialties,
  dryRunDeleteSpecialty,
  resolveDeleteSpecialty,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode, PaginatedResponse, SpecialtyResponse } from '@memo/api-client';
import { SpecialtiesTable } from '@/app/(main)/services/components/SpecialtiesTable';
import { SpecialtiesProvider } from '@/contexts/SpecialtiesContext';
import { UIProvider } from '@/contexts/UIContext';
import { PendingActionsProvider } from '@/contexts/PendingActionsContext';
import { ToastContainer } from '@/app/components/toast/ToastContainer';

const mockGetSpecialties = vi.mocked(getSpecialties);
const mockDryRun = vi.mocked(dryRunDeleteSpecialty);
const mockResolveDeleteSpecialty = vi.mocked(resolveDeleteSpecialty);

const TEST_SPECIALTIES: SpecialtyResponse[] = [
  { id: 'spec-painting', title: 'Живопись', created_at: '2024-01-01T10:00:00Z', updated_at: '2024-01-01T10:00:00Z' },
  { id: 'spec-ceramics', title: 'Керамика', created_at: '2024-01-01T10:00:00Z', updated_at: '2024-01-01T10:00:00Z' },
];

/** §7 5b — the staff_specialties AUTO-cascade node (the 409 tree). */
const STAFF_DEPS: DependencyNode[] = [
  {
    entity: 'staff_specialties',
    auto: true,
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

/** §7 5a — the BLOCKING services node (allowed_actions: [], the FK RESTRICT
 * preview counting ALL services incl. archived) with its way-out message. */
const SERVICES_DEPS: DependencyNode[] = [
  {
    entity: 'services',
    auto: false,
    relation: 'Услуга',
    count: 3,
    allowed_actions: [],
    message: 'Переназначьте услуги другому направлению или удалите их',
    items: [
      { id: 'sv-1', label: 'Рисование гуашью' },
      { id: 'sv-2', label: 'Акварель для взрослых' },
      { id: 'sv-3', label: 'Архивная услуга' },
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
          <SpecialtiesProvider>
            <SpecialtiesTable />
            <ToastContainer />
          </SpecialtiesProvider>
        </PendingActionsProvider>
      </UIProvider>
    </QueryClientProvider>,
  );
}

function setupEnvelope(items: SpecialtyResponse[]): PaginatedResponse<SpecialtyResponse> {
  const envelope = { items, total: items.length, page: 1, per_page: 10 };
  mockGetSpecialties.mockResolvedValue(envelope);
  return envelope;
}

describe('SpecialtiesTable delete flow — full pipeline (GH #599 §7 5a/5b/5c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupEnvelope(TEST_SPECIALTIES);
    mockDryRun.mockResolvedValue(undefined);
    mockResolveDeleteSpecialty.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('§7 5c free direction: «Удалить» → NO window.confirm → row gone + ring; «Отменить» → row back, no DELETE', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderFlow();
    await screen.findByText('Керамика');

    const row = screen.getByTestId('specialty-row-spec-ceramics');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    // The window.confirm instant path is GONE (#324 family).
    expect(confirmSpy).not.toHaveBeenCalled();

    // Row disappears optimistically (dry-run 204 inside the real hook).
    await waitFor(() =>
      expect(screen.queryByTestId('specialty-row-spec-ceramics')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('specialty-row-spec-painting')).toBeInTheDocument();

    // The pending toast carries the countdown ring (#94) + undo label.
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();
    expect(mockResolveDeleteSpecialty).not.toHaveBeenCalled();

    // Undo inside the window: the row returns, the server DELETE never fires.
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));

    await waitFor(() =>
      expect(screen.getByTestId('specialty-row-spec-ceramics')).toBeInTheDocument(),
    );
    expect(mockResolveDeleteSpecialty).not.toHaveBeenCalled();
    expect(mockDryRun).toHaveBeenCalledTimes(1);
  });

  it('§7 5c free direction: window expiry commits {expected: {}}', async () => {
    renderFlow();
    await screen.findByText('Керамика');

    const row = screen.getByTestId('specialty-row-spec-ceramics');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() =>
      expect(screen.queryByTestId('specialty-row-spec-ceramics')).not.toBeInTheDocument(),
    );

    setupEnvelope([TEST_SPECIALTIES[0]]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockResolveDeleteSpecialty).toHaveBeenCalledTimes(1);
    expect(mockResolveDeleteSpecialty).toHaveBeenCalledWith('spec-ceramics', { expected: {} });
    expect(screen.queryByTestId('specialty-row-spec-ceramics')).not.toBeInTheDocument();
  });

  it('§7 5b staff-held: 409 → dialog «Сотрудники — потеряют направление:» → confirm → ring; expiry commits {resolutions: {}, expected}', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, STAFF_DEPS),
    );
    renderFlow();
    await screen.findByText('Керамика');

    const row = screen.getByTestId('specialty-row-spec-ceramics');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    // Dry-run conflict parks the tree and opens the dialog; row stays.
    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('specialty-row-spec-ceramics')).toBeInTheDocument();
    // The dialog wording: the staff cards SURVIVE — «потеряют направление».
    expect(screen.getByText('Сотрудники — потеряют направление:')).toBeInTheDocument();
    expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByText('Мария Петрова')).toBeInTheDocument();
    // All-auto tree → NO confirm checkbox (Mode A immediate).
    expect(screen.queryByTestId('delete-dialog-confirm-checkbox')).not.toBeInTheDocument();

    // «Удалить» (unconditional — no checkbox to tick).
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    // Dialog closes immediately (enqueue is sync); row gone + ring toast.
    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('specialty-row-spec-ceramics')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Удалено. Отменить')).toBeInTheDocument();
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();

    // Commit fires ONLY after the 5s undo window — the auto-cascade commit
    // {resolutions: {}} + expected id-sets from the tree's items.
    expect(mockResolveDeleteSpecialty).not.toHaveBeenCalled();
    setupEnvelope([TEST_SPECIALTIES[0]]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockResolveDeleteSpecialty).toHaveBeenCalledTimes(1);
    expect(mockResolveDeleteSpecialty).toHaveBeenCalledWith('spec-ceramics', {
      resolutions: {},
      expected: { staff_specialties: ['st-1', 'st-2'] },
    });
    expect(screen.queryByTestId('specialty-row-spec-ceramics')).not.toBeInTheDocument();
  });

  it('§7 5a service-held: 409 → BLOCKED dialog «Нельзя удалить: есть 3 услуги.» — no archive, «Понятно», row stays, nothing enqueued', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, SERVICES_DEPS),
    );
    renderFlow();
    await screen.findByText('Живопись');

    const row = screen.getByTestId('specialty-row-spec-painting');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    // Blocked Mode B: the «Услуги: N» counter + the backend way-out message.
    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('delete-dialog-block-message')).toHaveTextContent(
      'Нельзя удалить: есть 3 услуги.',
    );
    expect(screen.getByTestId('delete-dialog-block-hint')).toHaveTextContent(
      'Переназначьте услуги другому направлению или удалите их',
    );
    // A hard-delete dictionary offers NO archive escape hatch.
    expect(screen.queryByTestId('delete-dialog-archive-btn')).not.toBeInTheDocument();

    // Acknowledge and close — nothing was enqueued, the row stays.
    fireEvent.click(screen.getByTestId('delete-dialog-ack-btn'));
    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('specialty-row-spec-painting')).toBeInTheDocument();
    expect(screen.queryByText('Удалено. Отменить')).not.toBeInTheDocument();
    expect(mockResolveDeleteSpecialty).not.toHaveBeenCalled();
  });

  it('§7 5a mixed tree (services + staff): the blocking node wins — acknowledgment only', async () => {
    mockDryRun.mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, [...SERVICES_DEPS, ...STAFF_DEPS]),
    );
    renderFlow();
    await screen.findByText('Живопись');

    const row = screen.getByTestId('specialty-row-spec-painting');
    fireEvent.click(
      row.querySelector('button[aria-label^="Действия"]') as HTMLButtonElement,
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('delete-dialog-block-message')).toHaveTextContent(
      'Нельзя удалить: есть 3 услуги.',
    );
    // No delete/confirm surface in the blocked mode.
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    expect(mockResolveDeleteSpecialty).not.toHaveBeenCalled();
  });
});
