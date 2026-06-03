'use client';

import { useMemo, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getActivities, getMasters, getServices, getLocations } from '@memo/api-client';
import type { ScheduleIndex } from '@memo/domain';
import { joinActivities, type WebScheduleDTO } from '@/app/lib/mappers/join-schedule';
import { toScheduleView } from '@/app/lib/mappers/to-schedule-vm';
import type { ScheduleView, ScheduleFiltersView } from '@/app/lib/model/view/schedule';
import type { ActivityResponse, ServiceResponse, MasterResponse, LocationResponse } from '@memo/api-client';

export interface UseScheduleResult {
  schedules: ScheduleView[];
  getByDate: (date: string, locationId?: string) => ScheduleView[];
  isLoading: boolean;
  error: Error | null;
}

export function computeDateRange(filters: ScheduleFiltersView): { date_from: string; date_to: string } {
  const today = new Date();
  const dateFrom = filters.dateStart ?? today.toISOString().slice(0, 10);
  const dateTo =
    filters.dateEnd ??
    new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { date_from: dateFrom, date_to: dateTo };
}

export function useSchedule(filters: ScheduleFiltersView = {}): UseScheduleResult {
  const { date_from, date_to } = computeDateRange(filters);

  const queries = useQueries({
    queries: [
      {
        queryKey: ['activities', date_from, date_to],
        queryFn: () => getActivities({ date_from, date_to }),
        staleTime: 0,
        refetchInterval: 60_000,
      },
      {
        queryKey: ['services'],
        queryFn: () => getServices(),
        staleTime: 300_000,
        gcTime: 600_000,
      },
      {
        queryKey: ['masters'],
        queryFn: () => getMasters(),
        staleTime: 300_000,
        gcTime: 600_000,
      },
      {
        queryKey: ['locations'],
        queryFn: () => getLocations(),
        staleTime: 300_000,
        gcTime: 600_000,
      },
    ],
  });

  const index: ScheduleIndex<WebScheduleDTO> | null = useMemo(() => {
    if (queries.some((q) => q.isLoading || q.isError)) return null;
    const rawData = queries.map((q) => q.data);
    const activities = rawData[0] as ActivityResponse[];
    const services = rawData[1] as ServiceResponse[];
    const masters = rawData[2] as MasterResponse[];
    const locations = rawData[3] as LocationResponse[];
    return joinActivities(
      activities,
      new Map(services.map((s) => [s.id, s])),
      new Map(masters.map((m) => [m.id, m])),
      new Map(locations.map((l) => [l.id, l])),
    );
  }, [queries.map((q) => q.data)]);

  const allSchedules: ScheduleView[] = useMemo(() => {
    if (!index) return [];
    return Array.from(index.byId.values()).map(toScheduleView);
  }, [index]);

  const getByDate = useCallback(
    (date: string, locationId = 'all'): ScheduleView[] => {
      if (!index) return [];
      const ids = index.byLocation[locationId]?.byDate.get(date) ?? [];
      return ids.map((id: string) => toScheduleView(index.byId.get(id)!)).filter(Boolean);
    },
    [index],
  );

  const error = queries.find((q) => q.error)?.error ?? null;

  return {
    schedules: allSchedules,
    getByDate,
    isLoading: queries.some((q) => q.isLoading),
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
  };
}
