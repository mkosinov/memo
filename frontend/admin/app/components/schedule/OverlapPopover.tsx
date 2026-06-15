'use client';

import React, { useEffect, useRef } from 'react';
import type { Activity, Master } from '@memo/domain';
import { formatTime } from '@/lib/utils';

interface OverlapPopoverProps {
  activities: Activity[];
  masterMap: Map<string, Master>;
  onClose: () => void;
  onSelectActivity: (activity: Activity) => void;
  anchorRect: DOMRect;
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

const HOUR_PX = 32;

export function OverlapPopover({ activities, masterMap, onClose, onSelectActivity, anchorRect }: OverlapPopoverProps) {
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

  // Calculate timeline bounds
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
    <div ref={popoverRef} style={style} data-testid="overlap-popover" className="bg-white rounded-lg shadow-xl border p-3 max-h-[300px] overflow-auto">
      <div className="flex gap-2">
        {/* Timeline column */}
        <div className="w-10 flex-shrink-0">
          {hours.map(h => (
            <div key={h} className="flex items-center text-[10px] text-gray-500" style={{ height: HOUR_PX }}>
              {formatTime(h)}
            </div>
          ))}
        </div>

        {/* Activity columns */}
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="relative" style={{ minWidth: '80px' }}>
            {col.map(act => {
              const top = (act.startTime - timelineStart) * HOUR_PX;
              const height = act.duration * HOUR_PX;
              const master = masterMap.get(act.masterId);
              return (
                <button
                  key={act.id}
                  onClick={() => onSelectActivity(act)}
                  className="absolute inset-x-0.5 rounded p-1 text-left text-[10px] text-white font-medium overflow-hidden hover:opacity-90 transition-opacity"
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    backgroundColor: master?.color || '#666',
                  }}
                >
                  <div className="font-semibold">{formatTime(act.startTime)}</div>
                  <div className="truncate">{act.serviceName}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
