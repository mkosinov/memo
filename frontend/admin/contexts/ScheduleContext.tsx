'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { Activity, Master, Service, Location, StampState, ScheduleAdminDTO, ScheduleIndex as DomainScheduleIndex } from '@memo/domain';
import { buildSchedule } from '@memo/domain';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import { useActivities } from '@/hooks/useActivities';
import { useMasters } from '@/hooks/useMasters';
import { useServices } from '@/hooks/useServices';
import { useLocations } from '@/hooks/useLocations';
import { useQuery } from '@tanstack/react-query';
import {
  getActivities, getMasters, getServices, getLocations,
  createActivity as apiCreateActivity,
  patchActivity as apiPatchActivity,
  deleteActivity as apiDeleteActivity,
} from '@memo/api-client';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { getMonday, formatDateISO } from '@/lib/utils';
import { useNavigation } from '@/contexts/NavigationContext';

export type ViewModeType = 'week' | 'day';
export type ColumnModeType = 'masters' | 'locations';

export interface ScheduleContextType {
  activities: ScheduleAdminDTO[];
  scheduleIndex: DomainScheduleIndex<ScheduleAdminDTO>;
  masters: Master[];
  services: Service[];
  locations: Location[];
  currentWeek: Date;
  stamp: StampState;
  setCurrentWeek: (date: Date) => void;
  addActivity: (activity: Omit<Activity, 'id'>) => void;
  updateActivity: (id: string, updates: Partial<Activity>) => void;
  deleteActivity: (id: string) => void;
  setStamp: React.Dispatch<React.SetStateAction<StampState>>;
  copyLastWeek: () => void;
  loading: boolean;
  error: Error | null;
  filterMasterIds: string[];
  filterLocationIds: string[];
  setFilterMasterIds: (ids: string[]) => void;
  setFilterLocationIds: (ids: string[]) => void;
  viewMode: ViewModeType;
  setViewMode: (mode: ViewModeType) => void;
  selectedDay: Date;
  setSelectedDay: (date: Date) => void;
  showAllColumns: boolean;
  setShowAllColumns: (show: boolean) => void;
  columnMode: ColumnModeType;
  setColumnMode: (mode: ColumnModeType) => void;
}

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const { dateFrom, dateTo, selectDateRange } = useNavigation();
  const currentWeek = useMemo(() => new Date(dateFrom + 'T00:00:00'), [dateFrom]);
  const setCurrentWeek = useCallback((date: Date) => {
    const monday = getMonday(date);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    selectDateRange(formatDateISO(monday), formatDateISO(sunday));
  }, [selectDateRange]);
  const [stamp, setStamp] = useState<StampState>({
    masterId: null,
    serviceId: null,
    locations: new Set(),
    ready: false,
  });

  const [filterMasterIds, setFilterMasterIds] = useState<string[]>([]);
  const [filterLocationIds, setFilterLocationIds] = useState<string[]>([]);
  const [filtersInitialized, setFiltersInitialized] = useState(false);
  const [viewMode, setViewMode] = useState<ViewModeType>('week');
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [showAllColumns, setShowAllColumns] = useState<boolean>(false);
  const [columnMode, setColumnMode] = useState<ColumnModeType>('masters');

  // Listen for "go to today" event from sidebar button
  React.useEffect(() => {
    const handleGoToToday = () => {
      setSelectedDay(new Date());
    };
    document.addEventListener('__memo-go-to-today', handleGoToToday);
    return () => document.removeEventListener('__memo-go-to-today', handleGoToToday);
  }, []);

  // Listen for "select day" event from MiniCalendar (day mode)
  React.useEffect(() => {
    const handleSelectDay = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.date) {
        setSelectedDay(new Date(detail.date));
        // Also navigate the week range to contain this day
        const monday = getMonday(new Date(detail.date));
        const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
        selectDateRange(formatDateISO(monday), formatDateISO(sunday));
      }
    };
    document.addEventListener('__memo-select-day', handleSelectDay);
    return () => document.removeEventListener('__memo-select-day', handleSelectDay);
  }, [selectDateRange]);

  // Listen for "switch to day view" event from MiniCalendar (double-click)
  React.useEffect(() => {
    const handleSwitchToDayView = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.date) {
        setViewMode('day');
        setSelectedDay(new Date(detail.date));
        // Also navigate the week range to contain this day
        const monday = getMonday(new Date(detail.date));
        const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
        selectDateRange(formatDateISO(monday), formatDateISO(sunday));
      }
    };
    document.addEventListener('__memo-switch-to-day-view', handleSwitchToDayView);
    return () => document.removeEventListener('__memo-switch-to-day-view', handleSwitchToDayView);
  }, [selectDateRange]);

  // Dispatch events so sidebar Menubar (outside ScheduleProvider) can track viewMode & selectedDay
  React.useEffect(() => {
    document.dispatchEvent(new CustomEvent('__memo-view-mode-changed', { detail: { viewMode } }));
  }, [viewMode]);

  React.useEffect(() => {
    document.dispatchEvent(new CustomEvent('__memo-selected-day-changed', { detail: { selectedDay } }));
  }, [selectedDay]);

  const queryClient = useQueryClient();
  const weekStart = dateFrom;
  const weekEnd = dateTo;

  // Raw API data (shared cache keys with domain hooks — same fetch, different select)
  const { data: activitiesRaw = [], isLoading: activitiesLoading, error: activitiesError } = useQuery<ActivityResponse[]>({
    queryKey: ['activities', weekStart, weekEnd],
    queryFn: () => getActivities({ date_from: weekStart, date_to: weekEnd }),
  });
  const { data: mastersRaw = [] } = useQuery<MasterResponse[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: servicesRaw = [] } = useQuery<ServiceResponse[]>({
    queryKey: ['services'],
    queryFn: () => getServices(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: locationsRaw = [] } = useQuery<LocationResponse[]>({
    queryKey: ['locations'],
    queryFn: () => getLocations(),
    staleTime: 5 * 60 * 1000,
  });

  // Domain types for context consumers (select transforms use same cache as raw queries)
  const { data: masters = [] } = useMasters();
  const { data: services = [] } = useServices();
  const { data: locations = [] } = useLocations();

  // Initialize filters with all IDs when data first loads
  React.useEffect(() => {
    if (filtersInitialized) return;
    if (masters.length > 0 && locations.length > 0) {
      setFilterMasterIds(masters.map(m => m.id));
      setFilterLocationIds(locations.map(l => l.id));
      setFiltersInitialized(true);
    }
  }, [masters, locations, filtersInitialized]);

  // Query key for cache invalidation
  const activityQueryKey = ['activities', weekStart, weekEnd] as const;

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiCreateActivity>[0]) => apiCreateActivity(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activityQueryKey }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // Race: API call vs 5s timeout
      return Promise.race([
        apiPatchActivity(id, data),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Update timed out after 5s')), 5000);
        }),
      ]);
    },
    onMutate: async ({ id, data }) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: activityQueryKey });

      // Snapshot current data
      const previousActivities = queryClient.getQueryData(activityQueryKey);

      // Optimistic update: apply API-level fields to cache (ActivityResponse shape)
      queryClient.setQueryData(activityQueryKey, (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return old.map((activity: Record<string, unknown>) => {
          if (activity.id === id) {
            const updated = { ...activity };
            if (data.start !== undefined) updated.start = data.start;
            if (data.master_id !== undefined) updated.master_id = data.master_id;
            if (data.service_id !== undefined) updated.service_id = data.service_id;
            if (data.location_id !== undefined) updated.location_id = data.location_id;
            if (data.duration !== undefined) updated.duration = data.duration;
            if (data.capacity !== undefined) updated.capacity = data.capacity;
            if (data.is_private !== undefined) updated.is_private = data.is_private;
            if (data.comment !== undefined) updated.comment = data.comment;
            if (data.occupied !== undefined) updated.occupied = data.occupied;
            return updated;
          }
          return activity;
        });
      });

      return { previousActivities };
    },
    onError: (_err, _variables, context) => {
      // Restore snapshot on error — return a new array for immutability/re-render
      if (context?.previousActivities) {
        queryClient.setQueryData(activityQueryKey, [...(context.previousActivities as unknown[])]);
      }
    },
    onSettled: () => {
      // Always sync with server after mutation completes
      queryClient.invalidateQueries({ queryKey: activityQueryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDeleteActivity(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activityQueryKey }),
  });

  // Actions
  const addActivity = useCallback((activity: Omit<Activity, 'id'>) => {
    const startDate = new Date(currentWeek);
    startDate.setDate(startDate.getDate() + activity.day);
    startDate.setHours(Math.floor(activity.startTime), Math.round((activity.startTime % 1) * 60), 0, 0);

    const sy = startDate.getFullYear();
    const sm = String(startDate.getMonth() + 1).padStart(2, '0');
    const sd = String(startDate.getDate()).padStart(2, '0');
    const sh = String(startDate.getHours()).padStart(2, '0');
    const smin = String(startDate.getMinutes()).padStart(2, '0');
    const localStart = `${sy}-${sm}-${sd}T${sh}:${smin}:00`;

    createMutation.mutate({
      master_id: activity.masterId,
      service_id: activity.serviceId,
      location_id: activity.locationId,
      start: localStart,
      duration: activity.durationMinutes ?? Math.round(activity.duration * 60),  // prefer minutes, fallback hours→min
      capacity: activity.capacity,
      is_private: activity.isPrivate ?? false,
      comment: activity.comment ?? null,
      record_info: null,
    });
  }, [currentWeek, createMutation]);

  const updateActivityFn = useCallback((id: string, updates: Partial<Activity>) => {
    const payload: Record<string, unknown> = {};
    if (updates.masterId !== undefined) payload.master_id = updates.masterId;
    if (updates.serviceId !== undefined) payload.service_id = updates.serviceId;
    if (updates.locationId !== undefined) payload.location_id = updates.locationId;
    if (updates.duration !== undefined) payload.duration = Math.round(updates.duration * 60); // hours→min
    if (updates.durationMinutes !== undefined) payload.duration = updates.durationMinutes; // takes precedence
    if (updates.capacity !== undefined) payload.capacity = updates.capacity;
    if (updates.isPrivate !== undefined) payload.is_private = updates.isPrivate;
    if (updates.comment !== undefined) payload.comment = updates.comment;
    if (updates.occupied !== undefined) payload.occupied = updates.occupied;
    // Handle time changes (e.g., drag & drop)
    if (updates.startTime !== undefined && updates.day !== undefined) {
      const startDate = new Date(currentWeek);
      startDate.setDate(startDate.getDate() + updates.day);
      startDate.setHours(Math.floor(updates.startTime), Math.round((updates.startTime % 1) * 60), 0, 0);
      const y = startDate.getFullYear();
      const m = String(startDate.getMonth() + 1).padStart(2, '0');
      const d = String(startDate.getDate()).padStart(2, '0');
      const h = String(startDate.getHours()).padStart(2, '0');
      const min = String(startDate.getMinutes()).padStart(2, '0');
      payload.start = `${y}-${m}-${d}T${h}:${min}:00`;
    }
    updateMutation.mutate({ id, data: payload });
  }, [currentWeek, updateMutation]);

  const deleteActivityById = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

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
    currentWeek,
    stamp,
    setCurrentWeek,
    addActivity,
    updateActivity: updateActivityFn,
    deleteActivity: deleteActivityById,
    setStamp,
    copyLastWeek,
    loading: activitiesLoading,
    error: activitiesError ?? null,
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    showAllColumns,
    setShowAllColumns,
    columnMode,
    setColumnMode,
  }), [
    filteredItems, scheduleIndex, masters, services, locations,
    currentWeek, stamp, filterMasterIds, filterLocationIds,
    viewMode, selectedDay, showAllColumns, columnMode,
    setCurrentWeek, addActivity, updateActivityFn, deleteActivityById, setStamp, copyLastWeek,
    setFilterMasterIds, setFilterLocationIds,
    setViewMode, setSelectedDay, setShowAllColumns, setColumnMode,
    activitiesLoading, activitiesError,
  ]);

  return (
    <ScheduleContext.Provider value={contextValue}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule must be used within ScheduleProvider');
  return context;
}
