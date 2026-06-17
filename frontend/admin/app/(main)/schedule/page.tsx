'use client';

import { Topbar } from '../../components/layout/Topbar';
import { Toolbar } from '../../components/layout/Toolbar';
import { StampFab } from '../../components/layout/StampFab';
import { WeekView } from '../../components/schedule/WeekView';
import { DayView } from '../../components/schedule/DayView';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import { RecordsProvider } from '@/contexts/RecordsContext';

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
  return (
    <RecordsProvider>
    <ScheduleProvider>
      <ScheduleView />
    </ScheduleProvider>
    </RecordsProvider>
  );
}
