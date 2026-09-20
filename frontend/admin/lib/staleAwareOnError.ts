/**
 * Shared commit-failure handler for the deferred-delete pipeline (#285 D4 rev8
 * → #286 D7 parameterization): one helper per error surface instead of a copy
 * per consumer. The entity name selects the invalidation target — it MUST be a
 * key of INVALIDATION_MAP (lib/invalidate.ts), e.g. staleAwareOnError(qc,
 * 'records', …) from useDeleteRecord, staleAwareOnError(qc, 'activities', …)
 * from ScheduleDataContext.
 *
 * Branches (D7 spec):
 * - 409 + dependencies (mid-window expected mismatch — the only 409-with-deps
 *   the commit path can receive): undo the optimistic removal and surface the
 *   honest error toast «Не удалось удалить: данные изменились» with the
 *   «Обновить» action (lifetime-bound action slot; NOT an undo button) that
 *   invalidates the entity's family via the shared #239 map.
 * - 404: quiet success — DELETE is idempotent, a competitor already deleted
 *   the target and the commit goal is achieved. (The PendingActions pipeline
 *   normally returns early on 404 before onError; this branch guards direct
 *   callers and keeps the contract in one place.)
 * - Any other error: context-default surface — undo + honest toast: an
 *   ApiError (server answered) → «Не удалось удалить. Изменение отменено»;
 *   a non-ApiError (server never answered) → «Не удалось подтвердить
 *   удаление» (#243 S3, same one-branch distinction as the default handler).
 */
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@memo/api-client';
import type { EntityName } from '@/lib/invalidate';
import { invalidateEntities } from '@/lib/invalidate';
import type { useUI } from '@/contexts/UIContext';

/** Toast shower type derived from the UI context (type-only — no runtime dep). */
type ShowToast = ReturnType<typeof useUI>['showToast'];

export function staleAwareOnError(
  qc: QueryClient,
  entity: EntityName,
  undo: () => void,
  showToast: ShowToast,
): (err: unknown) => void {
  return (err: unknown) => {
    // 404 — quiet success: the target is already gone, nothing to undo.
    if (err instanceof ApiError && err.status === 404) return;
    if (err instanceof ApiError && err.status === 409 && err.dependencies) {
      undo();
      showToast(
        'Не удалось удалить: данные изменились',
        'error',
        undefined,
        undefined,
        {
          label: 'Обновить',
          onAction: () => invalidateEntities(qc, [entity]),
        },
      );
      return;
    }
    // Non-409/404 — the context-default surface (undo + honest toast, #243
    // S3): an ApiError means the server answered with an error — the
    // deletion is cancelled. A non-ApiError (network failure, abort,
    // timeout) means the server never answered: the deletion outcome is
    // UNKNOWN, so the toast must not claim «Изменение отменено».
    undo();
    if (err instanceof ApiError) {
      showToast('Не удалось удалить. Изменение отменено', 'error');
    } else {
      showToast('Не удалось подтвердить удаление', 'error');
    }
  };
}
