'use client';

import { Sidebar } from './components/layout/Sidebar';
import { Toolbar } from './components/layout/Toolbar';
import { RightPanel } from './components/layout/RightPanel';
import { WeekView } from './components/schedule/WeekView';

export default function Home() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
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
