'use client';

import { Sidebar } from './components/layout/Sidebar';
import { Toolbar } from './components/layout/Toolbar';
import { RightPanel } from './components/layout/RightPanel';
import { WeekView } from './components/schedule/WeekView';
import { useUI } from '@/contexts/UIContext';

export default function Home() {
  const { sidebarCollapsed, rightPanelCollapsed } = useUI();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div
        data-testid="center-content"
        className="flex-1 flex flex-col min-w-0 ml-[var(--sidebar-w,230px)] mr-[var(--right-w,0px)] transition-all duration-300"
        style={{
          marginLeft: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : undefined,
          marginRight: rightPanelCollapsed ? '0' : undefined,
        }}
      >
        <Toolbar />
        <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - var(--toolbar-h, 56px))' }}>
          <div className="flex-1 overflow-auto">
            <WeekView />
          </div>
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
