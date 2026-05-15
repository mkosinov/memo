'use client';

import React from 'react';
import { HOURS_START, HOURS_END, CELL_HEIGHT, formatTime } from '@/lib/utils';

export function TimeColumn() {
  const hours: number[] = [];
  for (let h = HOURS_START; h <= HOURS_END; h++) {
    hours.push(h);
    if (h < HOURS_END) hours.push(h + 0.5);
  }

  return (
    <div
      className="sticky left-0 z-20 bg-white"
      style={{ width: 64, minWidth: 64 }}
    >
      {hours.map((hour, i) => {
        const isHour = hour % 1 === 0;
        return (
          <div
            key={i}
            className="relative"
            style={{ height: CELL_HEIGHT }}
          >
            {isHour && (
              <span className="absolute -top-3 right-2 text-xs text-gray-400">
                {formatTime(hour)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
