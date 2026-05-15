'use client';

import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import type { Activity, Artist } from '@/lib/types';
import { HOURS_START, CELL_HEIGHT, hexToRgb, mixWithWhite, formatTime, getFillOpacity } from '@/lib/utils';

interface ActivityCardProps {
  activity: Activity;
  artist: Artist;
  style?: React.CSSProperties;
}

export function ActivityCard({ activity, artist, style }: ActivityCardProps) {
  const { deleteMode, showToast } = useUI();
  const { deleteActivity, addActivity } = useSchedule();
  const [deleting, setDeleting] = useState(false);
  const topPx = (activity.startTime - HOURS_START) * CELL_HEIGHT * 2;
  const heightPx = Math.max(activity.duration * 120 - 10, 52);
  const mixRatio = getFillOpacity(activity.occupied, activity.capacity);
  const rgb = hexToRgb(artist.color);
  const mixed = mixWithWhite(rgb, mixRatio);
  const cardBg = `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})`;

  // Collapsing
  const showExtra = heightPx >= 90;
  const showOnlyPill = heightPx < 56;

  // DnD draggable
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: activity.id,
    data: { activity, dayIndex: activity.day },
  });

  const dragStyle: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : {};

  const draggingStyle: React.CSSProperties = isDragging
    ? { opacity: 0.5, zIndex: 50, scale: '0.98' }
    : {};

  const handleClick = () => {
    if (deleteMode) {
      setDeleting(true);
      setTimeout(() => {
        const { id, ...rest } = activity;
        deleteActivity(activity.id);
        showToast(
          `«${activity.serviceName}» удалено`,
          () => addActivity(rest),
        );
      }, 150);
    }
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={`absolute left-1 right-1 rounded-lg overflow-hidden flex flex-col cursor-pointer transition-shadow hover:shadow-md ${deleting ? 'opacity-0 scale-95' : ''}`}
      style={{
        top: topPx,
        height: heightPx,
        backgroundColor: cardBg,
        borderLeft: `3px solid ${artist.color}`,
        transition: 'opacity 150ms ease, transform 150ms ease',
        ...(activity.isPrivate ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)' } : {}),
        ...dragStyle,
        ...draggingStyle,
        ...style,
      }}
      data-testid={`activity-${activity.id}`}
      data-drag-id={activity.id}
    >
      {/* Time pill */}
      <div className="px-2 pt-1.5">
        <span
          className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: artist.color }}
        >
          {formatTime(activity.startTime)}–{formatTime(activity.startTime + activity.duration)}
        </span>
      </div>

      {!showOnlyPill && (
        <>
          {/* Service name */}
          <div className="px-2 mt-1 text-sm font-semibold leading-tight line-clamp-2">
            {activity.serviceName}
          </div>

          {/* Extra info (hidden when < 90px) */}
          {showExtra && (
            <div className="px-2 mt-1 space-y-0.5">
              <div className="flex items-center gap-1 text-[11px] text-gray-600">
                <span>{activity.minAge}</span>
                <span>{artist.shortName}</span>
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer */}
          <div className="px-2 pb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-medium">
              {activity.occupied}/{activity.capacity}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
