'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { hexToRgb, mixWithWhite, formatTime, generateTimeSlots, HOURS_START, HOURS_END } from '@/lib/utils';
import type { Activity, Master, Studio, StampState, Service } from '@memo/domain';
import { ActivityCard } from './ActivityCard';
import { OverlapPopover } from './OverlapPopover';

// ─── Direct Overlap Helpers (carousel) ─────────────────────────────────
// Two activities overlap if their time ranges intersect (pairwise, NOT transitive).

function getDirectOverlapGroup(activity: Activity, all: Activity[]): Activity[] {
  const aStart = activity.startTime;
  const aEnd = activity.startTime + activity.duration;
  const peers = all.filter((b) => {
    if (b.id === activity.id) return false;
    return aStart < b.startTime + b.duration && b.startTime < aEnd;
  });
  return [activity, ...peers].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
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

  // z-array per slot: key = slot time, value = activity IDs in z-order (index 0 = front)
  const [zOrders, setZOrders] = useState<Record<number, string[]>>(() => {
    const initial: Record<number, string[]> = {};
    for (const slot of slots) {
      const activeAtSlot = activities.filter(a => {
        const aStart = a.startTime;
        const aEnd = a.startTime + a.duration;
        return aStart <= slot && aEnd > slot;
      });
      initial[slot] = activeAtSlot
        .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))
        .map(a => a.id);
    }
    return initial;
  });

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

      // Find which slot the cursor is in
      const slotIndex = Math.floor(y / slotHeight);
      const slotTime = slots[slotIndex];
      if (slotTime === undefined) return;

      // Get z-array for this slot
      const zArray = zOrders[slotTime];
      if (!zArray || zArray.length <= 1) return;

      // Check if frontmost activity (z=0) is under cursor
      const frontmostId = zArray[0];
      const frontmostActivity = activities.find(a => a.id === frontmostId);
      if (!frontmostActivity) return;

      const topPx = (frontmostActivity.startTime - gridStart) * cellHeight * 2;
      const durMinutes = frontmostActivity.durationMinutes ?? frontmostActivity.duration * 60;
      const heightPx = Math.max((durMinutes / 60) * cellHeight * 2, 52);

      if (y >= topPx && y <= topPx + heightPx) {
        // Frontmost card is under cursor — shift z-array for ALL slots in overlap zone
        e.preventDefault();
        lastWheelTime.current = now;

        const direction = e.deltaY > 0 ? 1 : -1;
        setZOrders(prev => {
          const newOrders = { ...prev };
          // Find all slots where the same set of activities is active
          const zArray = prev[slotTime] || [];
          for (const slot of slots) {
            const slotArr = newOrders[slot] || [];
            // Check if this slot has the same activities (same set of IDs)
            if (slotArr.length === zArray.length && 
                slotArr.every(id => zArray.includes(id))) {
              // Same group — apply the same shift
              const arr = [...slotArr];
              if (direction === 1) {
                const last = arr.pop()!;
                arr.unshift(last);
              } else {
                const first = arr.shift()!;
                arr.push(first);
              }
              newOrders[slot] = arr;
            }
          }
          return newOrders;
        });
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [dayIndex, slots, activities, cellHeight, gridStart, zOrders, slotHeight]);

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
        // Find the best slot for this activity: closest to startTime with overlap
        let bestSlot = Math.floor(activity.startTime);
        let bestTotal = 0;
        for (const slot of slots) {
          const arr = zOrders[slot] || [];
          if (arr.includes(activity.id) && arr.length > bestTotal) {
            bestSlot = slot;
            bestTotal = arr.length;
          }
        }

        const zArray = zOrders[bestSlot] || [];
        const totalInSlot = zArray.length;
        const z = zArray.indexOf(activity.id);
        const actualZ = z === -1 ? 0 : z;

        let cardOpacity = 1;
        let cardScale = 1;
        let cardZIndex = 20;
        let isClickable = true;

        let ox = 0;
        let oy = 0;
        
        if (totalInSlot > 1) {
          isClickable = actualZ === 0;
          cardOpacity = actualZ === 0 ? 1 : Math.max(0, 1 - (actualZ * 0.15));
          cardScale = actualZ === 0 ? 1 : Math.max(0.8, 1 - (actualZ * 0.04));
          cardZIndex = actualZ === 0 ? 25 : 25 - actualZ;
          ox = (12 - actualZ) * actualZ;
          oy = (12 - actualZ) * actualZ;
        }

        const master = masterMap.get(activity.masterId) || masters[0];
        const isThisDragging = dragId === activity.id;

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
            {totalInSlot > 1 && actualZ === 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Get all activities in z-order for this slot
                  const slotActivities = zArray
                    .map(id => activities.find(a => a.id === id))
                    .filter(Boolean) as Activity[];
                  // Toggle: close if same slot, otherwise open
                  if (popoverData?.activities === slotActivities) {
                    setPopoverData(null);
                  } else {
                    setPopoverData({
                      activities: slotActivities,
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
                {totalInSlot} cards
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
