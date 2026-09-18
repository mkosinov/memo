'use client';

import { useEffect } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import { parseApiError } from '@/app/lib/api/parseApiError';

// ─── ActivityDeleteConfirmDialog (#286 Task 5 — minimal inline confirm) ───────
//
// The pending-confirm MECHANISM lives here: ScheduleDataContext holds
// `pendingActivityConfirm` (set by ActivityCard / ActivityDetailsModal on the
// needs-confirm dry-run outcome), and THIS component renders the dialog at
// WeekView/DayView level — so it survives the card's optimistic unmount and
// the modal's immediate close.
//
// Task 6 swaps the internals for the full DeleteDialog (entityType 'activity'
// + refetched banner + items one-liners); the contract —
// confirm → deleteActivityConfirmed(activityId, dependencies) + clear,
// dismiss → clear only — stays identical, and the data-testids below mirror
// DeleteDialog's conventions so Task 7's e2e assertions survive the swap.
//
// For activities every dependency is a cascade (allowed_actions == []) —
// there are no choice checkboxes and no archive branch (Task 6: Mode B
// unreachable); the enqueue is synchronous, so the busy/error branches of the
// full dialog are never engaged.

export function ActivityDeleteConfirmDialog() {
  const {
    pendingActivityConfirm,
    deleteActivityConfirmed,
    setPendingActivityConfirm,
  } = useScheduleData();
  const { showToast } = useUI();

  useEffect(() => {
    if (!pendingActivityConfirm) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPendingActivityConfirm(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingActivityConfirm, setPendingActivityConfirm]);

  if (!pendingActivityConfirm) return null;

  const { activityId, dependencies } = pendingActivityConfirm;

  const handleConfirm = (): void => {
    // Snapshot first, clear, then enqueue — the dialog closes instantly (the
    // enqueue is fire-and-forget into the PendingActions pipeline; its own
    // error path staleAwareOnError owns commit-failure recovery). An EARLY
    // rejection (before the enqueue lands) surfaces via the same call-site
    // error path as the card/modal — default error toast, dialog stays closed.
    setPendingActivityConfirm(null);
    deleteActivityConfirmed(activityId, dependencies).catch((err) => {
      showToast(parseApiError(err).message, 'error');
    });
  };

  const handleDismiss = (): void => setPendingActivityConfirm(null);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid="delete-dialog-overlay"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        data-testid="delete-dialog-backdrop"
        onClick={handleDismiss}
      />
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl px-5 py-4"
        style={{ backgroundColor: 'var(--white)' }}
        data-testid="delete-dialog"
      >
        <h2
          className="text-sm font-semibold truncate"
          style={{ color: 'var(--ink)' }}
          data-testid="delete-dialog-title"
        >
          Удаление занятия
        </h2>
        <p className="text-sm mt-3" style={{ color: 'var(--ink)' }}>
          Будет выполнено:
        </p>
        <ul className="flex flex-col gap-1.5 my-2">
          {dependencies.map((dep) => (
            <li
              key={dep.entity}
              className="text-sm"
              style={{ color: 'var(--ink-mid)' }}
              data-testid={`dep-${dep.entity}`}
            >
              {/* Minimal rendering — the raw entity + count. Task 6's
                  DeleteDialog replaces this with relation labels + item
                  one-liners («Записи — будут удалены:»). */}
              {`${dep.entity}: ${dep.count} — будут удалены`}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 mt-3">
          <button
            data-testid="delete-dialog-cancel-btn"
            onClick={handleDismiss}
            className="px-4 py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            Отмена
          </button>
          <button
            data-testid="delete-dialog-confirm-btn"
            onClick={handleConfirm}
            className="px-4 py-2 text-sm rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--danger)' }}
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
