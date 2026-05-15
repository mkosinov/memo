'use client';

import React from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';
import { DAYS, getMonday, TIME_COL_WIDTH } from '@/lib/utils';

export function WeekView() {
  const { currentWeek, activities } = useSchedule();
  const monday = getMonday(currentWeek);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  const today = new Date();

  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  return (
    <div className="min-w-[800px]">
      {/* Header row */}
      <div
        className="sticky top-0 z-10 flex bg-white border-b"
        style={{ paddingLeft: TIME_COL_WIDTH }}
      >
        {days.map((day, i) => (
          <div
            key={i}
            className="flex-1 text-center py-2 text-xs font-medium"
            style={{ color: isToday(day) ? 'var(--brand)' : 'var(--ink-mid)' }}
          >
            <div className="uppercase tracking-wide">{DAYS[i]}</div>
            <div className={`text-base font-bold ${isToday(day) ? 'text-brand' : ''}`}>
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Grid row */}
      <div className="flex">
        <TimeColumn />
        {days.map((day, i) => (
          <DayColumn
            key={i}
            dayIndex={i}
            date={day}
            activities={activities.filter(a => a.day === i)}
          />
        ))}
      </div>
    </div>
  );
}
