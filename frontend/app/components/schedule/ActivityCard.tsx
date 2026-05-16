'use client';

import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import type { Activity, Artist, Studio } from '@/lib/types';
import { HOURS_START, CELL_HEIGHT, hexToRgb, mixWithWhite, formatTime, getFillOpacity } from '@/lib/utils';

interface ActivityCardProps {
  activity: Activity;
  artist: Artist;
  studios?: Studio[];
  style?: React.CSSProperties;
  onEdit?: (activity: Activity) => void;
  isDragging?: boolean;
  isDragCopy?: boolean;
}

export function ActivityCard({ activity, artist, studios = [], style, onEdit, isDragging, isDragCopy }: ActivityCardProps) {
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
  const { attributes, listeners, setNodeRef, transform, isDragging: dndDragging } = useDraggable({
    id: activity.id,
    data: { activity, dayIndex: activity.day },
  });

  const dragStyle: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : {};

  // Hide original during normal drag; keep visible during Alt+drag (copy mode)
  const shouldHideOriginal = (dndDragging || isDragging) && !isDragCopy;
  const draggingStyle: React.CSSProperties = shouldHideOriginal
    ? { opacity: 0, zIndex: 50, pointerEvents: 'none' as const }
    : isDragging
      ? { opacity: 0.5, zIndex: 50, scale: '0.98' }
      : {};

  const handleClick = () => {
    if (deleteMode) {
      setDeleting(true);
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _unused, ...rest } = activity;
        deleteActivity(activity.id);
        showToast(
          `«${activity.serviceName}» удалено`,
          () => addActivity(rest),
        );
      }, 150);
    } else if (onEdit) {
      // Not in delete mode → open edit modal
      onEdit(activity);
    }
  };

  // Quick action: '+' for public, '...' for private
  const handleQuickAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activity.isPrivate) {
      showToast('Редактирование индивидуального МК');
    } else {
      showToast('Быстрое добавление гостя');
    }
  };

  // Location name from studios
  const locationName = studios.find(s => s.id === activity.locationId)?.name || '';

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
        ...(activity.isPrivate ? { clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%)' } : {}),
        ...dragStyle,
        ...draggingStyle,
        ...style,
      }}
      data-testid={`activity-${activity.id}`}
      data-drag-id={activity.id}
    >
      {/* Time pill — issue 1: increased padding */}
      <div className="px-3 pt-2 pb-1">
        <span
          className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: artist.color }}
        >
          {formatTime(activity.startTime)}–{formatTime(activity.startTime + activity.duration)}
        </span>
      </div>

      {!showOnlyPill && (
        <>
          {/* Service name + age — issues 2, 3: min-h for 2 lines, age right after */}
          <div className="px-2 mt-1 min-h-[2.5rem]">
            <div className="text-sm font-semibold leading-tight line-clamp-2">
              {activity.serviceName}
            </div>
            {showExtra && (
              <div className="flex items-center gap-1 text-[11px] text-gray-600 mt-0.5">
                <span>{activity.minAge}</span>
                {/* Issue 4: full artist name with truncation */}
                <span className="truncate" title={artist.name}>{artist.name}</span>
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer — issue 5: location, issue 6: quick action buttons */}
          <div className="px-2 pb-1.5 flex items-center justify-between text-[11px]">
            <div className="flex flex-col">
              <span className="font-medium">
                {activity.occupied}/{activity.capacity}
              </span>
              {showExtra && locationName && (
                <span className="text-[10px]" style={{ color: 'var(--ink-light)' }}>
                  {locationName}
                </span>
              )}
            </div>
            <button
              onClick={handleQuickAction}
              className="flex items-center justify-center w-5 h-5 rounded-full border transition-colors hover:bg-white/30"
              style={{ borderColor: artist.color, color: artist.color }}
              aria-label={activity.isPrivate ? 'Редактировать' : 'Добавить гостя'}
            >
              {activity.isPrivate ? (
                <span className="text-[10px] leading-none font-bold">···</span>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
          </div>
        </>
      )}

      {/* Issue 7: Private star icon in clipped top-right corner */}
      {activity.isPrivate && (
        <div
          className="absolute top-0 right-0 flex items-center justify-center"
          style={{ width: '16px', height: '16px' }}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="var(--brand, #004D56)" style={{ color: artist.color }}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>
      )}
    </div>
  );
}
