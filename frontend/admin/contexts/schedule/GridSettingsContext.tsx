'use client';

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CELL_HEIGHT_OPTIONS, GRID_FREQUENCY_DEFAULT, GRID_FREQUENCY_OPTIONS } from '@/lib/utils';

// Cell height (px per half-hour slot)
const CELL_HEIGHT_DEFAULT = 50;
const CELL_HEIGHT_STORAGE_KEY = 'memo-cell-height';
const VALID_CELL_HEIGHTS = new Set(CELL_HEIGHT_OPTIONS.map((o) => o.value)) as Set<number>;
// Grid frequency (minutes per slot)
const GRID_FREQUENCY_STORAGE_KEY = 'memo-grid-frequency';
const VALID_GRID_FREQUENCIES = new Set(GRID_FREQUENCY_OPTIONS.map((o) => o.value)) as Set<number>;
// Working hours (default grid range)
const WORKING_HOURS_START_KEY = 'memo-working-hours-start';
const WORKING_HOURS_END_KEY = 'memo-working-hours-end';
const WORKING_HOURS_START_DEFAULT = 9;
const WORKING_HOURS_END_DEFAULT = 21;

function decodeFrom(valid: Set<number>) {
  return (raw: string): number | null => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    return valid.has(rounded) ? rounded : null;
  };
}
const decodeCellHeight = decodeFrom(VALID_CELL_HEIGHTS);
const decodeGridFrequency = decodeFrom(VALID_GRID_FREQUENCIES);
function decodeHour(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 && rounded <= 23 ? rounded : null;
}

export interface GridSettingsContextType {
  cellHeight: number;
  setCellHeight: (height: number) => void;
  gridFrequency: number;
  setGridFrequency: (freq: number) => void;
  workingHoursStart: number;
  setWorkingHoursStart: (h: number) => void;
  workingHoursEnd: number;
  setWorkingHoursEnd: (h: number) => void;
}

const GridSettingsContext = createContext<GridSettingsContextType | null>(null);

export function GridSettingsProvider({ children }: { children: React.ReactNode }) {
  const [cellHeight, setCellHeightPersisted] = usePersistedState<number>(
    CELL_HEIGHT_STORAGE_KEY, CELL_HEIGHT_DEFAULT, decodeCellHeight,
  );
  const [gridFrequency, setGridFrequencyPersisted] = usePersistedState<number>(
    GRID_FREQUENCY_STORAGE_KEY, GRID_FREQUENCY_DEFAULT, decodeGridFrequency,
  );
  const [workingHoursStart, setStartPersisted] = usePersistedState<number>(
    WORKING_HOURS_START_KEY, WORKING_HOURS_START_DEFAULT, decodeHour,
  );
  const [workingHoursEnd, setEndPersisted] = usePersistedState<number>(
    WORKING_HOURS_END_KEY, WORKING_HOURS_END_DEFAULT, decodeHour,
  );

  // Write-side clamping preserved (GH #141 spec §4) — domain semantics stay here:
  const setCellHeight = useCallback((h: number) => {
    const rounded = Math.round(h);
    setCellHeightPersisted(VALID_CELL_HEIGHTS.has(rounded) ? rounded : CELL_HEIGHT_DEFAULT);
  }, [setCellHeightPersisted]);
  const setGridFrequency = useCallback((f: number) => {
    const rounded = Math.round(f);
    setGridFrequencyPersisted(VALID_GRID_FREQUENCIES.has(rounded) ? rounded : GRID_FREQUENCY_DEFAULT);
  }, [setGridFrequencyPersisted]);
  const setWorkingHoursStart = useCallback((h: number) => {
    setStartPersisted(Math.max(0, Math.min(23, Math.round(h))));
  }, [setStartPersisted]);
  const setWorkingHoursEnd = useCallback((h: number) => {
    setEndPersisted(Math.max(0, Math.min(23, Math.round(h))));
  }, [setEndPersisted]);

  const value = useMemo(
    () => ({ cellHeight, setCellHeight, gridFrequency, setGridFrequency, workingHoursStart, setWorkingHoursStart, workingHoursEnd, setWorkingHoursEnd }),
    [cellHeight, setCellHeight, gridFrequency, setGridFrequency, workingHoursStart, setWorkingHoursStart, workingHoursEnd, setWorkingHoursEnd],
  );
  return <GridSettingsContext.Provider value={value}>{children}</GridSettingsContext.Provider>;
}

export function useGridSettings(): GridSettingsContextType {
  const ctx = useContext(GridSettingsContext);
  if (!ctx) throw new Error('useGridSettings must be used within GridSettingsProvider');
  return ctx;
}
