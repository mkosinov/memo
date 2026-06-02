'use client';

import { Menubar } from './components/layout/Menubar';
import { Toolbar } from './components/layout/Toolbar';
import { RightPanel } from './components/layout/RightPanel';
import { StampFab } from './components/layout/StampFab';
import { WeekView } from './components/schedule/WeekView';
import { useUI } from '@/contexts/UIContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';

export default function Home() {
  const { sidebarCollapsed, rightPanelCollapsed } = useUI();

  return (
    <ScheduleProvider>
      <div className="flex h-screen overflow-hidden">
        <Menubar />
        <div
          data-testid="center-content"
          className="flex-1 flex flex-col min-w-0 ml-[var(--sidebar-w,230px)] mr-[var(--right-w,0px)] transition-all duration-300"
          style={{
            marginLeft: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : undefined,
            marginRight: rightPanelCollapsed ? '0' : undefined,
          }}
        >
          <Toolbar />
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-auto">
              <WeekView />
            </div>
            <RightPanel />
          </div>
        </div>
        <StampFab />
      </div>
    </ScheduleProvider>
  );
}
