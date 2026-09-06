'use client';

import React, { useMemo } from 'react';
import { formatTime, generateTimeSlots } from '@/lib/datetime';

interface TimeColumnProps {
  cellHeight?: number;
  gridFrequency?: number;
  /** Grid bounds in minutes from midnight (GH #142). */
  gridStartMinutes?: number;
  gridEndMinutes?: number;
}

export function TimeColumn({ cellHeight = 60, gridFrequency = 30, gridStartMinutes = 540, gridEndMinutes = 1260 }: TimeColumnProps) {
  // Generate slots at gridFrequency intervals. Slot height is scaled to keep total grid height constant.
  const slotHeight = useMemo(() => cellHeight * (gridFrequency / 30), [cellHeight, gridFrequency]);
  const slots = useMemo(() => generateTimeSlots(gridFrequency, gridStartMinutes, gridEndMinutes), [gridFrequency, gridStartMinutes, gridEndMinutes]);

  return (
    <div
      className="sticky left-0 z-20 bg-white"
      style={{ width: 64, minWidth: 64 }}
    >
      {slots.map((minutes, i) => {
        const isHour = minutes % 60 === 0;
        // Show time label only at hour boundaries to avoid crowding
        return (
          <div
            key={i}
            className="relative"
            style={{ height: slotHeight }}
          >
            {isHour && (
              <span className="absolute -top-3 right-2 text-xs text-ink-light">
                {formatTime(minutes)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
