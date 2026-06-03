'use client';

import { Topbar } from '../../components/layout/Topbar';
import { Toolbar } from '../../components/layout/Toolbar';
import { StampFab } from '../../components/layout/StampFab';
import { WeekView } from '../../components/schedule/WeekView';
import { useUI } from '@/contexts/UIContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';
import { RecordsProvider } from '@/contexts/RecordsContext';

export default function SchedulePage() {
  const { rightPanelCollapsed } = useUI();

  return (
    <RecordsProvider>
    <ScheduleProvider>
      <Topbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto">
          <WeekView />
        </div>
        {!rightPanelCollapsed && <Toolbar />}
      </div>
      <StampFab />
    </ScheduleProvider>
    </RecordsProvider>
  );
}
