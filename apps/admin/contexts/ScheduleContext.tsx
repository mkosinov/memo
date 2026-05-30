'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { Activity, Artist, Service, Location, StampState } from '@memo/domain';
import { useActivities } from '@/hooks/useActivities';
import { useMasters } from '@/hooks/useMasters';
import { useServices } from '@/hooks/useServices';
import { useLocations } from '@/hooks/useLocations';
import {
  createActivity as apiCreateActivity,
  updateActivity as apiUpdateActivity,
  deleteActivity as apiDeleteActivity,
} from '@memo/api-client';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { getMonday, formatDateISO } from '@/lib/utils';

interface ScheduleContextType {
  activities: Activity[];
  artists: Artist[];
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
}

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [currentWeek, setCurrentWeek] = useState(() => getMonday(new Date()));
  const [stamp, setStamp] = useState<StampState>({
    masterId: null,
    serviceId: null,
    locations: new Set(),
    ready: false,
  });

  const queryClient = useQueryClient();
  const weekStart = formatDateISO(currentWeek);
  const weekEnd = formatDateISO(new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000 - 1));

  // Data fetching
  const { data: activities = [], isLoading: activitiesLoading, error: activitiesError } = useActivities(weekStart, weekEnd);
  const { data: artists = [] } = useMasters();
  const { data: services = [] } = useServices();
  const { data: locations = [] } = useLocations();

  // Query key for cache invalidation
  const activityQueryKey = ['activities', weekStart, weekEnd] as const;

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiCreateActivity>[0]) => apiCreateActivity(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activityQueryKey }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiUpdateActivity(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activityQueryKey }),
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

    createMutation.mutate({
      master_id: activity.masterId,
      service_id: activity.serviceId,
      location_id: activity.locationId,
      start: startDate.toISOString(),
      duration: Math.round(activity.duration * 60),  // hours → minutes
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
    if (updates.capacity !== undefined) payload.capacity = updates.capacity;
    if (updates.isPrivate !== undefined) payload.is_private = updates.isPrivate;
    if (updates.comment !== undefined) payload.comment = updates.comment;
    if (updates.occupied !== undefined) payload.occupied = updates.occupied;
    // Handle time changes (e.g., drag & drop)
    if (updates.startTime !== undefined && updates.day !== undefined) {
      const startDate = new Date(currentWeek);
      startDate.setDate(startDate.getDate() + updates.day);
      startDate.setHours(Math.floor(updates.startTime), Math.round((updates.startTime % 1) * 60), 0, 0);
      payload.start = startDate.toISOString();
    }
    updateMutation.mutate({ id, data: payload });
  }, [currentWeek, updateMutation]);

  const deleteActivityById = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const copyLastWeek = useCallback(() => {
    // Stub: will be implemented when API-based copy-last-week is needed
    console.warn('copyLastWeek not yet implemented with API data');
  }, []);

  // Memoize context value
  const contextValue = useMemo(() => ({
    activities,
    artists,
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
  }), [
    activities, artists, services, locations,
    currentWeek, stamp,
    setCurrentWeek, addActivity, updateActivityFn, deleteActivityById, setStamp, copyLastWeek,
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
