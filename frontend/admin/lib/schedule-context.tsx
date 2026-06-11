import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { DndContext } from '@dnd-kit/core';
import { Activity, Filters, FormatPainterState, ViewMode, Conflict } from '@memo/domain';
import { MASTERS, LOCATIONS, SERVICES, INITIAL_ACTIVITIES, addDays, addMinutes, getMonday } from './mock-data';

interface ScheduleContextType {
  activities: Activity[];
  filters: Filters;
  viewMode: ViewMode;
  formatPainter: FormatPainterState;
  conflicts: Conflict[];
  setActivities: React.Dispatch<React.SetStateAction<Activity[]>>;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  setFormatPainter: React.Dispatch<React.SetStateAction<FormatPainterState>>;
  addActivity: (activity: Activity) => void;
  updateActivity: (id: string, updates: Partial<Activity>) => void;
  deleteActivity: (id: string) => void;
  moveActivity: (id: string, newDate: string, newStartTime: string) => void;
  applyFormatPainter: (targetId: string) => void;
  copyLastWeek: () => void;
  filteredActivities: Activity[];
  weekDays: string[];
}

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function useSchedule() {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useSchedule must be used within ScheduleProvider');
  return ctx;
}

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>(INITIAL_ACTIVITIES);
  const [filters, setFilters] = useState<Filters>({
    locationId: '',
    serviceId: '',
    masterId: '',
    weekStart: getMonday(new Date()),
  });
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [formatPainter, setFormatPainter] = useState<FormatPainterState>({
    mode: 'inactive',
    sourceId: null,
  });

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(filters.weekStart, i));
  }, [filters.weekStart]);

  const addActivity = useCallback((activity: Activity) => {
    setActivities(prev => [...prev, activity]);
  }, []);

  const updateActivity = useCallback((id: string, updates: Partial<Activity>) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const deleteActivity = useCallback((id: string) => {
    setActivities(prev => prev.filter(a => a.id !== id));
  }, []);

  const moveActivity = useCallback((id: string, newDate: string, newStartTime: string) => {
    setActivities(prev => prev.map(a => {
      if (a.id !== id) return a;
      const service = SERVICES.find(s => s.id === a.serviceId);
      const duration = service?.durationMinutes ?? 120;
      return {
        ...a,
        date: newDate,
        startTime: newStartTime,
        endTime: addMinutes(newStartTime, duration),
      };
    }));
  }, []);

  const applyFormatPainter = useCallback((targetId: string) => {
    if (!formatPainter.sourceId) return;
    setActivities(prev => prev.map(a => {
      if (a.id !== targetId) return a;
      const source = prev.find(s => s.id === formatPainter.sourceId);
      if (!source) return a;
      return {
        ...a,
        serviceId: source.serviceId,
        locationId: source.locationId,
        masterId: source.masterId,
      };
    }));
    setFormatPainter({ mode: 'inactive', sourceId: null });
  }, [formatPainter.sourceId]);

  const copyLastWeek = useCallback(() => {
    const lastWeekStart = addDays(filters.weekStart, -7);
    const lastWeekDays = Array.from({ length: 7 }, (_, i) => addDays(lastWeekStart, i));
    const publicActivities = activities.filter(
      a => a.isPublic && lastWeekDays.includes(a.date)
    );
    const newActivities = publicActivities.map((a, i) => ({
      ...a,
      id: `act_copy_${Date.now()}_${i}`,
      date: addDays(a.date, 7),
      hasRecords: false,
    }));
    setActivities(prev => [...prev, ...newActivities]);
  }, [activities, filters.weekStart]);

  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      if (filters.locationId && a.locationId !== filters.locationId) return false;
      if (filters.serviceId && a.serviceId !== filters.serviceId) return false;
      if (filters.masterId && a.masterId !== filters.masterId) return false;
      if (!weekDays.includes(a.date)) return false;
      return true;
    });
  }, [activities, filters, weekDays]);

  const conflicts = useMemo(() => {
    const result: Conflict[] = [];
    const weekActivities = activities.filter(a => weekDays.includes(a.date));
    for (let i = 0; i < weekActivities.length; i++) {
      for (let j = i + 1; j < weekActivities.length; j++) {
        const a = weekActivities[i];
        const b = weekActivities[j];
        if (a.masterId !== b.masterId) continue;
        if (a.date !== b.date) continue;
        if (a.locationId === b.locationId) continue;
        const aStart = timeToMinutes(a.startTime);
        const aEnd = timeToMinutes(a.endTime);
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);
        if (aStart < bEnd && bStart < aEnd) {
          const master = MASTERS.find(ar => ar.id === a.masterId);
          const locA = LOCATIONS.find(l => l.id === a.locationId);
          const locB = LOCATIONS.find(l => l.id === b.locationId);
          result.push({
            activityId1: a.id,
            activityId2: b.id,
            masterId: a.masterId,
            message: `${master?.name} записан в ${locA?.name} и ${locB?.name} одновременно`,
          });
        }
      }
    }
    return result;
  }, [activities, weekDays]);

  const value = useMemo(() => ({
    activities,
    filters,
    viewMode,
    formatPainter,
    conflicts,
    setActivities,
    setFilters,
    setViewMode,
    setFormatPainter,
    addActivity,
    updateActivity,
    deleteActivity,
    moveActivity,
    applyFormatPainter,
    copyLastWeek,
    filteredActivities,
    weekDays,
  }), [activities, filters, viewMode, formatPainter, conflicts, addActivity, updateActivity, deleteActivity, moveActivity, applyFormatPainter, copyLastWeek, filteredActivities, weekDays]);

  return (
    <ScheduleContext.Provider value={value}>
      <DndContext>{children}</DndContext>
    </ScheduleContext.Provider>
  );
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}