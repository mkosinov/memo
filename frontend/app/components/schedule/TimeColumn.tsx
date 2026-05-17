'use client';

import React from 'react';
import { CELL_HEIGHT, formatTime, generateTimeSlots } from '@/lib/utils';

export function TimeColumn() {
  const hours = generateTimeSlots();

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
              <span className="absolute -top-3 right-2 text-xs text-ink-light">
                {formatTime(hour)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
