'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { HOURS_START, HOURS_END, CELL_HEIGHT, hexToRgb, mixWithWhite, formatTime } from '@/lib/utils';
import type { Activity, Artist, Studio, StampState, Service } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { NowLine } from './NowLine';

interface DayColumnProps {
  dayIndex: number;
  date: Date;
  activities: Activity[];
  artists: Artist[];
  studios?: Studio[];
  services?: Service[];
  dragCopy?: boolean;
  dragId?: string | null;
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

function DroppableSlot({ dayIndex, slotIndex, startTime, isHour, dragCopy, onClick, onOpenModal, stampReady, stamp, artists, services, children }: DroppableSlotProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${dayIndex}-${slotIndex}`,
    data: { dayIndex, slotIndex },
  });

  // Hover-based stamp ghost preview state
  const [hoveredStampSlot, setHoveredStampSlot] = useState<number | null>(null);

  // Compute stamp ghost data for hover preview
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

  // Issue 10: Stamp ghost preview — show approximate card when stamp is ready and hovering
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
    // Only trigger if clicking the slot itself (not a child card)
    if (e.target === e.currentTarget) {
      if (!stampReady && onOpenModal) {
        // Stamp not ready → open modal for manual creation
        onOpenModal(dayIndex, startTime);
      } else if (onClick) {
        // Stamp ready → quick create with stamp params
        onClick(dayIndex, startTime);
      }
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-slot-index={slotIndex}
      className={isHour ? 'border-t border-gray-200' : 'border-t border-dashed border-gray-100'}
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

export function DayColumn({ dayIndex, date, activities, artists, studios = [], services = [], dragCopy, dragId, onCreateActivity, onOpenCreateModal, onOpenEditModal, stampReady, stamp }: DayColumnProps) {
  const [visibleIndices, setVisibleIndices] = useState<Record<string, number>>({});
  const columnRef = useRef<HTMLDivElement>(null);

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

  // Store slotGroups in ref so the wheel handler always has fresh data
  const slotGroupsRef = useRef(slotGroups);
  slotGroupsRef.current = slotGroups;

  // Non-passive wheel handler for scroll carousel (allows preventDefault)
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top + el.scrollTop;
      const slotIndex = Math.floor(y / CELL_HEIGHT);
      if (slotIndex >= 0 && slotIndex < slots.length) {
        const slotHour = slots[slotIndex];
        const key = `${dayIndex}_${slotHour}`;
        const group = slotGroupsRef.current[key];
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
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [dayIndex]);

  return (
    <div
      ref={columnRef}
      data-testid={`day-column-${dayIndex}`}
      className="relative flex-1 border-l border-gray-100"
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

      {/* Render activity cards */}
      {activities.map((activity) => {
        const key = `${dayIndex}_${activity.startTime}`;
        const group = slotGroups[key];
        const indexInGroup = group.indexOf(activity);
        const totalInSlot = group.length;
        const visibleIndex = visibleIndices[key] || 0;
        const isVisible = totalInSlot <= 1 || indexInGroup === visibleIndex;

        const artist = artists.find((a) => a.id === activity.masterId) || artists[0];
        const isThisDragging = dragId === activity.id;

        return (
          <ActivityCard
            key={activity.id}
            activity={activity}
            artist={artist}
            studios={studios}
            onEdit={onOpenEditModal}
            isDragging={isThisDragging}
            isDragCopy={dragCopy}
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
