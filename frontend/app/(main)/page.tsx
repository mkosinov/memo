'use client';

import React from 'react';
import { Toolbar } from '@/app/components/layout/Toolbar';
import { StampFab } from '@/app/components/layout/StampFab';
import { WeekView } from '@/app/components/schedule/WeekView';

export default function SchedulePage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Toolbar />
      <div className="flex-1 overflow-auto">
        <WeekView />
      </div>
      <StampFab />
    </div>
  );
}
