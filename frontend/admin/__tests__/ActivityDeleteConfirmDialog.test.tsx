/**
 * #286 Task 6 — ActivityDeleteConfirmDialog: thin wrapper hosting the shared
 * DeleteDialog (entityType 'activity').
 *
 * The pending-confirm MECHANISM (Task 5) is unchanged: ScheduleDataContext
 * holds `pendingActivityConfirm`, the wrapper renders at WeekView/DayView
 * level so it survives the card's optimistic unmount and the modal's close.
 * Task 6 swaps the minimal dialog for the full DeleteDialog (spec D3):
 *   * relation-label item one-liners («Записи — будут удалены:», cap 10 +
 *     «и ещё N» — display only; the confirm keeps the FULL id lists);
 *   * auto deps (photos/activity_tags) NOT rendered (spec §4 — implicit
 *     cascade, never confirmed);
 *   * refetched → banner «Карточка обновлена по данным сервера»;
 *   * the single entity-level confirm checkbox (same as records, D9в #285);
 *   * confirm = synchronous enqueue — busy/error dialog branches never
 *     engage (rejections surface as the call-site error toast, dialog closed);
 *   * Mode B (blocked/archive) never renders — every activity dep carries
 *     allowed_actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActivityDeleteConfirmDialog } from '../app/components/schedule/ActivityDeleteConfirmDialog';
import { createMockScheduleData, createMockUIContext } from './helpers/mockContexts';
import type { DependencyNode } from '@memo/api-client';

vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';

const mockUseScheduleData = vi.mocked(useScheduleData);
const mockUseUI = vi.mocked(useUI);

// Live dry-run tree shape — mirrors backend collect_dependencies(Activity):
// cascade nodes with items + auto nodes (photos/activity_tags) without.
// allowed_actions/auto mirror deletion.py FK_MATRIX (records НЕ auto;
// photos nullify auto; activity_tags cascade auto; second-level
// visits/payments non-auto cascade).
const DEPS: DependencyNode[] = [
  {
    entity: 'records', relation: 'Запись', count: 2,
    allowed_actions: ['cascade'], auto: false,
    items: [
      { id: 'r1', label: 'Картина маслом, 2026-09-14, Аноним' },
      { id: 'r2', label: 'Гончарное дело, 2026-09-15, Иван' },
    ],
  },
  {
    entity: 'visits', relation: 'Посещение', count: 2,
    allowed_actions: ['cascade'], auto: false,
    items: [
      { id: 'v1', label: 'Картина маслом, 1000' },
      { id: 'v2', label: 'Гончарное дело, 1500' },
    ],
  },
  {
    entity: 'payments', relation: 'Платёж', count: 1,
    allowed_actions: ['cascade'], auto: false,
    items: [{ id: 'p1', label: '1000, карта' }],
  },
  { entity: 'photos', relation: 'Фото', count: 1, allowed_actions: ['nullify'], auto: true },
  { entity: 'activity_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], auto: true },
];

const PENDING = {
  activityId: 'a1',
  dependencies: DEPS,
  refetched: false,
};

/** Toggle the single entity-level confirm checkbox (same as the records dialog). */
function toggleConfirm(): void {
  fireEvent.click(screen.getByTestId('delete-dialog-confirm-checkbox'));
}

beforeEach(() => {
  mockUseScheduleData.mockReturnValue(createMockScheduleData());
  mockUseUI.mockReturnValue(createMockUIContext());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActivityDeleteConfirmDialog (#286 Task 6 — DeleteDialog host)', () => {
  it('renders NOTHING when the context holds no pending confirm', () => {
    render(<ActivityDeleteConfirmDialog />);
    expect(screen.queryByTestId('delete-dialog-overlay')).not.toBeInTheDocument();
  });

  it('renders the DeleteDialog with item one-liners; auto deps are NOT rendered', () => {
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ pendingActivityConfirm: PENDING }),
    );
    render(<ActivityDeleteConfirmDialog />);

    // Task 5 testid contract preserved (overlay/title/dep-{entity}/buttons).
    expect(screen.getByTestId('delete-dialog-overlay')).toBeInTheDocument();
    // The pending-confirm state carries only the id — plain genitive title.
    expect(screen.getByTestId('delete-dialog-title')).toHaveTextContent('Удаление занятия');

    // Records node renders the spec D3 group: «Записи — будут удалены:» + lines.
    expect(screen.getByTestId('dep-records')).toHaveTextContent('Записи — будут удалены:');
    expect(screen.getByText('Картина маслом, 2026-09-14, Аноним')).toBeInTheDocument();
    expect(screen.getByText('Гончарное дело, 2026-09-15, Иван')).toBeInTheDocument();
    expect(screen.getByTestId('dep-visits')).toHaveTextContent('Посещения — будут удалены:');
    expect(screen.getByTestId('dep-payments')).toHaveTextContent('Платежи — будут удалены:');
    expect(screen.getByText('1000, карта')).toBeInTheDocument();

    // Spec §4: auto deps (photos/activity_tags) are implicit cascades —
    // not rendered and not confirmed.
    expect(screen.queryByTestId('dep-photos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dep-activity_tags')).not.toBeInTheDocument();
    expect(screen.queryByText(/Фото:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Теги:/)).not.toBeInTheDocument();

    // Mode B (blocked/archive) never renders — every activity dep resolves.
    expect(screen.queryByText('Архивировать')).not.toBeInTheDocument();
  });

  it('no per-record choice controls — the single entity-level checkbox only', () => {
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ pendingActivityConfirm: PENDING }),
    );
    render(<ActivityDeleteConfirmDialog />);

    // Item lines are informational — the only checkbox is the confirm gate.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('Подтверждаю удаление зависимостей')).toBeInTheDocument();
    expect(screen.getByTestId('dep-records').querySelector('input')).toBeNull();
  });

  it('refetched=true → banner «Карточка обновлена по данным сервера»; clean prime → no banner', () => {
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ pendingActivityConfirm: { ...PENDING, refetched: true } }),
    );
    render(<ActivityDeleteConfirmDialog />);
    expect(screen.getByTestId('delete-dialog-refetch-note')).toHaveTextContent(
      'Карточка обновлена по данным сервера',
    );
  });

  it('refetched=false renders no banner (the clean path has no notice)', () => {
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ pendingActivityConfirm: PENDING }),
    );
    render(<ActivityDeleteConfirmDialog />);
    expect(screen.queryByTestId('delete-dialog-refetch-note')).not.toBeInTheDocument();
  });

  it('caps the item lines at 10 + «и ещё N», but confirm keeps the FULL id lists', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i + 1}`,
      label: `Запись ${i + 1}`,
    }));
    const deps12: DependencyNode[] = [
      {
        entity: 'records', relation: 'Запись', count: 12,
        allowed_actions: ['cascade'], auto: false, items: twelve,
      },
    ];
    const deleteActivityConfirmed = vi.fn(() => Promise.resolve());
    const setPendingActivityConfirm = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        pendingActivityConfirm: { activityId: 'a1', dependencies: deps12, refetched: false },
        deleteActivityConfirmed,
        setPendingActivityConfirm,
      }),
    );
    render(<ActivityDeleteConfirmDialog />);

    // First 10 labels visible; beyond the cap — the «и ещё 2» tail only.
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByText(`Запись ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText('Запись 11')).not.toBeInTheDocument();
    expect(screen.getByText('и ещё 2')).toBeInTheDocument();

    // Confirm is checkbox-gated (entity-level, same as records).
    expect(screen.getByTestId('delete-dialog-confirm-btn')).toBeDisabled();
    toggleConfirm();
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    // «Фронт держит полный список id для expected» — the display-cap is
    // cosmetics; the enqueue receives the untouched dependencies tree.
    await waitFor(() => {
      expect(deleteActivityConfirmed).toHaveBeenCalledTimes(1);
    });
    expect(deleteActivityConfirmed).toHaveBeenCalledWith('a1', deps12);
    expect(setPendingActivityConfirm).toHaveBeenCalledWith(null);
  });

  it('confirm (checkbox → btn) → deleteActivityConfirmed(activityId, dependencies) + state cleared', async () => {
    const deleteActivityConfirmed = vi.fn(() => Promise.resolve());
    const setPendingActivityConfirm = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        pendingActivityConfirm: PENDING,
        deleteActivityConfirmed,
        setPendingActivityConfirm,
      }),
    );
    render(<ActivityDeleteConfirmDialog />);

    // Unchecked — the entity-level gate holds, nothing is enqueued.
    expect(screen.getByTestId('delete-dialog-confirm-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));
    expect(deleteActivityConfirmed).not.toHaveBeenCalled();

    toggleConfirm();
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => {
      expect(deleteActivityConfirmed).toHaveBeenCalledTimes(1);
    });
    expect(deleteActivityConfirmed).toHaveBeenCalledWith('a1', DEPS);
    // The dialog closes via onDone (state cleared once — no invalidation).
    expect(setPendingActivityConfirm).toHaveBeenCalledTimes(1);
    expect(setPendingActivityConfirm).toHaveBeenCalledWith(null);
  });

  it('enqueue rejection → error toast, dialog STAYS closed (state cleared once)', async () => {
    const deleteActivityConfirmed = vi.fn(() => Promise.reject(new Error('boom')));
    const setPendingActivityConfirm = vi.fn();
    const showToast = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        pendingActivityConfirm: PENDING,
        deleteActivityConfirmed,
        setPendingActivityConfirm,
      }),
    );
    mockUseUI.mockReturnValue(createMockUIContext({ showToast }));
    render(<ActivityDeleteConfirmDialog />);

    toggleConfirm();
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledTimes(1);
    });
    // Same call-site error path as the card/modal (parseApiError → error toast);
    // the busy/error branches of the dialog never engage.
    expect(showToast).toHaveBeenCalledWith('Неизвестная ошибка', 'error');
    // No re-open: the dismiss happened once (onDone after the swallowed enqueue).
    expect(setPendingActivityConfirm).toHaveBeenCalledTimes(1);
    expect(setPendingActivityConfirm).toHaveBeenCalledWith(null);
  });

  it('cancel (Отмена) → state cleared, NO delete call', () => {
    const deleteActivityConfirmed = vi.fn();
    const setPendingActivityConfirm = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        pendingActivityConfirm: PENDING,
        deleteActivityConfirmed,
        setPendingActivityConfirm,
      }),
    );
    render(<ActivityDeleteConfirmDialog />);

    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    expect(deleteActivityConfirmed).not.toHaveBeenCalled();
    expect(setPendingActivityConfirm).toHaveBeenCalledWith(null);
  });

  it('Escape dismisses the dialog without deleting', () => {
    const deleteActivityConfirmed = vi.fn();
    const setPendingActivityConfirm = vi.fn();
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({
        pendingActivityConfirm: PENDING,
        deleteActivityConfirmed,
        setPendingActivityConfirm,
      }),
    );
    render(<ActivityDeleteConfirmDialog />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(deleteActivityConfirmed).not.toHaveBeenCalled();
    expect(setPendingActivityConfirm).toHaveBeenCalledWith(null);
  });
});
