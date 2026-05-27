'use client';

import { Toolbar } from '@/app/components/layout/Toolbar';
import { RightPanel } from '@/app/components/layout/RightPanel';
import { StampFab } from '@/app/components/layout/StampFab';
import { WeekView } from '@/app/components/schedule/WeekView';
import { useUI } from '@/contexts/UIContext';

export default function SchedulePage() {
  const { rightPanelCollapsed } = useUI();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto">
          <WeekView />
        </div>
        <RightPanel />
      </div>
      <StampFab />
    </div>
  );
}
