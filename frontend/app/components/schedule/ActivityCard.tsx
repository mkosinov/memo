'use client';

import React, { useState, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import type { Activity, Artist, Studio } from '@/lib/types';
import { HOURS_START, CELL_HEIGHT, formatTime } from '@/lib/utils';

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
  const deletingRef = useRef(false);
  const topPx = (activity.startTime - HOURS_START) * CELL_HEIGHT * 2;
  const heightPx = Math.max(activity.duration * 120 - 10, 52);
  const fillPct = activity.capacity > 0 ? Math.min(activity.occupied / activity.capacity, 1) : 0;

  // Collapsing
  const showExtra = heightPx >= 90;
  const showOnlyPill = heightPx < 56;

  // DnD draggable
  const { attributes, listeners, setNodeRef, transform, isDragging: dndDragging } = useDraggable({
    id: activity.id,
    data: { activity, dayIndex: activity.day },
  });

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  const shouldHideOriginal = (dndDragging || isDragging) && !isDragCopy;
  const draggingStyle: React.CSSProperties = shouldHideOriginal
    ? { opacity: 0, zIndex: 50, pointerEvents: 'none' as const }
    : isDragging
      ? { opacity: 0.5, zIndex: 50, scale: '0.98' }
      : {};

  const handleClick = () => {
    if (deleteMode) {
      if (deletingRef.current) return;
      deletingRef.current = true;
      setDeleting(true);
      setTimeout(() => {
        const { id: _unused, ...rest } = activity;
        deleteActivity(activity.id);
        showToast(`«${activity.serviceName}» удалено`, () => addActivity(rest));
      }, 150);
    } else if (onEdit) {
      onEdit(activity);
    }
  };

  const handleQuickAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activity.isPrivate) {
      showToast('Редактирование индивидуального МК');
    } else {
      showToast('Быстрое добавление гостя');
    }
  };

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
        backgroundColor: artist.color,
        borderLeft: `3px solid ${artist.color}`,
        transition: 'opacity 150ms ease, transform 150ms ease',
        ...dragStyle,
        ...draggingStyle,
        ...style,
      }}
      data-testid={`activity-${activity.id}`}
      data-drag-id={activity.id}
    >
      {/* 1. HEADER — time pill + diamond */}
      <div className="flex justify-between items-start px-3 pt-2 pb-1">
        <span
          className="inline-block px-2 py-0.5 rounded-full text-[12px] font-semibold text-white"
          style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
        >
          {formatTime(activity.startTime)}–{formatTime(activity.startTime + activity.duration)}
        </span>
        {activity.isPrivate && (
          <svg className="w-5 h-5 flex-shrink-0 drop-shadow-sm" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1.5">
            <path d="M12 2l10 10-10 10L2 12z" />
          </svg>
        )}
      </div>

      {!showOnlyPill && (
        <>
          {/* 2. TITLE */}
          <div className="px-2 overflow-hidden">
            <div className="text-sm font-semibold leading-tight text-black">
              {activity.serviceName}
            </div>
          </div>

          {/* 3. AGE */}
          {showExtra && (
            <div className="flex items-center gap-1 px-2 text-[13px] text-black">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
              <span>{activity.minAge}</span>
            </div>
          )}

          {/* 3b. MASTER */}
          {showExtra && (
            <div className="px-2 text-[13px] text-black truncate" title={artist.name}>
              {artist.name}
            </div>
          )}

          {/* Spacer */}
          {showExtra && <div className="flex-1" />}

          {/* 4. LOCATION */}
          {showExtra && locationName && (
            <div className="flex items-center gap-1 px-2 pb-1 text-[13px] text-black">
              <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate">{locationName}</span>
            </div>
          )}

          {/* 5. FOOTER — full-width progress bar */}
          <div className="mx-1 mb-1 rounded-lg overflow-hidden relative">
            {/* Filled portion */}
            <div
              className="absolute inset-0 transition-all duration-300"
              style={{ width: `${fillPct * 100}%`, backgroundColor: 'rgba(0,0,0,0.20)' }}
            />
            {/* Unfilled portion */}
            <div
              className="absolute inset-0"
              style={{ left: `${fillPct * 100}%`, backgroundColor: 'rgba(0,0,0,0.06)' }}
            />
            {/* Content */}
            <div className="relative z-10 flex items-center justify-between px-2 py-1.5 text-[13px] text-black">
              <div className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
                <span className="font-medium">
                  {activity.occupied}/{activity.capacity}
                </span>
              </div>
              <button
                onClick={handleQuickAction}
                className="flex items-center justify-center w-7 h-7 rounded-full border transition-colors hover:bg-white/40"
                style={{ borderColor: 'rgba(0,0,0,0.3)', color: 'rgba(0,0,0,0.6)' }}
                aria-label={activity.isPrivate ? 'Редактировать' : 'Добавить гостя'}
              >
                {activity.isPrivate ? (
                  <span className="text-xs leading-none font-bold">···</span>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
