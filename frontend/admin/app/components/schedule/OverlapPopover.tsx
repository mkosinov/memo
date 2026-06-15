'use client';

import React, { useEffect, useRef } from 'react';
import type { Activity, Master, Studio } from '@memo/domain';
import { formatTime, HOURS_START } from '@/lib/utils';
import { ActivityCard } from './ActivityCard';

interface OverlapPopoverProps {
  activities: Activity[];
  masterMap: Map<string, Master>;
  studios: Studio[];
  onClose: () => void;
  onSelectActivity: (activity: Activity) => void;
  anchorRect: DOMRect;
  cellHeight: number;
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

export function OverlapPopover({
  activities,
  masterMap,
  studios,
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

  // Position below anchor
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
    zIndex: 100,
  };

  return (
    <div ref={popoverRef} style={style} data-testid="overlap-popover" className="bg-white rounded-lg shadow-xl border max-h-[400px] overflow-auto">
      <div className="flex">
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
              const master = masterMap.get(act.masterId) || masters[0];
              const topPx = (act.startTime - gridStart) * cellHeight * 2;
              const durMinutes = act.durationMinutes ?? act.duration * 60;
              const heightPx = Math.max((durMinutes / 60) * cellHeight * 2 - 10, 52);

              return (
                <div
                  key={act.id}
                  className="absolute left-1 right-1"
                  style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                >
                  <ActivityCard
                    activity={act}
                    master={master}
                    studios={studios}
                    gridStart={gridStart}
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
