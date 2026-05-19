'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { CELL_HEIGHT, hexToRgb, mixWithWhite, formatTime, generateTimeSlots, HOURS_START } from '@/lib/utils';
import type { Activity, Artist, Studio, StampState, Service } from '@memo/domain';
import { ActivityCard } from './ActivityCard';

// ─── Constants ────────────────────────────────────────────────────────────

const OVERLAP_OFFSET = 12;

// ─── Overlap Detection (sliding window) ─────────────────────────────────

function buildOverlapMap(activities: Activity[]): Map<string, { index: number; total: number }> {
  const result = new Map<string, { index: number; total: number }>();
  const sorted = [...activities].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  let active: Activity[] = []; // currently overlapping activities

  for (const a of sorted) {
    // Remove activities that ended before this one starts
    active = active.filter(prev => a.startTime < prev.startTime + prev.duration);

    const myIndex = active.length;
    const total = active.length + 1;

    // Update totals for all already-active activities
    for (const prev of active) {
      const cur = result.get(prev.id);
      if (cur && cur.total < total) {
        result.set(prev.id, { index: cur.index, total });
      }
    }

    result.set(a.id, { index: myIndex, total });
    active.push(a);
  }

  return result;
}

interface DayColumnProps {
  dayIndex: number;
  date: Date;
  activities: Activity[];
  artists: Artist[];
  studios?: Studio[];
  services?: Service[];
  dragCopy?: boolean;
  dragId?: string | null;
  ghostHeight?: number | null;
  ghostDayIndex?: number | null;
  ghostSlotIndex?: number | null;
  onCreateActivity?: (dayIndex: number, startTime: number) => void;
  onOpenCreateModal?: (dayIndex: number, startTime: number) => void;
  onOpenEditModal?: (activity: Activity) => void;
  stampReady?: boolean;
  stamp?: StampState;
}

interface DroppableSlotProps {
  dayIndex: number;
  slotIndex: number;
  startTime: number;
  isHour: boolean;
  dragCopy?: boolean;
  onClick?: (dayIndex: number, startTime: number) => void;
  onOpenModal?: (dayIndex: number, startTime: number) => void;
  stampReady?: boolean;
  stamp?: StampState;
  artists?: Artist[];
  services?: Service[];
  children?: React.ReactNode;
}

// ─── DroppableSlot ────────────────────────────────────────────────────────

function DroppableSlot({ dayIndex, slotIndex, startTime, isHour, dragCopy, onClick, onOpenModal, stampReady, stamp, artists, services, children }: DroppableSlotProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${dayIndex}-${slotIndex}`,
    data: { dayIndex, slotIndex },
  });

  const [hoveredStampSlot, setHoveredStampSlot] = useState<number | null>(null);

  const showStampGhost = stampReady && hoveredStampSlot === slotIndex && !isOver;
  const stampGhostPreview = showStampGhost && stamp?.masterId && stamp?.serviceId
    ? (() => {
        const master = artists?.find(a => a.id === stamp.masterId);
        const service = services?.find(s => s.id === stamp.serviceId);
        if (!master || !service) return null;
        const rgb = hexToRgb(master.color);
        const endTime = startTime + service.duration;
        return { master, service, rgb, endTime };
      })()
    : null;

  const stampGhostStyle: React.CSSProperties | null = (stampReady && isOver && stamp?.masterId && artists)
    ? (() => {
        const master = artists.find(a => a.id === stamp.masterId);
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
    : isOver
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
      data-slot-index={slotIndex}
      className={isHour ? 'border-t border-line' : 'border-t border-dashed border-line'}
      style={{ height: CELL_HEIGHT, ...stampGhostStyle }}
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
            height: CELL_HEIGHT * 2,
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

export function DayColumn({ dayIndex, activities, artists, studios = [], services = [], dragCopy, dragId, ghostHeight, ghostDayIndex, ghostSlotIndex, onCreateActivity, onOpenCreateModal, onOpenEditModal, stampReady, stamp }: DayColumnProps) {
  const [visibleIndices, setVisibleIndices] = useState<Record<string, number>>({});
  const [prevIndices, setPrevIndices] = useState<Record<string, number>>({});
  const columnRef = useRef<HTMLDivElement>(null);
  const wheelAccum = useRef(0);
  const lastWheelTime = useRef(0);
  const [animatingKeys, setAnimatingKeys] = useState<Set<string>>(new Set());

  const slots = useMemo(() => generateTimeSlots(), []);

  const artistMap = useMemo(() => new Map(artists.map(a => [a.id, a])), [artists]);

  // Group by startTime for stacking within same slot
  const slotGroups: Record<string, Activity[]> = {};
  for (const activity of activities) {
    const key = `${dayIndex}_${activity.startTime}`;
    if (!slotGroups[key]) slotGroups[key] = [];
    slotGroups[key].push(activity);
  }

  // Full range overlap detection (X+Y offset)
  const overlapMap = useMemo(() => buildOverlapMap(activities), [activities]);

  const slotGroupsRef = useRef(slotGroups);
  slotGroupsRef.current = slotGroups;

  // Non-passive wheel handler for scroll carousel
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const now = Date.now();
      // Throttle: max 1 card flip per 200ms
      if (now - lastWheelTime.current < 200) {
        wheelAccum.current += e.deltaY;
        e.preventDefault();
        return;
      }
      wheelAccum.current += e.deltaY;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      
      // Find which stacked group we are hovering over
      let targetKey: string | null = null;
      for (const act of activities) {
        const topPx = (act.startTime - HOURS_START) * CELL_HEIGHT * 2;
        const heightPx = Math.max(act.duration * 120 - 10, 52);
        if (y >= topPx && y <= topPx + heightPx) {
          const key = `${dayIndex}_${act.startTime}`;
          const group = slotGroupsRef.current[key];
          if (group && group.length > 1) {
            targetKey = key;
            break;
          }
        }
      }

      if (targetKey) {
        const key = targetKey;
        const group = slotGroupsRef.current[key];
        if (group && group.length > 1) {
          e.preventDefault();
          lastWheelTime.current = now;
          setVisibleIndices((prev) => {
            const current = prev[key] || 0;
            const direction = wheelAccum.current > 0 ? 1 : -1;
            const next = (current + direction + group.length) % group.length;
            return { ...prev, [key]: next };
          });
          wheelAccum.current = 0;
        }
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [dayIndex, slots]);

  return (
    <div
      ref={columnRef}
      data-testid={`day-column-${dayIndex}`}
      data-day-column={dayIndex}
      className="relative flex-1 border-l border-line"
    >
      {slots.map((hour, i) => (
        <DroppableSlot
          key={i}
          dayIndex={dayIndex}
          slotIndex={i}
          startTime={hour}
          isHour={hour % 1 === 0}
          dragCopy={dragCopy}
          onClick={onCreateActivity}
          onOpenModal={onOpenCreateModal}
          stampReady={stampReady}
          stamp={stamp}
          artists={artists}
          services={services}
        />
      ))}

      {/* Drag ghost — single continuous dashed outline spanning all target slots */}
      {ghostDayIndex === dayIndex && ghostSlotIndex != null && ghostHeight != null && (
        <div
          className="absolute inset-x-1 rounded-xl pointer-events-none z-[30]"
          style={{
            top: ghostSlotIndex * CELL_HEIGHT,
            height: ghostHeight * CELL_HEIGHT,
            border: '2px dashed #004D56',
            backgroundColor: 'rgba(0,77,86,0.06)',
          }}
        />
      )}

      {/* Render activity cards */}
      {activities.map((activity) => {
        const key = `${dayIndex}_${activity.startTime}`;
        const group = slotGroups[key];
        const indexInGroup = group.indexOf(activity);
        const totalInSlot = group.length;
        const visibleIndex = visibleIndices[key] || 0;

        let carouselOffsetX = 0;
        let carouselOffsetY = 0;
        let cardOpacity = 1;
        let cardScale = 1;
        let cardZIndex = 20;
        let isClickable = true;
        
        if (totalInSlot > 1) {
          const diff = (indexInGroup - visibleIndex + totalInSlot) % totalInSlot;
          isClickable = diff === 0;
          if (diff === 0) {
            carouselOffsetX = 0;
            carouselOffsetY = 0;
            cardOpacity = 1;
            cardScale = 1;
            cardZIndex = 25;
          } else {
            carouselOffsetX = diff * 8;
            carouselOffsetY = diff * 6;
            cardOpacity = Math.max(0, 1 - (diff * 0.15));
            cardScale = Math.max(0.8, 1 - (diff * 0.04));
            cardZIndex = 25 - diff;
          }
        }

        // Full overlap offset (X + Y)
        const overlapInfo = overlapMap.get(activity.id);
        const ox = overlapInfo ? overlapInfo.index * OVERLAP_OFFSET : 0;
        const oy = overlapInfo ? overlapInfo.index * OVERLAP_OFFSET : 0;

        const artist = artistMap.get(activity.masterId) || artists[0];
        const isThisDragging = dragId === activity.id;

        return (
          <React.Fragment key={activity.id}>
            <ActivityCard
              activity={activity}
              artist={artist}
              studios={studios}
              onEdit={onOpenEditModal}
              isDragging={isThisDragging}
              isDragCopy={dragCopy}
              style={{
                transform: `translate(${ox + carouselOffsetX}px, ${oy + carouselOffsetY}px) scale(${cardScale})`,
                zIndex: cardZIndex,
                opacity: cardOpacity,
                pointerEvents: isClickable ? 'auto' : 'none',
                transition: 'opacity 300ms ease, transform 300ms ease',
              }}
            />
            {/* "N cards" badge for multi-event slots — clickable to cycle */}
            {totalInSlot > 1 && indexInGroup === 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setVisibleIndices((prev) => {
                    const current = prev[key] || 0;
                    const next = (current + 1 + totalInSlot) % totalInSlot;
                    setPrevIndices(p => ({ ...p, [key]: current }));
                    setAnimatingKeys(prev => new Set(prev).add(key));
                    setTimeout(() => {
                      setAnimatingKeys(prev => {
                        const next_set = new Set(prev);
                        next_set.delete(key);
                        return next_set;
                      });
                    }, 350);
                    return { ...prev, [key]: next };
                  });
                }}
                className="absolute right-1 z-[35] px-1.5 py-0.5 rounded-full bg-white/90 border border-gray-300 text-[10px] font-semibold text-gray-500 shadow-sm hover:bg-white hover:text-gray-700 transition-colors cursor-pointer"
                style={{
                  top: (activity.startTime - 9) * CELL_HEIGHT * 2 + 2,
                }}
                title="Click to cycle through cards"
              >
                {totalInSlot} cards
              </button>
            )}
          </React.Fragment>
        );
      })}

    </div>
  );
}
