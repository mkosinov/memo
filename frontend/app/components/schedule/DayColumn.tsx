'use client';

import React from 'react';
import { HOURS_START, HOURS_END, CELL_HEIGHT } from '@/lib/utils';
import type { Activity } from '@/lib/types';

interface DayColumnProps {
  dayIndex: number;
  date: Date;
  activities: Activity[];
}

export function DayColumn({ dayIndex, date: _date, activities: _activities }: DayColumnProps) {
  const slots: number[] = [];
  for (let h = HOURS_START; h <= HOURS_END; h++) {
    slots.push(h);
    if (h < HOURS_END) slots.push(h + 0.5);
  }

  return (
    <div
      data-testid={`day-column-${dayIndex}`}
      className="relative border-l border-gray-100"
    >
      {slots.map((hour, i) => {
        const isHour = hour % 1 === 0;
        return (
          <div
            key={i}
            className={isHour ? 'border-t border-gray-200' : 'border-t border-dashed border-gray-100'}
            style={{ height: CELL_HEIGHT }}
          />
        );
      })}
    </div>
  );
}
