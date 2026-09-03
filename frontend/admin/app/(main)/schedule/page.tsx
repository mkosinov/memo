'use client';

import { Topbar } from '../../components/layout/Topbar';
import { Toolbar } from '../../components/layout/Toolbar';
import { StampFab } from '../../components/layout/StampFab';
import { WeekView } from '../../components/schedule/WeekView';
import { DayView } from '../../components/schedule/DayView';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';

function ScheduleView() {
  const { rightPanelCollapsed } = useUI();
  const { viewMode } = useSchedule();

  return (
    <>
      <Topbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto">
          {viewMode === 'day' ? <DayView /> : <WeekView />}
        </div>
        {!rightPanelCollapsed && <Toolbar />}
      </div>
      <StampFab />
    </>
  );
}

export default function SchedulePage() {
  // GH #213 §6.6 (R3): RecordsProvider removed — ActivityDetailsModal (the
  // only consumer here) re-homed to useClients() + per-id getClientById, so
  // /schedule no longer fires the 7 records-context queries.
  return (
    <ScheduleProvider>
      <ScheduleView />
    </ScheduleProvider>
  );
}
