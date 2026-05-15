'use client';

import React, { useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { HOURS_START, HOURS_END, CELL_HEIGHT } from '@/lib/utils';
import type { Activity, Artist } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { NowLine } from './NowLine';

interface DayColumnProps {
  dayIndex: number;
  date: Date;
  activities: Activity[];
  artists: Artist[];
  dragCopy?: boolean;
}

interface DroppableSlotProps {
  dayIndex: number;
  slotIndex: number;
  isHour: boolean;
  dragCopy?: boolean;
  children?: React.ReactNode;
}

function DroppableSlot({ dayIndex, slotIndex, isHour, dragCopy, children }: DroppableSlotProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${dayIndex}-${slotIndex}`,
    data: { dayIndex, slotIndex },
  });

  const ghostStyle: React.CSSProperties = isOver
    ? {
        border: `2px dashed ${dragCopy ? '#22c55e' : 'var(--brand, #004D56)'}`,
        backgroundColor: dragCopy ? 'rgba(34,197,94,0.06)' : 'rgba(0,77,86,0.06)',
        pointerEvents: 'none',
        zIndex: 30,
        position: 'relative' as const,
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      className={isHour ? 'border-t border-gray-200' : 'border-t border-dashed border-gray-100'}
      style={{ height: CELL_HEIGHT, ...ghostStyle }}
    >
      {children}
    </div>
  );
}

export function DayColumn({ dayIndex, date, activities, artists, dragCopy }: DayColumnProps) {
  const [visibleIndices, setVisibleIndices] = useState<Record<string, number>>({});

  const slots: number[] = [];
  for (let h = HOURS_START; h <= HOURS_END; h++) {
    slots.push(h);
    if (h < HOURS_END) slots.push(h + 0.5);
  }

  // Group activities by time slot key: "{dayIndex}_{startTime}"
  const slotGroups: Record<string, Activity[]> = {};
  for (const activity of activities) {
    const key = `${dayIndex}_${activity.startTime}`;
    if (!slotGroups[key]) slotGroups[key] = [];
    slotGroups[key].push(activity);
  }

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Find which slot the wheel event is over based on Y position
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top + e.currentTarget.scrollTop;
      const slotIndex = Math.floor(y / CELL_HEIGHT);

      if (slotIndex >= 0 && slotIndex < slots.length) {
        const slotHour = slots[slotIndex];
        const key = `${dayIndex}_${slotHour}`;
        const group = slotGroups[key];

        if (group && group.length > 1) {
          e.preventDefault();
          setVisibleIndices((prev) => {
            const current = prev[key] || 0;
            const direction = e.deltaY > 0 ? 1 : -1;
            const next = (current + direction + group.length) % group.length;
            return { ...prev, [key]: next };
          });
        }
      }
    },
    [dayIndex, slots, slotGroups],
  );

  return (
    <div
      data-testid={`day-column-${dayIndex}`}
      className="relative border-l border-gray-100"
      onWheel={handleWheel}
    >
      {slots.map((hour, i) => (
        <DroppableSlot
          key={i}
          dayIndex={dayIndex}
          slotIndex={i}
          isHour={hour % 1 === 0}
          dragCopy={dragCopy}
        />
      ))}

      {/* Render activity cards */}
      {activities.map((activity) => {
        const key = `${dayIndex}_${activity.startTime}`;
        const group = slotGroups[key];
        const indexInGroup = group.indexOf(activity);
        const totalInSlot = group.length;
        const visibleIndex = visibleIndices[key] || 0;
        const isVisible = totalInSlot <= 1 || indexInGroup === visibleIndex;

        const artist = artists.find((a) => a.id === activity.masterId) || artists[0];

        return (
          <ActivityCard
            key={activity.id}
            activity={activity}
            artist={artist}
            style={{
              transform: `translateX(${indexInGroup * 6}px)`,
              zIndex: totalInSlot > 1 ? 20 - indexInGroup : 10,
              opacity: isVisible ? 1 : 0.3,
              pointerEvents: isVisible ? 'auto' : 'none',
              transition: 'opacity 300ms ease',
            }}
          />
        );
      })}

      {/* Now line for today */}
      <NowLine date={date} />
    </div>
  );
}
