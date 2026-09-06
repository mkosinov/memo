'use client';

import React from 'react';
import { GridSettingsProvider, useGridSettings } from './GridSettingsContext';
import { ScheduleViewProvider, useScheduleView } from './ScheduleViewContext';
import { ScheduleDataProvider } from './ScheduleDataContext';

// Composition (spec §3): reads view + settings values and passes them INTO
// the data provider as inputs. Zoom (cellHeight) changes the SETTINGS value
// only — the data value is untouched (DoD-1). Filter/working-hour changes DO
// re-render data consumers (accepted, identical to today).
function ScheduleDataGate({ children }: { children: React.ReactNode }) {
  const { filterMasterIds, filterLocationIds, setFilterMasterIds, setFilterLocationIds } = useScheduleView();
  const { workingHoursStart, workingHoursEnd } = useGridSettings();
  return (
    <ScheduleDataProvider
      filterMasterIds={filterMasterIds}
      filterLocationIds={filterLocationIds}
      setFilterMasterIds={setFilterMasterIds}
      setFilterLocationIds={setFilterLocationIds}
      workingHoursStart={workingHoursStart}
      workingHoursEnd={workingHoursEnd}
    >
      {children}
    </ScheduleDataProvider>
  );
}

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  return (
    <GridSettingsProvider>
      <ScheduleViewProvider>
        <ScheduleDataGate>{children}</ScheduleDataGate>
      </ScheduleViewProvider>
    </GridSettingsProvider>
  );
}
