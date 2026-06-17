'use client';

import React, { useMemo } from 'react';
import { formatTime, generateTimeSlots, HOURS_START, HOURS_END } from '@/lib/utils';

interface TimeColumnProps {
  cellHeight?: number;
  gridFrequency?: number;
  gridStart?: number;
  gridEnd?: number;
}

export function TimeColumn({ cellHeight = 60, gridFrequency = 30, gridStart = HOURS_START, gridEnd = HOURS_END }: TimeColumnProps) {
  // Generate slots at gridFrequency intervals. Slot height is scaled to keep total grid height constant.
  const slotHeight = useMemo(() => cellHeight * (gridFrequency / 30), [cellHeight, gridFrequency]);
  const hours = useMemo(() => generateTimeSlots(gridFrequency, gridStart, gridEnd), [gridFrequency, gridStart, gridEnd]);

  return (
    <div
      className="sticky left-0 z-20 bg-white"
      style={{ width: 64, minWidth: 64 }}
    >
      {hours.map((hour, i) => {
        const isHour = hour % 1 === 0;
        // Show time label only at hour boundaries to avoid crowding
        return (
          <div
            key={i}
            className="relative"
            style={{ height: slotHeight }}
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
