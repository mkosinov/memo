import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mockPositionMaster,
  mockPositionAdmin,
  mockPositionSmm,
  mockPositions,
  createMockPositionResponse,
} from '../helpers/mockData';
import type { PaginatedResponse, PositionResponse } from '@memo/api-client';

// ─── Mocks ───────────────────────────────────────────────────────────────
// useQuery/QueryClientProvider stay REAL: the table renders inside the real
// PositionsProvider and the server-pagination wiring is asserted through the
// getPositions spy (TagsTable precedent). Only useQueryClient is stubbed so the
// invalidation spy is shared with the mutation hooks. PositionModal is NOT
// stubbed — the create/rename submit paths are driven through the real form.

const mockShowToast = vi.fn();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
  };
});

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPositions: vi.fn(),
    createPosition: vi.fn(),
    updatePosition: vi.fn(),
    deletePosition: vi.fn(),
  };
});

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

// ─── Imports after mocks ─────────────────────────────────────────────────

import {
  getPositions,
  createPosition,
  updatePosition,
  deletePosition,
  ApiError,
} from '@memo/api-client';
import { PositionsTable } from '@/app/(main)/positions/components/PositionsTable';
import { PositionsProvider } from '@/contexts/PositionsContext';

const mockGetPositions = vi.mocked(getPositions);
const mockCreatePosition = vi.mocked(createPosition);
const mockUpdatePosition = vi.mocked(updatePosition);
const mockDeletePosition = vi.mocked(deletePosition);

function setupEnvelope(overrides: Partial<PaginatedResponse<PositionResponse>> = {}) {
  mockGetPositions.mockResolvedValue({
    items: mockPositions,
    total: mockPositions.length,
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
      <PositionsProvider>
        <PositionsTable />
      </PositionsProvider>
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Мастер');
  return view;
}

/** Open the row's ⋯ menu (DataTable action dropdown). */
function openRowMenu(id: string) {
  const row = screen.getByTestId(`position-row-${id}`);
  fireEvent.click(within(row).getByRole('button', { name: /^Действия/ }));
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  setupEnvelope();
  mockCreatePosition.mockResolvedValue(createMockPositionResponse({ id: 'new-1' }));
  mockUpdatePosition.mockResolvedValue({ ...mockPositionMaster, title: 'Ведущий мастер' });
  mockDeletePosition.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PositionsTable — list rendering', () => {
  it('renders the seed dictionary rows with stable row testids', async () => {
    await renderLoaded();

    expect(screen.getByText('Мастер')).toBeInTheDocument();
    expect(screen.getByText('Администратор')).toBeInTheDocument();
    expect(screen.getByText('СММ')).toBeInTheDocument();
    expect(screen.getByTestId('position-row-master')).toBeInTheDocument();
    expect(screen.getByTestId('position-row-smm')).toBeInTheDocument();
  });

  it('shows the empty state when the dictionary is empty', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();

    await screen.findByText('Нет записей');
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });

  it('shows ErrorState when the fetch fails', async () => {
    mockGetPositions.mockRejectedValue(new Error('boom'));
    renderTable();

    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
  });

  it('initial fetch sends page/per_page only — NO sort, NO status, NO q', async () => {
    await renderLoaded();

    expect(mockGetPositions).toHaveBeenCalledTimes(1);
    expect(mockGetPositions).toHaveBeenCalledWith({ page: 1, per_page: 10 });
    expect(mockGetPositions.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetPositions.mock.calls[0][0]).not.toHaveProperty('status');
    expect(mockGetPositions.mock.calls[0][0]).not.toHaveProperty('q');
  });
});

describe('PositionsTable — built-in vs user-defined (D4)', () => {
  it('badges a built-in row as «Встроенная» and a user-defined row as «Пользовательская»', async () => {
    await renderLoaded();

    expect(
      within(screen.getByTestId('position-row-master')).getByText('Встроенная'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('position-row-smm')).getByText('Пользовательская'),
    ).toBeInTheDocument();
  });

  it('badges BOTH built-ins (master + admin) as «Встроенная»', async () => {
    await renderLoaded();

    expect(
      within(screen.getByTestId('position-row-admin')).getByText('Встроенная'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Встроенная')).toHaveLength(2);
  });

  it('is_system decides the badge, never the title (the anchor is the flag/id)', async () => {
    setupEnvelope({
      items: [
        createMockPositionResponse({ id: 'master', title: 'Ведущий мастер', is_system: true }),
        createMockPositionResponse({ id: 'x-1', title: 'Встроенная', is_system: false }),
      ],
      total: 2,
    });
    renderTable();

    await screen.findByText('Ведущий мастер');
    // The renamed built-in is STILL a built-in…
    expect(
      within(screen.getByTestId('position-row-master')).getByText('Встроенная'),
    ).toBeInTheDocument();
    // …and the user-defined row merely TITLED «Встроенная» is not one.
    expect(
      within(screen.getByTestId('position-row-x-1')).getByText('Пользовательская'),
    ).toBeInTheDocument();
  });

  it('no column is sortable — the backend positions list has no sort whitelist', async () => {
    await renderLoaded();

    for (const th of screen.getAllByRole('columnheader')) {
      expect(th.textContent).not.toContain('↕');
      expect(th.textContent).not.toContain('↑');
    }
  });
});

describe('PositionsTable — create', () => {
  it('opens the create modal from «+ Добавить должность» and closes it on Отмена', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить должность'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Новая должность')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Должность', { exact: false })).toHaveValue('');

    fireEvent.click(within(dialog).getByText('Отмена'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockCreatePosition).not.toHaveBeenCalled();
  });

  it('submits the title to POST and toasts success', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить должность'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: 'СММ-менеджер' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockCreatePosition).toHaveBeenCalledWith({ title: 'СММ-менеджер' });
    });
    expect(mockShowToast).toHaveBeenCalledWith('Должность создана');
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['positions'] });
  });

  it('blocks an empty title client-side (required field) — no POST', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить должность'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Сохранить'));

    expect(within(dialog).getByText('Обязательное поле')).toBeInTheDocument();
    expect(mockCreatePosition).not.toHaveBeenCalled();
  });

  it('surfaces an API failure as an error toast', async () => {
    mockCreatePosition.mockRejectedValue(
      new ApiError(422, 'Проверьте правильность заполнения полей', 'VALIDATION_ERROR'),
    );
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить должность'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: 'х'.repeat(101) },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Проверьте правильность заполнения полей',
        'error',
      );
    });
  });
});

describe('PositionsTable — rename (title freely editable, D4)', () => {
  it('clicking a row opens the edit modal prefilled with the current title', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('position-row-master'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Редактирование должности')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Должность', { exact: false })).toHaveValue('Мастер');
  });

  it('renames a BUILT-IN via PUT {title} and toasts success (D4: title свободен)', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('position-row-master'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: 'Ведущий мастер' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockUpdatePosition).toHaveBeenCalledWith('master', {
        title: 'Ведущий мастер',
      });
    });
    expect(mockShowToast).toHaveBeenCalledWith('Должность обновлена');
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['positions'] });
  });

  it('renames a user-defined position the same way', async () => {
    await renderLoaded();

    openRowMenu('smm');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: 'SMM-менеджер' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockUpdatePosition).toHaveBeenCalledWith('smm', { title: 'SMM-менеджер' });
    });
  });

  it('PUT never carries is_system — the built-in flag is owned by the dictionary', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('position-row-admin'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: 'Админ' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    await waitFor(() => {
      expect(mockUpdatePosition).toHaveBeenCalled();
    });
    expect(mockUpdatePosition.mock.calls[0][1]).toEqual({ title: 'Админ' });
    expect(mockUpdatePosition.mock.calls[0][1]).not.toHaveProperty('is_system');
  });

  it('blocks an empty rename client-side (required field) — no PUT', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('position-row-master'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    expect(within(dialog).getByText('Обязательное поле')).toBeInTheDocument();
    expect(mockUpdatePosition).not.toHaveBeenCalled();
  });

  it('surfaces a rename failure as an error toast', async () => {
    mockUpdatePosition.mockRejectedValue(
      new ApiError(404, 'Должность не найдена', 'POSITION_NOT_FOUND'),
    );
    await renderLoaded();

    fireEvent.click(screen.getByTestId('position-row-master'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Должность', { exact: false }), {
      target: { value: 'Ведущий' },
    });
    fireEvent.click(within(dialog).getByText('Сохранить'));

    // POSITION_NOT_FOUND maps to the project-wide generic 404 copy (same as
    // TAG/LOCATION/MATERIAL) — parseApiError CODE_DEFAULTS.
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Не найдено', 'error');
    });
  });
});

describe('PositionsTable — delete (D4: built-ins refused server-side)', () => {
  it('deletes a user-defined position after the confirm dialog', async () => {
    await renderLoaded();

    openRowMenu('smm');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => {
      expect(mockDeletePosition).toHaveBeenCalledWith('smm');
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Должность удалена');
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['positions'] });
  });

  it('does NOT call delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderLoaded();

    openRowMenu('smm');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
    });
    expect(mockDeletePosition).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('surfaces the POSITION_IS_SYSTEM explanation as an error toast for a built-in', async () => {
    // The backend enforces D4: 422 + POSITION_IS_SYSTEM.
    mockDeletePosition.mockRejectedValue(
      new ApiError(422, 'Встроенная должность не удаляется', 'POSITION_IS_SYSTEM'),
    );
    await renderLoaded();

    openRowMenu('master');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Встроенная должность не удаляется',
        'error',
      );
    });
    // The row stays — the dictionary was not touched, nothing invalidated.
    expect(screen.getByTestId('position-row-master')).toBeInTheDocument();
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it('exposes «Удалить» on a built-in row too — the server is the source of truth', async () => {
    await renderLoaded();

    openRowMenu('admin');

    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Переименовать' })).toBeInTheDocument();
  });

  it('shows the mapped message when DELETE fails for another reason', async () => {
    mockDeletePosition.mockRejectedValue(
      new ApiError(404, 'Должность не найдена', 'POSITION_NOT_FOUND'),
    );
    setupEnvelope({
      items: [mockPositionSmm, mockPositionMaster, mockPositionAdmin],
      total: 3,
    });
    await renderLoaded();

    openRowMenu('smm');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    // POSITION_NOT_FOUND maps to the project-wide generic 404 copy (same as
    // TAG/LOCATION/MATERIAL) — parseApiError CODE_DEFAULTS.
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Не найдено', 'error');
    });
  });
});
