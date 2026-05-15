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
        className="flex-1 flex flex-col min-w-0"
        style={{
          marginLeft: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
          marginRight: rightPanelCollapsed ? '0' : 'var(--right-w)',
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
    </div>
  );
}
