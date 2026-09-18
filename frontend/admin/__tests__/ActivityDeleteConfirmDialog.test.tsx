/**
 * #286 Task 5 — ActivityDeleteConfirmDialog (minimal inline confirm).
 *
 * Task 6 swaps the internals for the full DeleteDialog (entityType 'activity'
 * + banner); THIS task owns the pending-confirm MECHANISM: the state lives in
 * ScheduleDataContext, so the dialog renders at WeekView/DayView level and
 * survives the card/modal unmount. Testids mirror DeleteDialog conventions so
 * Task 7's e2e assertions stay stable across the swap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ActivityDeleteConfirmDialog } from '../app/components/schedule/ActivityDeleteConfirmDialog';
import { createMockScheduleData } from './helpers/mockContexts';
import type { DependencyNode } from '@memo/api-client';

vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(),
}));

import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';

const mockUseScheduleData = vi.mocked(useScheduleData);

const DEPS: DependencyNode[] = [
  {
    entity: 'records', relation: 'records', count: 1, allowed_actions: [],
    items: [{ id: 'r1', label: 'Картина маслом, 2026-09-14, Аноним' }],
  },
  {
    entity: 'visits', relation: 'records', count: 1, allowed_actions: [],
    items: [{ id: 'v1', label: 'Картина маслом, 1000' }],
  },
  { entity: 'activity_tags', relation: 'activity_tags', count: 2, allowed_actions: [] },
];

const PENDING = {
  activityId: 'a1',
  dependencies: DEPS,
  refetched: false,
};

beforeEach(() => {
  mockUseScheduleData.mockReturnValue(createMockScheduleData());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActivityDeleteConfirmDialog (#286 pending-confirm mechanism)', () => {
  it('renders NOTHING when the context holds no pending confirm', () => {
    render(<ActivityDeleteConfirmDialog />);
    expect(screen.queryByTestId('delete-dialog-overlay')).not.toBeInTheDocument();
  });

  it('renders the dialog with dependency lines when a confirm is pending', () => {
    mockUseScheduleData.mockReturnValue(
      createMockScheduleData({ pendingActivityConfirm: PENDING }),
    );
    render(<ActivityDeleteConfirmDialog />);

    expect(screen.getByTestId('delete-dialog-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('delete-dialog-title')).toHaveTextContent('Удаление занятия');
    expect(screen.getByTestId('dep-records')).toHaveTextContent('records: 1');
    expect(screen.getByTestId('dep-visits')).toHaveTextContent('visits: 1');
    expect(screen.getByTestId('dep-activity_tags')).toHaveTextContent('activity_tags: 2');
  });

  it('confirm → deleteActivityConfirmed(activityId, dependencies) + state cleared', async () => {
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

    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => {
      expect(deleteActivityConfirmed).toHaveBeenCalledTimes(1);
    });
    expect(deleteActivityConfirmed).toHaveBeenCalledWith('a1', DEPS);
    // Cleared exactly once, after the enqueue handed off to the pipeline.
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
