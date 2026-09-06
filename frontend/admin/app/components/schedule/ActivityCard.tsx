'use client';

import React, { useState, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useUI } from '@/contexts/UIContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import type { ScheduleAdminDTO, Master, Location } from '@memo/domain';
import { formatTime } from '@/lib/datetime';

interface ActivityCardProps {
  activity: ScheduleAdminDTO;
  master: Master;
  locations?: Location[];
  style?: React.CSSProperties;
  onEdit?: (activity: ScheduleAdminDTO) => void;
  onQuickAdd?: (activity: ScheduleAdminDTO) => void;
  isDragging?: boolean;
  isDragCopy?: boolean;
  /** Grid start in minutes from midnight (GH #142). */
  gridStart?: number;
}

export function ActivityCard({ activity, master, locations = [], style, onEdit, onQuickAdd, isDragging, isDragCopy, gridStart = 540 }: ActivityCardProps) {
  const { deleteMode, showToast } = useUI();
  const { deleteActivity, addActivity, cellHeight = 60 } = useSchedule();
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const topPx = (activity.startMinutes - gridStart) * cellHeight / 30 + 4;        // +4 top margin
  const durMinutes = activity.durationMinutes;
  const heightPx = Math.max(durMinutes * cellHeight / 30 - 8, 60);                // -8 bottom, min 60
  const fillPct = activity.capacity > 0 ? Math.min(activity.occupied / activity.capacity, 1) : 0;

  // Tier selection (replaces old showExtra/showOnlyPill)
  const isTiny = durMinutes < 60;
  const isCompact = !isTiny && durMinutes < 90;
  const isStandard = !isTiny && !isCompact;
  const hasFooter = isStandard;

  // Master visibility rule
  // Element heights (px): header=26, title+age=20 (1 line) / 40 (2 lines),
  // master=18, location=24, footer=44. Thresholds sum these so the card
  // has room for master without silent vertical clipping.
  // Standard (with footer): want2Line=134, canFit2+master=152, canFit1+master=132
  // Compact  (no footer):   want2Line=90,  canFit2+master=108, canFit1+master=88
  const want2LineTitle        = heightPx >= (hasFooter ? 134 : 90);
  const canFit2LineWithMaster = heightPx >= (hasFooter ? 152 : 108);
  const canFit1LineWithMaster = heightPx >= (hasFooter ? 132 : 88);
  const titleLines = want2LineTitle ? 2 : 1;
  const showMaster = titleLines === 2 ? canFit2LineWithMaster : canFit1LineWithMaster;

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
        deleteActivity(activity.id);
        showToast(`«${activity.serviceTitle}» удалено`, () => addActivity({
          dayIndex: activity.day,
          masterId: activity.masterId,
          serviceId: activity.serviceId,
          locationId: activity.locationId,
          startMinutes: activity.startMinutes,
          durationMinutes: activity.durationMinutes,
          capacity: activity.capacity,
          isPrivate: activity.isPrivate,
          comment: activity.comment,
        }));
      }, 150);
    } else if (onEdit) {
      onEdit(activity);
    }
  };

  const handleQuickAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    onQuickAdd?.(activity);
  };

  const foundLocation = locations.find(l => l.id === activity.locationId);
  const locationShortName = foundLocation?.shortTitle || foundLocation?.name || '';

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
        backgroundColor: master.color,
        border: 'none',
        transition: 'opacity 150ms ease, transform 150ms ease',
        ...dragStyle,
        ...draggingStyle,
        ...style,
      }}
      data-testid={`activity-${activity.id}`}
      data-drag-id={activity.id}
    >
      {/* 1. HEADER — time pill + diamond (flush top-left) */}
      <div className="flex justify-between items-start">
        <span
          className="inline-block px-2 py-1 rounded-br-lg text-[12px] font-semibold text-white"
          style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
        >
          {formatTime(activity.startMinutes)}–{formatTime(activity.startMinutes + activity.durationMinutes)}
        </span>
        {activity.isPrivate && (
          <svg className="w-5 h-5 flex-shrink-0 drop-shadow-sm mt-1 mr-1" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
            <path d="M12 2L2 9l10 13 10-13L12 2z" />
            <path d="M2 9h20" />
            <path d="M12 2v20" />
            <path d="M7 9l5 13 5-13" />
          </svg>
        )}
      </div>

      {/* 2. TITLE + AGE (line-clamp-2, age on right if fits) */}
      <div className="px-2 overflow-hidden">
        <div className="flex items-start gap-1">
          <div
            className={`text-sm font-semibold leading-tight text-black flex-1 min-w-0 ${titleLines === 2 ? 'line-clamp-2' : 'truncate'}`}
            title={activity.serviceTitle}
          >
            {activity.serviceTitle}
          </div>
          <span className="flex-shrink-0 text-[12px] text-black/70 font-normal">
            {activity.minAge}{activity.maxAge ? `–${activity.maxAge}` : '+'}
          </span>
        </div>
      </div>

      {!isTiny && (
        <>
          {/* 3b. MASTER — only if it fits */}
          {showMaster && (
            <div className="px-2 text-[13px] text-black truncate" title={master.name}>
              {master.name}
            </div>
          )}

          {/* Spacer — only when master is shown */}
          {showMaster && <div className="flex-1" />}

          {/* 4. LOCATION (Compact and Standard) + capacity right (Compact only) */}
          {locationShortName && (
            <div className="flex items-center gap-1 px-2 pb-1 text-[13px] text-black">
              <svg
                className="w-3 h-3 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="truncate flex-1" title={locationShortName}>
                {locationShortName}
              </span>
              {!isStandard && (
                <span className="flex-shrink-0" data-testid="compact-capacity">
                  {activity.occupied}/{activity.capacity}
                </span>
              )}
            </div>
          )}

          {/* 5. FOOTER — full-width progress bar (Standard only) */}
          {isStandard && (
            <div className="mx-0 mb-0 rounded-xl overflow-hidden relative" style={{ border: '1px solid rgba(0,0,0,0.15)' }}>
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
                data-testid="btn-quick-add"
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
          )}
        </>
      )}
    </div>
  );
}
