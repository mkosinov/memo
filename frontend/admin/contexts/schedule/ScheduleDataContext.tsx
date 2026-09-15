'use client';

import React, { createContext, useContext, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Master, Service, Location, ScheduleAdminDTO, ScheduleIndex as DomainScheduleIndex } from '@memo/domain';
import { buildSchedule } from '@memo/domain';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import type { MasterViewResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { useScheduleMasters } from '@/hooks/useMasters';
import { useScheduleServices } from '@/hooks/useServices';
import { useScheduleLocations } from '@/hooks/useLocations';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  getActivities,
  createActivity as apiCreateActivity,
  patchActivity as apiPatchActivity,
  deleteActivity as apiDeleteActivity,
} from '@memo/api-client';
import type { ActivityResponse, ActivityPatch } from '@memo/api-client';
import { transformMaster, transformService, transformLocation } from '@/lib/transformers';
import { qk } from '@/lib/queryKeys';
import { invalidateEntities } from '@/lib/invalidate';
import { composeLocalISO, dayIndexToDate, calculateGridTimeRange } from '@/lib/datetime';
import { useNavigation } from '@/contexts/NavigationContext';
import { useUserSettings } from '@/contexts/UserSettingsContext';

// Mutation key shared by create/update/delete — feeds the Topbar indicator
// via useMutationState (spec §5; no isSaving field on any context).
export const SCHEDULE_ACTIVITY_MUTATION_KEY = ['schedule-activity'] as const;

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
  deleteActivity: (id: string) => void;
  copyLastWeek: () => void; // stub stays — #242
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
  const { dateFrom, dateTo } = useNavigation();
  const weekStart = dateFrom;
  const weekEnd = dateTo;
  // Local week-Monday derivation for buildAdminSchedule + dayIndex→date math
  // (spec §3: the data provider calls useNavigation() internally; currentWeek /
  // setCurrentWeek STATE lives in the view context, not here).
  const currentWeek = useMemo(() => new Date(dateFrom + 'T00:00:00'), [dateFrom]);

  // Raw API data (activities use the week-range key; see GH #142).
  const { data: activitiesRaw = [], isLoading: activitiesLoading, error: activitiesError } = useQuery<ActivityResponse[]>({
    queryKey: qk.activityRange(weekStart, weekEnd),
    queryFn: () => getActivities({ date_from: weekStart, date_to: weekEnd, per_page: 100 }).then(r => r.items),
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

  // Mutations
  const createMutation = useMutation({
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
  const updateMutation = useMutation({
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
      // the shared map (#239), see createMutation. (The optimistic mechanics
      // above — cancelQueries/snapshot/setQueryData/restore — keep the exact
      // activityRange key on purpose; only the sync invalidation widens.)
      invalidateEntities(queryClient, ['activities']);
    },
  });

  const deleteMutation = useMutation({
    mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY,
    mutationFn: (id: string) => apiDeleteActivity(id),
    // Family rule via the shared map (#239) — see createMutation.
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

    createMutation.mutate({
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
    // Dep is the STABLE `mutate` (v5 useCallback over a once-created observer),
    // not the mutation result object — that object is rebuilt every render and
    // would give the data context value a new identity on every provider
    // re-render, breaking zoom isolation (DoD-1 / spec §3).
  }, [currentWeek, createMutation.mutate]);

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
    updateMutation.mutate({ id, data: payload });
  }, [currentWeek, updateMutation.mutate]);

  const deleteActivityById = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation.mutate]);

  const copyLastWeek = useCallback(() => {
    // Stub: will be implemented when API-based copy-last-week is needed
  }, []);

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
    deleteActivity: deleteActivityById,
    copyLastWeek,
    gridStartMinutes,
    gridEndMinutes,
  }), [
    filteredItems, scheduleIndex, masters, services, locations,
    scheduleMasters, scheduleServices, scheduleLocations,
    activitiesLoading, activitiesError,
    addActivity, updateActivityFn, deleteActivityById, copyLastWeek,
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
