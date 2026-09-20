'use client';

import React, { createContext, useContext, useState, useMemo } from 'react';
import type { StampState } from '@memo/domain';
import { useScheduleView as useScheduleViewHook } from '@/hooks/useScheduleView';
import type {
  ScheduleView,
  ScheduleViewMode,
  ScheduleColumnMode,
} from '@/hooks/useScheduleView';

// #138 Task 2: the view context no longer OWNS view state. viewMode /
// selectedDay / columnMode (and currentWeek / prev / next / today) are PROXIED
// from the URL hook hooks/useScheduleView.ts — the single writer of
// /schedule?view=&date=&col= (spec §2.1). The legacy __memo-* listeners and
// the NavigationContext wiring are gone; only stamp and the two filter lists
// stay local.

export type ViewModeType = ScheduleViewMode;
export type ColumnModeType = ScheduleColumnMode;

export interface ScheduleViewContextType extends ScheduleView {
  filterMasterIds: string[];
  filterLocationIds: string[];
  setFilterMasterIds: (ids: string[]) => void;
  setFilterLocationIds: (ids: string[]) => void;
  stamp: StampState;
  setStamp: React.Dispatch<React.SetStateAction<StampState>>;
}

const ScheduleViewContext = createContext<ScheduleViewContextType | null>(null);

export function ScheduleViewProvider({ children }: { children: React.ReactNode }) {
  // One hook call — every view field below is its value, verbatim.
  const view = useScheduleViewHook();

  const [stamp, setStamp] = useState<StampState>({
    masterId: null,
    serviceId: null,
    locations: new Set(),
    ready: false,
  });

  const [filterMasterIds, setFilterMasterIds] = useState<string[]>([]);
  const [filterLocationIds, setFilterLocationIds] = useState<string[]>([]);

  // Memoize context value
  const contextValue = useMemo(() => ({
    ...view,
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
    stamp,
    setStamp,
  }), [view, filterMasterIds, filterLocationIds, stamp]);

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
