'use client';

import React from 'react';
import { formatTime, generateTimeSlots } from '@/lib/utils';

interface TimeColumnProps {
  cellHeight?: number;
  gridFrequency?: number;
}

export function TimeColumn({ cellHeight = 60, gridFrequency = 30 }: TimeColumnProps) {
  const hours = generateTimeSlots(gridFrequency);

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
            style={{ height: cellHeight }}
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
