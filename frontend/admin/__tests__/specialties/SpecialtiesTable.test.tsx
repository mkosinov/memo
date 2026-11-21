import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mockSpecialtyPainting,
  mockSpecialtyCeramics,
  mockSpecialties,
  createMockSpecialtyResponse,
} from '../helpers/mockData';
import type { PaginatedResponse, SpecialtyResponse } from '@memo/api-client';

// ─── Mocks ───────────────────────────────────────────────────────────────
// useQuery/QueryClientProvider stay REAL: the table renders inside the real
// SpecialtiesProvider and the server-pagination wiring is asserted through
// the getSpecialties spy (PositionsTable precedent). Only useQueryClient is
// stubbed so the invalidation spy is shared with the mutation hooks.
// SpecialtyModal is NOT stubbed — the create/rename submit paths are driven
// through the real form.

const mockShowToast = vi.fn();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    // #324 pattern: the deferred-delete hook also walks the caches
    // (getQueriesData/setQueriesData — snapshot capture/remove) on top of
    // the invalidation spy shared with the mutation hooks.
    useQueryClient: vi.fn(() => ({
      invalidateQueries: mockInvalidateQueries,
      getQueriesData: vi.fn(() => []),
      setQueriesData: vi.fn(),
    })),
  };
});

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getSpecialties: vi.fn(),
    createSpecialty: vi.fn(),
    patchSpecialty: vi.fn(),
    dryRunDeleteSpecialty: vi.fn(),
    resolveDeleteSpecialty: vi.fn(),
  };
});

// The deferred-delete hook (useDeleteSpecialty) consumes PendingActions —
// stubbed so nothing enqueues in these unit tests (the FULL pipeline runs in
// SpecialtiesTableDeleteFlow.test.tsx).
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: vi.fn() }),
}));

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

// ─── Imports after mocks ─────────────────────────────────────────────────

import {
  getSpecialties,
  createSpecialty,
  patchSpecialty,
  dryRunDeleteSpecialty,
  ApiError,
} from '@memo/api-client';
import { SpecialtiesTable } from '@/app/(main)/services/components/SpecialtiesTable';
import { SpecialtiesProvider } from '@/contexts/SpecialtiesContext';

const mockGetSpecialties = vi.mocked(getSpecialties);
const mockCreateSpecialty = vi.mocked(createSpecialty);
const mockPatchSpecialty = vi.mocked(patchSpecialty);
const mockDryRunDeleteSpecialty = vi.mocked(dryRunDeleteSpecialty);

function setupEnvelope(overrides: Partial<PaginatedResponse<SpecialtyResponse>> = {}) {
  mockGetSpecialties.mockResolvedValue({
    items: mockSpecialties,
    total: mockSpecialties.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SpecialtiesProvider>
        <SpecialtiesTable />
      </SpecialtiesProvider>
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderTable();
  await screen.findByText('Живопись');
}

/** Open the row's ⋯ menu (DataTable action dropdown). */
function openRowMenu(id: string) {
  const row = screen.getByTestId(`specialty-row-${id}`);
  fireEvent.click(within(row).getByRole('button', { name: /^Действия/ }));
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  setupEnvelope();
  mockCreateSpecialty.mockResolvedValue(createMockSpecialtyResponse({ id: 'new-1' }));
  mockPatchSpecialty.mockResolvedValue({ ...mockSpecialtyPainting, title: 'Пленэр' });
  // The delete flow dry-runs first — 404 drives the generic error toast
  // cases in this file; the 409 dialog paths live in the flow test file.
  mockDryRunDeleteSpecialty.mockRejectedValue(
    new ApiError(404, 'Направление не найдено', 'SPECIALTY_NOT_FOUND'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpecialtiesTable — list rendering', () => {
  it('renders the dictionary rows with stable row testids', async () => {
    await renderLoaded();

    expect(screen.getByText('Живопись')).toBeInTheDocument();
    expect(screen.getByText('Керамика')).toBeInTheDocument();
    expect(screen.getByTestId('specialty-row-spec-painting')).toBeInTheDocument();
    expect(screen.getByTestId('specialty-row-spec-ceramics')).toBeInTheDocument();
  });

  it('shows the empty state when the dictionary is empty', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();

    await screen.findByText('Нет записей');
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });

  it('shows ErrorState when the fetch fails', async () => {
    mockGetSpecialties.mockRejectedValue(new Error('boom'));
    renderTable();

    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
  });

  it('initial fetch sends page/per_page only — NO sort, NO status, NO q', async () => {
    await renderLoaded();

    expect(mockGetSpecialties).toHaveBeenCalledTimes(1);
    expect(mockGetSpecialties).toHaveBeenCalledWith({ page: 1, per_page: 10 });
    expect(mockGetSpecialties.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetSpecialties.mock.calls[0][0]).not.toHaveProperty('status');
    expect(mockGetSpecialties.mock.calls[0][0]).not.toHaveProperty('q');
  });

  it('no column is sortable — the specialties list has no sort whitelist', async () => {
    await renderLoaded();

    for (const th of screen.getAllByRole('columnheader')) {
      expect(th.textContent).not.toContain('↕');
      expect(th.textContent).not.toContain('↑');
    }
  });
});

describe('SpecialtiesTable — create', () => {
  it('opens the create modal from «+ Добавить направление» and closes it on Отмена', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить направление'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Новое направление')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Название', { exact: false })).toHaveValue('');

    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockCreateSpecialty).not.toHaveBeenCalled();
  });

  it('submits the title to POST and toasts success', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить направление'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название', { exact: false }), {
      target: { value: 'Скетчинг' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockCreateSpecialty).toHaveBeenCalledWith({ title: 'Скетчинг' });
    });
    expect(mockShowToast).toHaveBeenCalledWith('Направление создано');
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['specialties'] });
  });

  it('blocks an empty title client-side (required field) — no POST', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить направление'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Сохранить'));

    expect(within(dialog).getByText('Обязательное поле')).toBeInTheDocument();
    expect(mockCreateSpecialty).not.toHaveBeenCalled();
  });

  it('409 SPECIALTY_TITLE_TAKEN → error toast (spec §7 scenario 3)', async () => {
    // The backend message is the spec's collision surface — a case-variant
    // duplicate of an existing title («живопись» vs «Живопись»). The
    // PositionModal образец contract: the table handler owns the error
    // surface (toast), the modal closes after the settled submit.
    mockCreateSpecialty.mockRejectedValue(
      new ApiError(409, 'Направление с таким названием уже существует', 'SPECIALTY_TITLE_TAKEN'),
    );
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить направление'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название', { exact: false }), {
      target: { value: 'живопись' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Направление с таким названием уже существует',
        'error',
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('SpecialtiesTable — rename (PATCH is the rename surface)', () => {
  it('clicking a row opens the edit modal prefilled with the current title', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('specialty-row-spec-painting'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Редактирование направления')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Название', { exact: false })).toHaveValue('Живопись');
  });

  it('renames via PATCH {title} and toasts success', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('specialty-row-spec-painting'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название', { exact: false }), {
      target: { value: 'Пленэр' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockPatchSpecialty).toHaveBeenCalledWith('spec-painting', { title: 'Пленэр' });
    });
    expect(mockShowToast).toHaveBeenCalledWith('Направление обновлено');
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['specialties'] });
  });

  it('blocks an empty rename client-side (required field) — no PATCH', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('specialty-row-spec-ceramics'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название', { exact: false }), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    expect(within(dialog).getByText('Обязательное поле')).toBeInTheDocument();
    expect(mockPatchSpecialty).not.toHaveBeenCalled();
  });

  it('409 SPECIALTY_TITLE_TAKEN on rename → error toast (positions образец contract)', async () => {
    mockPatchSpecialty.mockRejectedValue(
      new ApiError(409, 'Направление с таким названием уже существует', 'SPECIALTY_TITLE_TAKEN'),
    );
    await renderLoaded();

    fireEvent.click(screen.getByTestId('specialty-row-spec-painting'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название', { exact: false }), {
      target: { value: 'Керамика' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Направление с таким названием уже существует',
        'error',
      );
    });
  });
});

describe('SpecialtiesTable — delete entry (deferred pipeline)', () => {
  it('«Удалить» drives the deferred hook — NO window.confirm, no instant DELETE', async () => {
    await renderLoaded();

    openRowMenu('spec-ceramics');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Не найдено', 'error');
    });
  });
});
