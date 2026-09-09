'use client';

import React, { createContext, useContext, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Master, Service, Location, ScheduleAdminDTO, ScheduleIndex as DomainScheduleIndex } from '@memo/domain';
import { buildSchedule } from '@memo/domain';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import { useMasters, useMastersRaw } from '@/hooks/useMasters';
import { useServices, useServicesRaw } from '@/hooks/useServices';
import { useLocations, useLocationsRaw } from '@/hooks/useLocations';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  getActivities,
  createActivity as apiCreateActivity,
  patchActivity as apiPatchActivity,
  deleteActivity as apiDeleteActivity,
} from '@memo/api-client';
import type { ActivityResponse, ActivityPatch } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';
import { invalidateEntities } from '@/lib/invalidate';
import { composeLocalISO, dayIndexToDate, calculateGridTimeRange } from '@/lib/datetime';
import { useNavigation } from '@/contexts/NavigationContext';

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
  }) => void;
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

  // Raw API data (shared cache keys with domain hooks — same fetch, different select)
  const { data: activitiesRaw = [], isLoading: activitiesLoading, error: activitiesError } = useQuery<ActivityResponse[]>({
    queryKey: qk.activityRange(weekStart, weekEnd),
    queryFn: () => getActivities({ date_from: weekStart, date_to: weekEnd, per_page: 100 }).then(r => r.items),
  });
  const { data: mastersRaw = [] } = useMastersRaw();
  const { data: servicesRaw = [] } = useServicesRaw();
  const { data: locationsRaw = [] } = useLocationsRaw();

  // Domain types for context consumers (select transforms use same cache as raw
  // queries). Destructured with defaults (old-code style) so the values stay
  // referentially clean for the memos below; `isSuccess` drives filter init.
  const { data: masters = [], isSuccess: mastersSuccess } = useMasters();
  const { data: services = [] } = useServices();
  const { data: locations = [], isSuccess: locationsSuccess } = useLocations();

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
  }) => {
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
    });
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

  // Build enriched schedule using buildAdminSchedule (raw API data)
  const enrichedData = useMemo(
    () => buildAdminSchedule(
      activitiesRaw,
      mastersRaw,
      servicesRaw,
      locationsRaw,
      currentWeek,
    ),
    [activitiesRaw, mastersRaw, servicesRaw, locationsRaw, currentWeek],
  );

  // Filter items based on active filters (multi-select: empty = show all)
  const filteredItems = useMemo(() => {
    let result = enrichedData.items;
    if (filterMasterIds.length > 0) result = result.filter(a => filterMasterIds.includes(a.masterId));
    if (filterLocationIds.length > 0) result = result.filter(a => filterLocationIds.includes(a.locationId));
    return result;
  }, [enrichedData.items, filterMasterIds, filterLocationIds]);

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
