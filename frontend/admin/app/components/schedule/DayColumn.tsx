'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { hexToRgb, mixWithWhite, formatTime, generateTimeSlots, HOURS_START, HOURS_END } from '@/lib/utils';
import type { Activity, Master, Studio, StampState, Service } from '@memo/domain';
import { ActivityCard } from './ActivityCard';
import { OverlapPopover } from './OverlapPopover';

// ─── Time-Groups Carousel Model ──────────────────────────────────────
// Activities are grouped by their START time into fixed time windows.
// Each group has its own carousel that cycles independently.

type TimeGroup = {
  id: 'G1' | 'G2' | 'G3';
  start: number;
  end: number;
};

const TIME_GROUPS: TimeGroup[] = [
  { id: 'G1', start: 9, end: 13 },    // 09:00–12:59
  { id: 'G2', start: 13, end: 16 },   // 13:00–15:59
  { id: 'G3', start: 16, end: 24 },   // 16:00–23:59
];

function getGroupForActivity(activity: Activity): TimeGroup | undefined {
  return TIME_GROUPS.find(g => activity.startTime >= g.start && activity.startTime < g.end);
}

function getGroupForTime(time: number): TimeGroup | undefined {
  return TIME_GROUPS.find(g => time >= g.start && time < g.end);
}

interface DayColumnProps {
  dayIndex: number;
  date: Date;
  activities: Activity[];
  masters: Master[];
  studios?: Studio[];
  services?: Service[];
  dragCopy?: boolean;
  dragId?: string | null;
  ghostHeight?: number | null;
  ghostDayIndex?: number | null;
  ghostSlotIndex?: number | null;
  ghostColumnId?: string | null;
  onCreateActivity?: (dayIndex: number, startTime: number) => void;
  onOpenCreateModal?: (dayIndex: number, startTime: number) => void;
  onOpenEditModal?: (activity: Activity) => void;
  onQuickAdd?: (activity: Activity) => void;
  stampReady?: boolean;
  stamp?: StampState;
  cellHeight?: number;
  gridFrequency?: number;
  gridStart?: number;
  gridEnd?: number;
  /** Column identity (master or location ID) — included in droppable slot data for cross-column DnD. */
  columnId?: string;
}

interface DroppableSlotProps {
  dayIndex: number;
  slotIndex: number;
  startTime: number;
  isHour: boolean;
  isHalfHour?: boolean;
  dragCopy?: boolean;
  onClick?: (dayIndex: number, startTime: number) => void;
  onOpenModal?: (dayIndex: number, startTime: number) => void;
  stampReady?: boolean;
  stamp?: StampState;
  masters?: Master[];
  services?: Service[];
  cellHeight?: number;
  columnId?: string;
  /** When true, suppress slot-level isOver border (column ghost already covers it) */
  suppressIsOverGhost?: boolean;
  children?: React.ReactNode;
}

// ─── DroppableSlot ────────────────────────────────────────────────────────

function DroppableSlot({ dayIndex, slotIndex, startTime, isHour, isHalfHour, dragCopy, onClick, onOpenModal, stampReady, stamp, masters, services, cellHeight = 60, columnId, suppressIsOverGhost, children }: DroppableSlotProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${columnId ?? dayIndex}-${slotIndex}`,
    data: { type: 'slot', dayIndex, slotIndex, columnId },
  });

  const [hoveredStampSlot, setHoveredStampSlot] = useState<number | null>(null);

  const showStampGhost = stampReady && hoveredStampSlot === slotIndex && !isOver;
  const stampGhostPreview = showStampGhost && stamp?.masterId && stamp?.serviceId
    ? (() => {
        const master = masters?.find(a => a.id === stamp.masterId);
        const service = services?.find(s => s.id === stamp.serviceId);
        if (!master || !service) return null;
        const rgb = hexToRgb(master.color);
        const endTime = startTime + service.duration;
        return { master, service, rgb, endTime };
      })()
    : null;

  const stampGhostStyle: React.CSSProperties | null = (stampReady && isOver && stamp?.masterId && masters)
    ? (() => {
        const master = masters.find(a => a.id === stamp.masterId);
        if (!master) return null;
        const rgb = hexToRgb(master.color);
        const mixed = mixWithWhite(rgb, 0.85);
        return {
          border: `2px dashed ${dragCopy ? '#22c55e' : 'var(--brand, #004D56)'}`,
          backgroundColor: dragCopy ? 'rgba(34,197,94,0.06)' : `rgba(${mixed.r}, ${mixed.g}, ${mixed.b}, 0.15)`,
          pointerEvents: 'none',
          zIndex: 30,
          position: 'relative' as const,
        };
      })()
    : !suppressIsOverGhost && isOver
      ? {
          border: `2px dashed ${dragCopy ? '#22c55e' : 'var(--brand, #004D56)'}`,
          backgroundColor: dragCopy ? 'rgba(34,197,94,0.06)' : 'rgba(0,77,86,0.085)',
          borderRadius: '12px',
          pointerEvents: 'none',
          zIndex: 30,
          position: 'relative' as const,
          margin: '1px 6px',
        }
      : {};

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (stampReady && e.target === e.currentTarget) {
      setHoveredStampSlot(slotIndex);
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setHoveredStampSlot(null);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (!stampReady && onOpenModal) {
        onOpenModal(dayIndex, startTime);
      } else if (onClick) {
        onClick(dayIndex, startTime);
      }
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-testid={`slot-${columnId ?? dayIndex}-${slotIndex}`}
      data-slot-index={slotIndex}
      className={isHour ? 'border-t border-line' : isHalfHour ? 'border-t border-dashed border-line' : 'border-t border-dotted border-line/30'}
      style={{ height: cellHeight, ...stampGhostStyle }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {stampGhostPreview && (
        <div
          data-stamp-ghost
          className="absolute inset-x-1 rounded-lg pointer-events-none overflow-hidden flex flex-col"
          style={{
            top: 0,
            height: cellHeight * 2,
            border: '2px dashed rgba(0,77,86,0.3)',
            backgroundColor: `rgba(${stampGhostPreview.rgb.r}, ${stampGhostPreview.rgb.g}, ${stampGhostPreview.rgb.b}, 0.08)`,
            borderLeft: `3px solid ${stampGhostPreview.master.color}`,
            zIndex: 25,
          }}
        >
          <div className="px-2 pt-1.5 pb-1">
            <span
              className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-semibold text-white opacity-60"
              style={{ backgroundColor: stampGhostPreview.master.color }}
            >
              {formatTime(startTime)}–{formatTime(stampGhostPreview.endTime)}
            </span>
          </div>
          <div className="px-2 opacity-50">
            <div className="text-xs font-semibold leading-tight line-clamp-1">
              {stampGhostPreview.service.name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DayColumn ────────────────────────────────────────────────────────────

export function DayColumn({ dayIndex, activities, masters, studios = [], services = [], dragCopy, dragId, ghostHeight, ghostDayIndex, ghostSlotIndex, ghostColumnId, onCreateActivity, onOpenCreateModal, onOpenEditModal, onQuickAdd, stampReady, stamp, cellHeight = 60, gridFrequency = 30, gridStart = HOURS_START, gridEnd = HOURS_END, columnId }: DayColumnProps) {
  const [popoverData, setPopoverData] = useState<{
    activities: Activity[];
    anchorRect: DOMRect;
  } | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const lastWheelTime = useRef(0);

  // Generate slots at gridFrequency intervals. Slot height is scaled to keep total grid height constant.
  const slotHeight = useMemo(() => cellHeight * (gridFrequency / 30), [cellHeight, gridFrequency]);
  const slots = useMemo(() => generateTimeSlots(gridFrequency, gridStart, gridEnd), [gridFrequency, gridStart, gridEnd]);

  const masterMap = useMemo(() => new Map(masters.map(a => [a.id, a])), [masters]);

  // When a column-level ghost is active for this column, suppress individual slot-level isOver borders
  const hasColumnGhost = ghostColumnId === columnId && ghostSlotIndex != null && ghostHeight != null;

  // Per-card z-index: each activity has ONE z-index (0 = frontmost) used everywhere.
  // Each activity's z is its position within its time group (sorted by startTime).
  // Re-initialize when activities change (e.g., navigating to a new date).
  const [zIndices, setZIndices] = useState<Record<string, number>>({});
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  useEffect(() => {
    const initial: Record<string, number> = {};
    for (const act of activities) {
      const group = getGroupForActivity(act);
      if (!group) {
        initial[act.id] = 0;
        continue;
      }
      const activitiesInGroup = activities.filter(a => getGroupForActivity(a)?.id === group.id);
      const sorted = [...activitiesInGroup].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      const indexInGroup = sorted.findIndex(a => a.id === act.id);
      initial[act.id] = indexInGroup >= 0 ? indexInGroup : 0;
    }
    setZIndices(initial);
    setActiveGroupId(null); // reset active group on new activities
  }, [activities]);

  // Non-passive wheel handler for scroll carousel
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheelTime.current < 200) {
        e.preventDefault();
        return;
      }

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;

      // Find the activity under cursor
      let actUnderCursor: Activity | undefined;
      for (const act of activities) {
        const topPx = (act.startTime - gridStart) * cellHeight * 2;
        const durMinutes = act.durationMinutes ?? act.duration * 60;
        const heightPx = Math.max((durMinutes / 60) * cellHeight * 2, 52);
        if (y >= topPx && y <= topPx + heightPx) {
          actUnderCursor = act;
          break;
        }
      }
      if (!actUnderCursor) return;

      // Get the time-group of the activity under cursor
      const group = getGroupForActivity(actUnderCursor);
      if (!group) return;

      // Get all activities in the same time group
      const groupActivities = activities
        .filter(a => getGroupForActivity(a)?.id === group.id)
        .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));

      if (groupActivities.length <= 1) return;

      e.preventDefault();
      lastWheelTime.current = now;

      // Set active group for background rendering
      setActiveGroupId(group.id);

      const direction = e.deltaY > 0 ? 1 : -1;  // 1 = scroll down, -1 = scroll up

      setZIndices(prev => {
        const newZ = { ...prev };
        const sorted = [...groupActivities].sort((a, b) => (prev[a.id] ?? 0) - (prev[b.id] ?? 0));
        for (let i = 0; i < sorted.length; i++) {
          newZ[sorted[i].id] = direction === 1
            ? (i - 1 + sorted.length) % sorted.length
            : (i + 1) % sorted.length;
        }
        return newZ;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [dayIndex, slots, activities, cellHeight, gridStart, zIndices, slotHeight]);

  return (
    <div
      ref={columnRef}
      data-testid={`day-column-${dayIndex}`}
      data-day-column={dayIndex}
      className="relative flex-1 border-l border-line"
    >
      {slots.map((hour, i) => {
        const isHour = hour % 1 === 0;
        const isHalfHour = !isHour && Math.abs(hour % 0.5) < 0.01;
        return (
          <DroppableSlot
            key={i}
            dayIndex={dayIndex}
            slotIndex={i}
            startTime={hour}
            isHour={isHour}
            isHalfHour={isHalfHour}
            dragCopy={dragCopy}
            onClick={onCreateActivity}
            onOpenModal={onOpenCreateModal}
            stampReady={stampReady}
            stamp={stamp}
            masters={masters}
            services={services}
            cellHeight={slotHeight}
            columnId={columnId}
            suppressIsOverGhost={hasColumnGhost}
          />
        );
      })}

      {/* Drag ghost — single continuous dashed outline spanning all target slots */}
      {(ghostColumnId != null ? ghostColumnId === columnId : ghostDayIndex === dayIndex) && ghostSlotIndex != null && ghostHeight != null && (
        <div
          className="absolute inset-x-1 rounded-xl pointer-events-none z-[30]"
          style={{
            top: ghostSlotIndex * slotHeight,
            height: ghostHeight * slotHeight,
            border: '2px dashed #004D56',
            backgroundColor: 'rgba(0,77,86,0.06)',
          }}
        />
      )}

      {/* Render activity cards */}
      {activities.map((activity) => {
        // Get z-index for this card (per-card model)
        const z = zIndices[activity.id] ?? 0;

        // Get the time-group for this activity
        const activityGroup = getGroupForActivity(activity);

        // Count total activities in the same time group
        const totalInGroup = activityGroup
          ? activities.filter(a => getGroupForActivity(a)?.id === activityGroup.id).length
          : 1;

        // Determine if this activity is in the active group
        const isActive = activeGroupId !== null && activityGroup?.id === activeGroupId;
        const isBackground = activeGroupId !== null && activityGroup !== undefined && activityGroup.id !== activeGroupId;

        let cardOpacity = 1;
        let cardScale = 1;
        let cardZIndex = 20;
        let isClickable = true;

        let ox = 0;
        let oy = 0;

        if (isBackground) {
          // Background: other group, always behind active
          cardOpacity = 0.3;
          cardScale = 1;
          cardZIndex = 10;
          isClickable = false;
        } else if (totalInGroup > 1) {
          isClickable = z === 0;
          cardOpacity = z === 0 ? 1 : Math.max(0, 1 - (z * 0.15));
          cardScale = z === 0 ? 1 : Math.max(0.8, 1 - (z * 0.04));
          cardZIndex = z === 0 ? 25 : 25 - z;
          ox = (12 - z) * z;
          oy = (12 - z) * z;
        }

        const master = masterMap.get(activity.masterId) || masters[0];
        const isThisDragging = dragId === activity.id;

        // Badge: show only for active cards where totalInGroup > 1 and z === 0
        const showBadge = totalInGroup > 1 && z === 0 && !isBackground;

        return (
          <React.Fragment key={activity.id}>
            <ActivityCard
              activity={activity}
              master={master}
              studios={studios}
              onEdit={onOpenEditModal}
              onQuickAdd={onQuickAdd}
              isDragging={isThisDragging}
              isDragCopy={dragCopy}
              gridStart={gridStart}
              style={{
                transform: `translate(${ox}px, ${oy}px) scale(${cardScale})`,
                zIndex: cardZIndex,
                opacity: cardOpacity,
                pointerEvents: isClickable ? 'auto' : 'none',
                transition: 'opacity 300ms ease, transform 300ms ease',
              }}
            />
            {/* "N cards" badge for multi-event slots — opens OverlapPopover */}
            {showBadge && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Get all activities in the same time group, sorted by z-order
                  const groupActivities = activities
                    .filter(a => getGroupForActivity(a)?.id === activityGroup?.id)
                    .sort((a, b) => (zIndices[a.id] ?? 0) - (zIndices[b.id] ?? 0));
                  // Toggle: close if same group, otherwise open
                  if (popoverData?.activities === groupActivities) {
                    setPopoverData(null);
                  } else {
                    setPopoverData({
                      activities: groupActivities,
                      anchorRect: e.currentTarget.getBoundingClientRect(),
                    });
                  }
                }}
                className="absolute right-1 z-[35] px-1.5 py-0.5 rounded-full bg-white/90 border border-gray-300 text-[10px] font-semibold text-gray-500 shadow-sm hover:bg-white hover:text-gray-700 transition-colors cursor-pointer"
                style={{
                  top: (activity.startTime - gridStart) * cellHeight * 2 + 2,
                }}
                title="View all overlapping cards"
              >
                {totalInGroup} cards
              </button>
            )}
          </React.Fragment>
        );
      })}

      {/* OverlapPopover — shows all overlapping cards in column layout */}
      {popoverData && (
        <OverlapPopover
          activities={popoverData.activities}
          masterMap={masterMap}
          studios={studios}
          anchorRect={popoverData.anchorRect}
          cellHeight={cellHeight}
          gridStart={gridStart}
          onClose={() => setPopoverData(null)}
          onSelectActivity={(act) => {
            setPopoverData(null);
            onOpenEditModal?.(act);
          }}
        />
      )}

    </div>
  );
}
