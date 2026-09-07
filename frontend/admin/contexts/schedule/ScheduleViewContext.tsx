'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { StampState } from '@memo/domain';
import { getMonday, toISODate } from '@/lib/datetime';
import { useNavigation } from '@/contexts/NavigationContext';

export type ViewModeType = 'week' | 'day';
export type ColumnModeType = 'masters' | 'locations';

export interface ScheduleViewContextType {
  viewMode: ViewModeType;
  setViewMode: (mode: ViewModeType) => void;
  selectedDay: Date;
  setSelectedDay: (date: Date) => void;
  columnMode: ColumnModeType;
  setColumnMode: (mode: ColumnModeType) => void;
  filterMasterIds: string[];
  filterLocationIds: string[];
  setFilterMasterIds: (ids: string[]) => void;
  setFilterLocationIds: (ids: string[]) => void;
  stamp: StampState;
  setStamp: React.Dispatch<React.SetStateAction<StampState>>;
  currentWeek: Date;
  setCurrentWeek: (date: Date) => void;
  prevPeriod: () => void;
  nextPeriod: () => void;
}

const ScheduleViewContext = createContext<ScheduleViewContextType | null>(null);

export function ScheduleViewProvider({ children }: { children: React.ReactNode }) {
  const { dateFrom, dateTo, selectDateRange } = useNavigation();
  const currentWeek = useMemo(() => new Date(dateFrom + 'T00:00:00'), [dateFrom]);
  const setCurrentWeek = useCallback((date: Date) => {
    const monday = getMonday(date);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    selectDateRange(toISODate(monday), toISODate(sunday));
  }, [selectDateRange]);
  const [stamp, setStamp] = useState<StampState>({
    masterId: null,
    serviceId: null,
    locations: new Set(),
    ready: false,
  });

  const [filterMasterIds, setFilterMasterIds] = useState<string[]>([]);
  const [filterLocationIds, setFilterLocationIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewModeType>('week');
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
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
        selectDateRange(toISODate(monday), toISODate(sunday));
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
        selectDateRange(toISODate(monday), toISODate(sunday));
      }
    };
    document.addEventListener('__memo-switch-to-day-view', handleSwitchToDayView);
    return () => document.removeEventListener('__memo-switch-to-day-view', handleSwitchToDayView);
  }, [selectDateRange]);

  // Listen for "switch to week view" event from MiniCalendar (single-click on day)
  React.useEffect(() => {
    const handleSwitchToWeekView = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.date) {
        setViewMode('week');
        const monday = getMonday(new Date(detail.date));
        const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
        selectDateRange(toISODate(monday), toISODate(sunday));
      }
    };
    document.addEventListener('__memo-switch-to-week-view', handleSwitchToWeekView);
    return () => document.removeEventListener('__memo-switch-to-week-view', handleSwitchToWeekView);
  }, [selectDateRange]);

  // Dispatch events so sidebar Menubar (outside ScheduleProvider) can track viewMode & selectedDay
  React.useEffect(() => {
    document.dispatchEvent(new CustomEvent('__memo-view-mode-changed', { detail: { viewMode } }));
  }, [viewMode]);

  React.useEffect(() => {
    document.dispatchEvent(new CustomEvent('__memo-selected-day-changed', { detail: { selectedDay } }));
  }, [selectedDay]);

  const prevPeriod = useCallback(() => {
    if (viewMode === 'week') {
      const prev = new Date(currentWeek);
      prev.setDate(prev.getDate() - 7);
      const sunday = new Date(prev.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(prev), toISODate(sunday));
    } else {
      const prev = new Date(selectedDay);
      prev.setDate(prev.getDate() - 1);
      setSelectedDay(prev);
      const monday = getMonday(prev);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(monday), toISODate(sunday));
    }
  }, [viewMode, currentWeek, selectedDay, selectDateRange, setSelectedDay]);

  const nextPeriod = useCallback(() => {
    if (viewMode === 'week') {
      const next = new Date(currentWeek);
      next.setDate(next.getDate() + 7);
      const sunday = new Date(next.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(next), toISODate(sunday));
    } else {
      const next = new Date(selectedDay);
      next.setDate(next.getDate() + 1);
      setSelectedDay(next);
      const monday = getMonday(next);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(monday), toISODate(sunday));
    }
  }, [viewMode, currentWeek, selectedDay, selectDateRange, setSelectedDay]);

  // Memoize context value
  const contextValue = useMemo(() => ({
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    columnMode,
    setColumnMode,
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
    stamp,
    setStamp,
    currentWeek,
    setCurrentWeek,
    prevPeriod,
    nextPeriod,
  }), [
    viewMode, selectedDay, columnMode,
    filterMasterIds, filterLocationIds,
    stamp, currentWeek,
    setCurrentWeek, setViewMode, setSelectedDay, setColumnMode,
    setFilterMasterIds, setFilterLocationIds,
    prevPeriod, nextPeriod,
  ]);

  return (
    <ScheduleViewContext.Provider value={contextValue}>
      {children}
    </ScheduleViewContext.Provider>
  );
}

export function useScheduleView(): ScheduleViewContextType {
  const ctx = useContext(ScheduleViewContext);
  if (!ctx) throw new Error('useScheduleView must be used within ScheduleViewProvider');
  return ctx;
}
