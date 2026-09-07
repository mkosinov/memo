'use client';

import { Topbar } from '../../components/layout/Topbar';
import { Toolbar } from '../../components/layout/Toolbar';
import { StampFab } from '../../components/layout/StampFab';
import { WeekView } from '../../components/schedule/WeekView';
import { DayView } from '../../components/schedule/DayView';
import { useUI } from '@/contexts/UIContext';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { ScheduleProvider } from '@/contexts/schedule/ScheduleProvider';

function ScheduleView() {
  const { rightPanelCollapsed } = useUI();
  const { viewMode } = useScheduleView();

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
  // only consumer here) resolves clients per record tab via useClient
  // (GH #140 US-2: each tab fetches its own ['client', id], deduped — no
  // clients-list dependency), so /schedule no longer fires the 7
  // records-context queries.
  return (
    <ScheduleProvider>
      <ScheduleView />
    </ScheduleProvider>
  );
}
