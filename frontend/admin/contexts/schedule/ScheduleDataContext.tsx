'use client';

import React, { createContext, useContext, useCallback, useMemo, useEffect, useRef, useState } from 'react';
import type { Master, Service, Location, ScheduleAdminDTO, ScheduleIndex as DomainScheduleIndex } from '@memo/domain';
import { buildSchedule } from '@memo/domain';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import type { MasterViewResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { useScheduleMasters } from '@/hooks/useMasters';
import { useScheduleServices } from '@/hooks/useServices';
import { useScheduleLocations } from '@/hooks/useLocations';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  getActivities,
  createActivity as apiCreateActivity,
  patchActivity as apiPatchActivity,
  dryRunDeleteActivity,
  deleteActivityWithExpected,
  copyWeek as apiCopyWeek,
  ApiError,
} from '@memo/api-client';
import type {
  ActivityResponse,
  ActivityPatch,
  CopyWeekResult,
  DependencyNode,
} from '@memo/api-client';
import { transformMaster, transformService, transformLocation } from '@/lib/transformers';
import { qk } from '@/lib/queryKeys';
import { invalidateEntities } from '@/lib/invalidate';
import {
  captureActivitySnapshots,
  removeActivityRows,
  restoreActivitySnapshots,
} from '@/lib/cache/activityCacheSync';
import { staleAwareOnError } from '@/lib/staleAwareOnError';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { useUI } from '@/contexts/UIContext';
import { composeLocalISO, dayIndexToDate, calculateGridTimeRange, toISODate } from '@/lib/datetime';
import { useScheduleView } from './ScheduleViewContext';
import { useUserSettings } from '@/contexts/UserSettingsContext';

// Mutation key shared by create/update — feeds the Topbar indicator
// via useMutationState (spec §5; no isSaving field on any context).
// #286 D6: the deferred delete is NOT a useMutation — the key (and the
// «Сохраняем…» indicator) covers create/update/copy only.
export const SCHEDULE_ACTIVITY_MUTATION_KEY = ['schedule-activity'] as const;

/** #286 D3 — outcome of `deleteActivityDeferred`: the clean path enqueues
 *  (undo toast via PendingActions), the 409 dry-run returns the dependency
 *  tree upward for the DeleteDialog (D9). `refetched` rides on both — the
 *  dialog shows the «Карточка обновлена» banner when true. */
export type DeleteActivityOutcome =
  | { kind: 'enqueued'; refetched: boolean }
  | { kind: 'needs-confirm'; dependencies: DependencyNode[]; refetched: boolean };

/** #286 Task 5 — pending-confirm dialog payload. The call sites (ActivityCard
 *  / ActivityDetailsModal) hand the needs-confirm outcome over via
 *  `setPendingActivityConfirm`; the confirm dialog renders at WeekView/DayView
 *  level and survives the card's optimistic unmount / the modal's immediate
 *  close. Cleared on dialog resolve/dismiss. */
export interface PendingActivityConfirm {
  activityId: string;
  dependencies: DependencyNode[];
  refetched: boolean;
}

/** Resolved staleTime for the week cache (D3 step 1): setQueryDefaults wins,
 *  then the app-level default (providers.tsx sets 30_000), else 0. */
function resolveStaleTime(qc: QueryClient, key: readonly unknown[]): number {
  const specific = qc.getQueryDefaults(key).staleTime;
  if (typeof specific === 'number') return specific;
  const fallback = qc.getDefaultOptions().queries?.staleTime;
  return typeof fallback === 'number' ? fallback : 0;
}

interface ScheduleDataProviderProps {
  children: React.ReactNode;
  // inputs from the composition (spec §3: data context is NOT independent):
  filterMasterIds: string[];
  filterLocationIds: string[];
  setFilterMasterIds: (ids: string[]) => void;
  setFilterLocationIds: (ids: string[]) => void;
  workingHoursStart: number;
  workingHoursEnd: number;
}

export interface ScheduleDataContextType {
  activities: ScheduleAdminDTO[];
  scheduleIndex: DomainScheduleIndex<ScheduleAdminDTO>;
  masters: Master[];
  services: Service[];
  locations: Location[];
  /** FULL schedule dictionaries incl. archived (GH #267) — grid build / DayView. */
  scheduleMasters: MasterViewResponse[];
  scheduleServices: ServiceResponse[];
  scheduleLocations: LocationResponse[];
  loading: boolean;
  error: Error | null;
  addActivity: (activity: {
    dayIndex: number;
    masterId: string;
    serviceId: string;
    locationId: string;
    startMinutes: number;
    durationMinutes: number;
    capacity: number;
    isPrivate?: boolean;
    comment?: string;
  }, callbacks?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => void;
  updateActivity: (id: string, updates: {
    dayIndex?: number;
    startMinutes?: number;
    durationMinutes?: number;
    masterId?: string;
    serviceId?: string;
    locationId?: string;
    capacity?: number;
    isPrivate?: boolean;
    comment?: string;
    occupied?: number;
  }) => void;
  deleteActivityDeferred: (id: string) => Promise<DeleteActivityOutcome>;
  /** #286 confirm path (DeleteDialog onResolve): enqueue with `expected` =
   *  the FULL id lists from the confirmed dry-run tree's items (all three
   *  nodes — records/visits/payments; auto nodes carry no items → skipped). */
  deleteActivityConfirmed: (id: string, dependencies: DependencyNode[]) => Promise<void>;
  /** #286 Task 5 — the pending-confirm dialog state. Call sites set it on the
   *  needs-confirm outcome; the view-level dialog (ActivityDeleteConfirmDialog)
   *  reads it, resolves via deleteActivityConfirmed or dismisses; both clear. */
  pendingActivityConfirm: PendingActivityConfirm | null;
  setPendingActivityConfirm: (pending: PendingActivityConfirm | null) => void;
  copyLastWeek: (weekStart: string, locations: string[]) => Promise<CopyWeekResult>;
  gridStartMinutes: number;
  gridEndMinutes: number;
}

const ScheduleDataContext = createContext<ScheduleDataContextType | null>(null);

export function ScheduleDataProvider({
  children,
  filterMasterIds,
  filterLocationIds,
  setFilterMasterIds,
  setFilterLocationIds,
  workingHoursStart,
  workingHoursEnd,
}: ScheduleDataProviderProps) {
  const queryClient = useQueryClient();
  const { enqueuePendingAction } = usePendingActions();
  const { showToast } = useUI();
  // #138 Task 2: the fetch range derives from the URL view state (week of
  // ?date) instead of NavigationContext. Same monday..sunday `YYYY-MM-DD`
  // strings as before → React Query keys and SSE invalidations (#239) are
  // byte-identical.
  const { currentWeek } = useScheduleView();
  const weekStart = useMemo(() => toISODate(currentWeek), [currentWeek]);
  const weekEnd = useMemo(() => {
    const sunday = new Date(currentWeek);
    sunday.setDate(sunday.getDate() + 6);
    return toISODate(sunday);
  }, [currentWeek]);
  // #286 Task 5: pending-confirm dialog state — plain useState; the state
  // lives in the provider so the dialog survives the card/modal unmount.
  const [pendingActivityConfirm, setPendingActivityConfirm] =
    useState<PendingActivityConfirm | null>(null);

  // #286 fix round: navigating resets the pending confirm — the dry-run tree
  // was fetched for the OLD week's data. Week AND day navigation both move
  // dateFrom (single-day range in day view), so `weekStart` covers both; a
  // week↔day switch within the same range keeps the dialog (still valid).
  useEffect(() => {
    setPendingActivityConfirm(null);
  }, [weekStart, setPendingActivityConfirm]);
  // dayIndex→date math (buildAdminSchedule, addActivity, updateActivity) uses
  // the URL-derived `currentWeek` directly — there is no separate week state.

  // Raw API data (activities use the week-range key; see GH #142). The
  // queryFn is a stable callback — the ensure-fresh fetchQuery (D3 step 1)
  // reuses the SAME source so the grid cache and the delete flow stay one.
  const fetchWeekActivities = useCallback(
    () => getActivities({ date_from: weekStart, date_to: weekEnd, per_page: 100 }).then(r => r.items),
    [weekStart, weekEnd],
  );
  const { data: activitiesRaw = [], isLoading: activitiesLoading, error: activitiesError } = useQuery<ActivityResponse[]>({
    queryKey: qk.activityRange(weekStart, weekEnd),
    queryFn: fetchWeekActivities,
  });

  // GH #267: the schedule owns its dictionary slices — FULL status=all lists on
  // the `* + 'schedule'` keys (own cache entries; prefix-invalidation from
  // lib/invalidate.ts / SSE reaches them via the shared family prefix).
  const { data: scheduleMasters = [], isSuccess: mastersSuccess } = useScheduleMasters();
  const { data: scheduleServices = [] } = useScheduleServices();
  const { data: scheduleLocations = [], isSuccess: locationsSuccess } = useScheduleLocations();

  // Domain slices for existing consumers — ACTIVE-only (archived dropped),
  // transformed to domain types. Referentially stable thanks to the memo deps.
  const masters = useMemo(
    () => scheduleMasters.filter((m) => !m.archived).map(transformMaster),
    [scheduleMasters],
  );
  const services = useMemo(
    () => scheduleServices.filter((s) => !s.archived).map(transformService),
    [scheduleServices],
  );
  const locations = useMemo(
    () => scheduleLocations.filter((l) => !l.archived).map(transformLocation),
    [scheduleLocations],
  );

  // ── Filter initialization — per-directory, settled-success, initialize-once ──
  // (spec §6; REPLACES the old both-non-empty gate that deadlocked on an empty
  // locations dictionary). Each directory initializes independently; an empty
  // dictionary ⇒ filters set to [] (renders as "show all").
  const filterMasterInitRef = useRef(false);
  const filterLocationInitRef = useRef(false);
  useEffect(() => {
    if (filterMasterInitRef.current || !mastersSuccess) return;
    filterMasterInitRef.current = true;
    setFilterMasterIds(masters.map((m) => m.id));
  }, [mastersSuccess, masters, setFilterMasterIds]);
  useEffect(() => {
    if (filterLocationInitRef.current || !locationsSuccess) return;
    filterLocationInitRef.current = true;
    setFilterLocationIds(locations.map((l) => l.id));
  }, [locationsSuccess, locations, setFilterLocationIds]);

  // Query key for cache invalidation — same shape as the query above (qk), so
  // optimistic setQueryData/cancelQueries/invalidateQueries keep hitting it.
  const activityQueryKey = qk.activityRange(weekStart, weekEnd);

  // Mutations. Only the stable callbacks are destructured (react-query v5:
  // `mutate` = useCallback over the once-created observer; `mutateAsync` =
  // result.mutate, the constructor-bound observer method — both keep their
  // identity across renders). The mutation RESULT OBJECT gets a new identity
  // every render, so deps must list the destructured callbacks, not the
  // objects — otherwise these useCallbacks (and the context value) would
  // churn on every provider re-render, breaking zoom isolation (DoD-1 /
  // spec §3).
  const { mutate: createActivityMutate } = useMutation({
    mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY,
    mutationFn: (data: Parameters<typeof apiCreateActivity>[0]) => apiCreateActivity(data),
    // Family rule via the shared map (#239): the ['activities'] prefix —
    // strictly wider than this week's activityRange key, also refreshes
    // activitiesForRecords readers.
    onSuccess: () => invalidateEntities(queryClient, ['activities']),
  });

  // THE race fix (spec §5): no artificial 5s timeout — the PATCH settles
  // naturally (success or real network error). The former timeout raced the
  // server-side write and rolled the optimistic UI back while the request kept
  // flying. onMutate/onError/onSettled below are verbatim from the old context.
  const { mutate: updateActivityMutate } = useMutation({
    mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY,
    mutationFn: ({ id, data }: { id: string; data: ActivityPatch }) => apiPatchActivity(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: activityQueryKey });

      // Snapshot current data
      const previousActivities = queryClient.getQueryData<ActivityResponse[]>(activityQueryKey);

      // Optimistic update: apply API-level fields to cache (ActivityResponse shape)
      queryClient.setQueryData<ActivityResponse[]>(activityQueryKey, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((activity) => {
          if (activity.id !== id) return activity;
          const patch: Partial<ActivityResponse> = {};
          if (data.start !== undefined) patch.start = data.start;
          if (data.master_id !== undefined) patch.master_id = data.master_id;
          if (data.service_id !== undefined) patch.service_id = data.service_id;
          if (data.location_id !== undefined) patch.location_id = data.location_id;
          if (data.duration !== undefined) patch.duration = data.duration;
          if (data.capacity !== undefined) patch.capacity = data.capacity;
          if (data.is_private !== undefined) patch.is_private = data.is_private;
          if (data.comment !== undefined) patch.comment = data.comment;
          if (data.occupied !== undefined) patch.occupied = data.occupied;
          return { ...activity, ...patch };
        });
      });

      return { previousActivities };
    },
    onError: (_err, _variables, context) => {
      // Restore snapshot on error — return a new array for immutability/re-render
      if (context?.previousActivities) {
        queryClient.setQueryData(activityQueryKey, [...(context.previousActivities as ActivityResponse[])]);
      }
    },
    onSettled: () => {
      // Always sync with server after mutation completes — family rule via
      // the shared map (#239), see the create mutation above. (The optimistic mechanics
      // above — cancelQueries/snapshot/setQueryData/restore — keep the exact
      // activityRange key on purpose; only the sync invalidation widens.)
      invalidateEntities(queryClient, ['activities']);
    },
  });

  // #286 D6: the plain deleteMutation is gone — the deferred flow owns the
  // DELETE (commit = direct api-client call + invalidation, like visits/
  // payments in useRecordMutations), so the «Сохраняем…» indicator never
  // lights up on deletes.

  // Week copy (#242, spec §7) — plain mutation, no optimistics: the copy is an
  // atomic server-side call. onSuccess invalidates the ['activities'] family
  // prefix (same rule as the create mutation); the per-week activityRange key is a
  // narrower member of that family, so the grid refetches via the prefix.
  const { mutateAsync: copyWeekMutateAsync } = useMutation({
    mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY,
    mutationFn: (params: Parameters<typeof apiCopyWeek>[0]) => apiCopyWeek(params),
    onSuccess: () => invalidateEntities(queryClient, ['activities']),
  });

  // Actions
  const addActivity = useCallback((activity: {
    dayIndex: number;
    masterId: string;
    serviceId: string;
    locationId: string;
    startMinutes: number;
    durationMinutes: number;
    capacity: number;
    isPrivate?: boolean;
    comment?: string;
  }, callbacks?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => {
    const start = composeLocalISO(dayIndexToDate(currentWeek, activity.dayIndex), activity.startMinutes);

    createActivityMutate({
      master_id: activity.masterId,
      service_id: activity.serviceId,
      location_id: activity.locationId,
      start,
      duration: activity.durationMinutes,
      capacity: activity.capacity,
      is_private: activity.isPrivate ?? false,
      comment: activity.comment ?? null,
      record_info: null,
    }, callbacks);
    // Dep is the STABLE `mutate` (v5 useCallback over the once-created
    // observer), not the mutation result object — that object gets a new
    // identity every render and would give the data context value a new
    // identity on every provider re-render, breaking zoom isolation
    // (DoD-1 / spec §3).
  }, [currentWeek, createActivityMutate]);

  const updateActivityFn = useCallback((id: string, updates: {
    dayIndex?: number;
    startMinutes?: number;
    durationMinutes?: number;
    masterId?: string;
    serviceId?: string;
    locationId?: string;
    capacity?: number;
    isPrivate?: boolean;
    comment?: string;
    occupied?: number;
  }) => {
    const payload: ActivityPatch = {};
    if (updates.masterId !== undefined) payload.master_id = updates.masterId;
    if (updates.serviceId !== undefined) payload.service_id = updates.serviceId;
    if (updates.locationId !== undefined) payload.location_id = updates.locationId;
    if (updates.durationMinutes !== undefined) payload.duration = updates.durationMinutes;
    if (updates.capacity !== undefined && updates.capacity !== null) payload.capacity = updates.capacity;
    if (updates.isPrivate !== undefined) payload.is_private = updates.isPrivate;
    if (updates.comment !== undefined) payload.comment = updates.comment;
    if (updates.occupied !== undefined) payload.occupied = updates.occupied;
    // Handle time changes (e.g., drag & drop) — dayIndex + startMinutes → floating-local start
    if (updates.dayIndex !== undefined && updates.startMinutes !== undefined) {
      payload.start = composeLocalISO(dayIndexToDate(currentWeek, updates.dayIndex), updates.startMinutes);
    }
    updateActivityMutate({ id, data: payload });
  }, [currentWeek, updateActivityMutate]);

  // ── Deferred activity delete (#286, D3/D4) ──────────────────────────────
  // The context owns the mechanics; ActivityCard/ActivityDetailsModal only
  // initiate. Shared enqueue body: cancelQueries → snapshot (every
  // ['activities'] family cache holding the row) → optimistic map-remove →
  // PendingActions pipeline (5s undo window; commit = deleteActivityWithExpected
  // + family invalidation; commit errors → staleAwareOnError('activities')).
  const enqueueOptimisticActivityDelete = useCallback(
    async (id: string, expected: Record<string, string[]>): Promise<void> => {
      const weekKey = qk.activityRange(weekStart, weekEnd);
      // D4: cancel in-flight week GETs and let them settle, so they can't
      // land after the removal and bring the card back into the cache
      // before the commit.
      await queryClient.cancelQueries({ queryKey: weekKey });
      const snapshots = captureActivitySnapshots(queryClient, id);
      removeActivityRows(queryClient, snapshots);
      // Undo (D4): pure replace-by-id restore of the captured row objects —
      // no server calls (the dry-run guarantees nothing was deleted), no
      // invalidations.
      const undo = () => restoreActivitySnapshots(queryClient, snapshots);
      enqueuePendingAction({
        id: `delete-activity-${id}`,
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        undo,
        commit: async () => {
          await deleteActivityWithExpected(id, { expected });
          try {
            // Family rule via the shared map (#239): ['activities'] covers
            // the week-range key + activitiesForRecords readers.
            invalidateEntities(queryClient, ['activities']);
          } catch {
            // Non-fatal (D4): server state after 204 is authoritative;
            // SSE / next load converge.
          }
        },
        // D7: the shared stale-aware handler parameterized on 'activities'.
        onError: staleAwareOnError(queryClient, 'activities', undo, showToast),
      });
    },
    [queryClient, weekStart, weekEnd, enqueuePendingAction, showToast],
  );

  const deleteActivityDeferred = useCallback(
    async (id: string): Promise<DeleteActivityOutcome> => {
      const weekKey = qk.activityRange(weekStart, weekEnd);
      // (D3 step 1) ensure-fresh — MANUAL, not ensureQueryData (v5 returns
      // the stale cache and prefetches in the background). A silent fetch
      // (meta.silent) keeps the global QueryCache.onError from double-toasting
      // a failed refresh (providers.tsx escape hatch).
      const state = queryClient.getQueryState(weekKey);
      let refetched = false;
      if (state) {
        const staleTime = resolveStaleTime(queryClient, weekKey);
        if (state.isInvalidated || Date.now() - state.dataUpdatedAt > staleTime) {
          await queryClient.fetchQuery({
            queryKey: weekKey,
            queryFn: fetchWeekActivities,
            staleTime: 0,
            meta: { silent: true },
          });
          refetched = true;
        }
      }

      // (D3 step 2) dry-run — pure preview, a direct api-client call outside
      // the QueryCache. 409-with-tree REJECTS upward as needs-confirm (the
      // call site opens DeleteDialog); any other error propagates (fail-closed,
      // call-site error toast; deletingRef reset in finally).
      try {
        await dryRunDeleteActivity(id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.dependencies) {
          return { kind: 'needs-confirm', dependencies: err.dependencies, refetched };
        }
        throw err;
      }

      // (D3 step 3) clean path — empty tree: optimistic enqueue with
      // `expected: {}` (all three entity sets are empty on this path).
      await enqueueOptimisticActivityDelete(id, {});
      return { kind: 'enqueued', refetched };
    },
    [queryClient, weekStart, weekEnd, fetchWeekActivities, enqueueOptimisticActivityDelete],
  );

  const deleteActivityConfirmed = useCallback(
    async (id: string, dependencies: DependencyNode[]): Promise<void> => {
      // D9 (#285): expected = FULL id lists from the items of every node that
      // carries them — the display-cap 10 in the dialog is cosmetics only;
      // auto nodes (photos/activity_tags) carry no items → excluded, matching
      // the backend subset-check (auto deps are exempt).
      const expected: Record<string, string[]> = {};
      for (const node of dependencies) {
        if (!node.items) continue;
        expected[node.entity] = node.items.map((item) => item.id);
      }
      await enqueueOptimisticActivityDelete(id, expected);
    },
    [enqueueOptimisticActivityDelete],
  );

  // week_start = Monday of the TARGET week; locations = explicit checked list
  // from the copy popup. mutateAsync surfaces CopyWeekResult to the caller
  // (popup toasts read the counters).
  const copyLastWeek = useCallback(
    (weekStart: string, locations: string[]): Promise<CopyWeekResult> =>
      copyWeekMutateAsync({ week_start: weekStart, locations }),
    [copyWeekMutateAsync],
  );

  // Build enriched schedule using buildAdminSchedule — GH #267: fed with the
  // FULL status=all dictionaries so activities on archived rows still resolve
  // (map lookups by id; archived entries simply render like any other).
  const enrichedData = useMemo(
    () => buildAdminSchedule(
      activitiesRaw,
      scheduleMasters,
      scheduleServices,
      scheduleLocations,
      currentWeek,
    ),
    [activitiesRaw, scheduleMasters, scheduleServices, scheduleLocations, currentWeek],
  );

  // GH #267: archived-visibility gate inputs. The settings provider wraps the
  // whole tree (app/providers.tsx renders it above ScheduleProvider), so this
  // hook is always resolvable here. `?? true/false` guards against a stale
  // localStorage cache object missing the new keys (undefined → defaults).
  const { settings } = useUserSettings();
  const showMasters = settings.showArchivedMasters ?? true;
  const showLocations = settings.showArchivedLocations ?? false;

  // Filter + visibility gate — SINGLE derivation site (GH #267). Order matters:
  //
  //   1. The ARCHIVE GATE drops items whose master/location rows are archived
  //      unless the matching setting is on. Services never gate.
  //   2. The id-filter (multi-select, empty = show all) applies ONLY to items
  //      with no archived entity at all (`!hasArchived`) — archived cards that
  //      passed the gate are NEVER fed through it (the options lists don't
  //      contain archived rows, so the filter would otherwise permanently hide
  //      them). Result = activePassed(idFilter) ∪ archivedPassed.
  const filteredItems = useMemo(() => {
    const activePassed: ScheduleAdminDTO[] = [];
    const archivedPassed: ScheduleAdminDTO[] = [];
    for (const a of enrichedData.items) {
      const masterArchived = a.masterArchived ?? false;
      const locationArchived = a.locationArchived ?? false;
      if (masterArchived || locationArchived) {
        // Archive gate: both toggles must permit every archived entity involved.
        if ((!masterArchived || showMasters) && (!locationArchived || showLocations)) {
          archivedPassed.push(a); // past the gate → immune to the id-filter
        }
      } else {
        // Fully active item: gate passes trivially; the id-filter still applies.
        const masterOk = filterMasterIds.length === 0 || filterMasterIds.includes(a.masterId);
        const locationOk = filterLocationIds.length === 0 || filterLocationIds.includes(a.locationId);
        if (masterOk && locationOk) activePassed.push(a);
      }
    }
    return [...activePassed, ...archivedPassed];
  }, [enrichedData.items, filterMasterIds, filterLocationIds, showMasters, showLocations]);

  // Adaptive grid bounds in integer minutes — SINGLE derivation site (GH #142).
  // Views read gridStartMinutes/gridEndMinutes instead of calling
  // calculateGridTimeRange per-view.
  const { gridStartMinutes, gridEndMinutes } = useMemo(() => {
    const range = calculateGridTimeRange(filteredItems, workingHoursStart, workingHoursEnd);
    return { gridStartMinutes: range.startMinutes, gridEndMinutes: range.endMinutes };
  }, [filteredItems, workingHoursStart, workingHoursEnd]);

  // Build index from filtered items
  const scheduleIndex = useMemo(
    () => buildSchedule(filteredItems, { getDateKey: a => a.date }),
    [filteredItems],
  );

  // Memoize context value
  const contextValue = useMemo(() => ({
    activities: filteredItems,
    scheduleIndex,
    masters,
    services,
    locations,
    scheduleMasters,
    scheduleServices,
    scheduleLocations,
    loading: activitiesLoading,
    error: activitiesError ?? null,
    addActivity,
    updateActivity: updateActivityFn,
    deleteActivityDeferred,
    deleteActivityConfirmed,
    pendingActivityConfirm,
    setPendingActivityConfirm,
    copyLastWeek,
    gridStartMinutes,
    gridEndMinutes,
  }), [
    filteredItems, scheduleIndex, masters, services, locations,
    scheduleMasters, scheduleServices, scheduleLocations,
    activitiesLoading, activitiesError,
    addActivity, updateActivityFn, deleteActivityDeferred, deleteActivityConfirmed,
    pendingActivityConfirm, copyLastWeek,
    gridStartMinutes, gridEndMinutes,
  ]);

  return (
    <ScheduleDataContext.Provider value={contextValue}>
      {children}
    </ScheduleDataContext.Provider>
  );
}

export function useScheduleData(): ScheduleDataContextType {
  const ctx = useContext(ScheduleDataContext);
  if (!ctx) throw new Error('useScheduleData must be used within ScheduleDataProvider');
  return ctx;
}
