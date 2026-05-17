'use client';

import React from 'react';
import { WeekView } from '@/app/components/schedule/WeekView';

export default function SchedulePage() {
  return (
    <div className="flex-1 overflow-auto">
      <WeekView />
    </div>
  );
}
