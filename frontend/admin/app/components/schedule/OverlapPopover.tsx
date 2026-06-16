'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import type { Activity, Master, Studio } from '@memo/domain';
import { formatTime, HOURS_START } from '@/lib/utils';
import { ActivityCard } from './ActivityCard';

interface OverlapPopoverProps {
  activities: Activity[];
  masterMap: Map<string, Master>;
  studios?: Studio[];
  onClose: () => void;
  onSelectActivity: (activity: Activity) => void;
  anchorRect: DOMRect;
  cellHeight?: number;
  gridStart?: number;
}

/**
 * Assigns activities to minimal columns without time intersections.
 * Greedy algorithm: each activity goes to first available column.
 */
function assignColumns(activities: Activity[]): Activity[][] {
  const sorted = [...activities].sort((a, b) => a.startTime - b.startTime);
  const columns: Activity[][] = [];

  for (const act of sorted) {
    let placed = false;
    for (const col of columns) {
      const lastInCol = col[col.length - 1];
      if (act.startTime >= lastInCol.startTime + lastInCol.duration) {
        col.push(act);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([act]);
    }
  }

  return columns;
}

/** Screen edge constants */
const POPOVER_MAX_HEIGHT = 400;
const SCREEN_PADDING = 8;
const ANCHOR_GAP = 4;

export function OverlapPopover({
  activities,
  masterMap,
  studios = [],
  onClose,
  onSelectActivity,
  anchorRect,
  cellHeight = 60,
  gridStart = HOURS_START,
}: OverlapPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const columns = assignColumns(activities);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Calculate timeline bounds (same scale as main schedule)
  const allStarts = activities.map(a => a.startTime);
  const allEnds = activities.map(a => a.startTime + a.duration);
  const timelineStart = Math.floor(Math.min(...allStarts));
  const timelineEnd = Math.ceil(Math.max(...allEnds));
  const hours = Array.from({ length: timelineEnd - timelineStart + 1 }, (_, i) => timelineStart + i);

  // Position with smart screen edge alignment
  const popoverStyle: React.CSSProperties = useMemo(() => {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 768;

    const POPOVER_DEFAULT_WIDTH = 400;

    const s: React.CSSProperties = {
      position: 'fixed',
      zIndex: 100,
    };

    // Vertical: prefer below, flip above if no space
    const spaceBelow = screenHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    if (spaceBelow >= POPOVER_MAX_HEIGHT || spaceBelow > spaceAbove) {
      s.top = anchorRect.bottom + ANCHOR_GAP;
      s.maxHeight = Math.min(POPOVER_MAX_HEIGHT, spaceBelow - SCREEN_PADDING);
    } else {
      s.top = Math.max(SCREEN_PADDING, anchorRect.top - POPOVER_MAX_HEIGHT - ANCHOR_GAP);
      s.maxHeight = Math.min(POPOVER_MAX_HEIGHT, spaceAbove - SCREEN_PADDING);
    }

    // Horizontal: pill always aligns with LEFT or RIGHT edge of popover
    const spaceRight = screenWidth - anchorRect.left;
    const spaceLeft = anchorRect.right;

    if (spaceRight >= POPOVER_DEFAULT_WIDTH) {
      // Plenty of space to the right — align LEFT edge of popover with LEFT edge of pill
      s.left = anchorRect.left;
    } else if (spaceLeft >= POPOVER_DEFAULT_WIDTH) {
      // Not enough space to the right, but enough to the left
      // Align RIGHT edge of popover with RIGHT edge of pill
      s.right = screenWidth - anchorRect.right;
    } else {
      // Neither side has enough space — center on screen with max-width
      const maxWidth = screenWidth - SCREEN_PADDING * 2;
      s.left = SCREEN_PADDING;
      s.right = SCREEN_PADDING;
      s.width = maxWidth;
    }

    // Always cap width to screen
    s.maxWidth = screenWidth - SCREEN_PADDING * 2;

    return s;
  }, [anchorRect]);

  return (
    <div
      ref={popoverRef}
      style={popoverStyle}
      data-testid="overlap-popover"
      className="bg-white rounded-lg shadow-xl border overflow-auto relative"
    >
      {/* Close button */}
      <button
        data-testid="overlap-popover-close"
        onClick={onClose}
        className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label="Close popover"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex pr-6">
        {/* Timeline column — same scale as main schedule */}
        <div className="w-12 flex-shrink-0 border-r border-gray-200">
          {hours.map(h => (
            <div
              key={h}
              className="flex items-center text-[10px] text-gray-500 px-1"
              style={{ height: cellHeight * 2 }}
            >
              {formatTime(h)}
            </div>
          ))}
        </div>

        {/* Activity columns */}
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="relative" style={{ minWidth: '120px' }}>
            {col.map(act => {
              const master = masterMap.get(act.masterId) || { id: '', name: 'Unknown', shortName: '?', color: '#666' };
              // Use timelineStart (popover's own start) instead of gridStart (main schedule start)
              const topPx = (act.startTime - timelineStart) * cellHeight * 2;
              const durMinutes = act.durationMinutes ?? act.duration * 60;
              const heightPx = Math.max((durMinutes / 60) * cellHeight * 2 - 10, 52);

              return (
                <div
                  key={act.id}
                  data-testid={`popover-slot-${act.id}`}
                  className="absolute left-1 right-1"
                  style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                >
                  <ActivityCard
                    activity={act}
                    master={master}
                    studios={studios}
                    gridStart={timelineStart}
                    onEdit={onSelectActivity}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      height: '100%',
                      cursor: 'pointer',
                    }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
