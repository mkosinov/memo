'use client';

import { Suspense } from 'react';
import { Topbar } from '../../components/layout/Topbar';
import { Toolbar } from '../../components/layout/Toolbar';
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
      {/* The Toolbar is an INLINE flex item (not a fixed overlay): the inner
          column wraps Topbar + grid, so the open panel squeezes BOTH the
          topbar and the grid — nothing hides underneath it. The panel is
          toggled by the stamp button in the Topbar (right of the zoom). */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Topbar />
          <div className="flex-1 overflow-auto">
            {viewMode === 'day' ? <DayView /> : <WeekView />}
          </div>
        </div>
        {!rightPanelCollapsed && <Toolbar />}
      </div>
    </>
  );
}

export default function SchedulePage() {
  // GH #213 §6.6 (R3): RecordsProvider removed — ActivityDetailsModal (the
  // only consumer here) resolves clients per record tab via useClient
  // (GH #140 US-2: each tab fetches its own ['client', id], deduped — no
  // clients-list dependency), so /schedule no longer fires the 7
  // records-context queries.
  //
  // #138 Task 2 (spec §4): the tree reads ?view=&date=&col= via
  // useSearchParams — the Suspense boundary is MANDATORY for the Next 14
  // static build (same pattern as app/(main)/clients/page.tsx).
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <ScheduleProvider>
        <ScheduleView />
      </ScheduleProvider>
    </Suspense>
  );
}
