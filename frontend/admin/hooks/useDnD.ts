'use client';

import { useState, useCallback, useMemo } from 'react';
import type { ScheduleAdminDTO } from '@memo/domain';
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';

// Re-export types from @dnd-kit/core for reference.
// The hook uses simplified event shapes below since it only consumes a subset of fields.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { DragStartEvent as _DragStartEvent, DragEndEvent as _DragEndEvent, DragOverEvent as _DragOverEvent } from '@dnd-kit/core';

/** Update payload accepted by ScheduleDataContext.updateActivity (GH #142 minutes contract). */
type UpdateActivityInput = Parameters<ScheduleDataContextType['updateActivity']>[1];

interface UseDnDOptions {
  activities: ScheduleAdminDTO[];
  addActivity: ScheduleDataContextType['addActivity'];
  updateActivity: ScheduleDataContextType['updateActivity'];
  showToast: (message: string, undo?: () => void) => void;
  /** Grid frequency in minutes (5, 15, 30, or 60). DnD snaps dropped times to the nearest multiple. */
  gridFrequency?: number;
  /** When set, cross-column drops update this Activity field (e.g. 'masterId' or 'locationId'). */
  columnField?: 'masterId' | 'locationId';
}

/**
 * Simplified event types derived from @dnd-kit/core.
 * The hook only uses a subset of fields (active.id, active.data.current.activity, over.id),
 * so these interfaces avoid requiring the full library types (rect, disabled, etc.).
 */
interface DragStartEvent {
  active: { id: string | number; data: { current?: { activity?: ScheduleAdminDTO } } };
}

interface DragEndEvent {
  active: { id: string | number };
  over: { id: string | number; columnId?: string } | null;
}

interface DragOverEvent {
  over: { id: string | number; data: { current?: { dayIndex?: number; slotIndex?: number; columnId?: string } } } | null;
}

interface DragStartInput {
  altKey?: boolean;
}

interface GhostPosition {
  dayIndex: number;
  slotIndex: number;
  columnId?: string;
}

/**
 * Parse a droppable slot ID into { dayIndex, slotIndex, columnId? }.
 *
 * Supports two formats:
 *   - "slot-<dayIndex>-<slotIndex>" (legacy, numeric dayIndex)
 *   - "slot-<columnId>-<slotIndex>" (cross-column DnD, columnId is a string like a UUID)
 *
 * When the middle segment is non-numeric (UUID), we treat it as columnId and
 * default dayIndex to 0 (single-day views use dayIndex=0).
 */
export function parseSlotId(id: string): { dayIndex: number; slotIndex: number; columnId?: string } | null {
  const match = id.match(/^slot-(.+)-(\d+)$/);
  if (!match) return null;
  const middle = match[1];
  const slotIndex = parseInt(match[2], 10);
  const numericDay = /^\d+$/.test(middle);
  if (numericDay) {
    return { dayIndex: parseInt(middle, 10), slotIndex };
  }
  // Middle is a columnId (e.g. UUID) — dayIndex defaults to 0 for single-day views
  return { dayIndex: 0, slotIndex, columnId: middle };
}

/**
 * Calculate startMinutes (integer minutes from midnight) from slotIndex.
 * Each slot represents `gridFrequency` minutes; the grid begins at `gridStartMinutes`.
 *
 * slotIndexToMinutes(0, 30) = 540 (9:00), slotIndexToMinutes(1, 30) = 570 (9:30)
 * slotIndexToMinutes(0, 15) = 540 (9:00), slotIndexToMinutes(1, 15) = 555 (9:15)
 * slotIndexToMinutes(0, 5)  = 540 (9:00), slotIndexToMinutes(1, 5)  = 545 (9:05)
 */
export function slotIndexToMinutes(
  slotIndex: number,
  gridFrequency: number = 30,
  gridStartMinutes: number = 540,
): number {
  return gridStartMinutes + slotIndex * gridFrequency;
}

/**
 * Snap a minutes-from-midnight value to the nearest gridFrequency multiple.
 * Integer minutes — no float drift, no rounding hack.
 *
 * Example: snapToGrid(612, 15) → 615 (rounds 10:12 → 10:15)
 *          snapToGrid(540, 30) → 540 (already aligned)
 *          snapToGrid(546, 5)  → 545 (rounds 9:06 → 9:05)
 */
export function snapToGrid(minutes: number, gridFrequency: number): number {
  if (gridFrequency <= 0 || gridFrequency > 60) return minutes;
  return Math.round(minutes / gridFrequency) * gridFrequency;
}

export function useDnD({ activities, addActivity, updateActivity, showToast, gridFrequency = 30, columnField }: UseDnDOptions) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragCopy, setDragCopy] = useState(false);
  const [ghostPosition, setGhostPosition] = useState<GhostPosition | null>(null);
  const [activeDragActivity, setActiveDragActivity] = useState<ScheduleAdminDTO | null>(null);

  /** The snapped start (integer minutes from midnight) during drag. Shows as preview on the card. */
  const draggedSnappedTime = useMemo(() => {
    if (!ghostPosition || !activeDragActivity) return null;
    return snapToGrid(slotIndexToMinutes(ghostPosition.slotIndex, gridFrequency), gridFrequency);
  }, [ghostPosition, activeDragActivity, gridFrequency]);

  const onDragStart = useCallback(
    (event: DragStartEvent, input?: DragStartInput) => {
      const activity = event.active.data?.current?.activity;
      if (activity) {
        setDragId(String(event.active.id));
        setActiveDragActivity(activity);
        setDragCopy(!!input?.altKey);
        setGhostPosition(null);
      }
    },
    [],
  );

  const onDragOver = useCallback((event: DragOverEvent) => {
    if (event.over) {
      const parsed = parseSlotId(String(event.over.id));
      if (parsed) {
        // Prefer columnId from droppable data (more reliable), fall back to parsed
        const columnId = event.over.data?.current?.columnId ?? parsed.columnId;
        setGhostPosition({ ...parsed, columnId });
      }
    }
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;
      if (!over) {
        setDragId(null);
        setDragCopy(false);
        setGhostPosition(null);
        setActiveDragActivity(null);
        return;
      }

      const parsed = parseSlotId(String(over.id));
      if (!parsed) {
        setDragId(null);
        setDragCopy(false);
        setGhostPosition(null);
        setActiveDragActivity(null);
        return;
      }

      const { dayIndex, slotIndex, columnId: parsedColumnId } = parsed;
      const newStartMinutes = snapToGrid(slotIndexToMinutes(slotIndex, gridFrequency), gridFrequency);

      // Use over.columnId if provided, otherwise fall back to parsed columnId
      const targetColumnId = over.columnId ?? parsedColumnId;

      if (dragCopy && activeDragActivity) {
        // Create a copy at the new position (optionally in a different column)
        addActivity({
          dayIndex,
          masterId: columnField === 'masterId' && targetColumnId ? targetColumnId : activeDragActivity.masterId,
          serviceId: activeDragActivity.serviceId,
          locationId: columnField === 'locationId' && targetColumnId ? targetColumnId : activeDragActivity.locationId,
          startMinutes: newStartMinutes,
          durationMinutes: activeDragActivity.durationMinutes,
          capacity: activeDragActivity.capacity,
          isPrivate: activeDragActivity.isPrivate,
        });
        showToast('Событие скопировано');
      } else if (dragId) {
        // Move existing activity
        const original = activities.find((a) => a.id === dragId);
        if (original) {
          const updates: UpdateActivityInput = {
            dayIndex,
            startMinutes: newStartMinutes,
          };

          // Cross-column update: change masterId or locationId when dropped on a different column
          if (columnField && targetColumnId && original[columnField] !== targetColumnId) {
            updates[columnField] = targetColumnId;
          }

          updateActivity(dragId, updates);

          // Undo callback — restore the original DTO position (day/startMinutes)
          const undo = () => {
            const undoUpdates: UpdateActivityInput = {
              dayIndex: original.day,
              startMinutes: original.startMinutes,
            };
            if (columnField && targetColumnId && original[columnField] !== targetColumnId) {
              undoUpdates[columnField] = original[columnField];
            }
            updateActivity(dragId, undoUpdates);
          };
          showToast('Событие перемещено', undo);
        }
      }

      setDragId(null);
      setDragCopy(false);
      setGhostPosition(null);
      setActiveDragActivity(null);
    },
    [dragId, dragCopy, activeDragActivity, activities, addActivity, updateActivity, showToast, gridFrequency, columnField],
  );

  const handleDragCancel = useCallback(() => {
    setDragId(null);
    setDragCopy(false);
    setGhostPosition(null);
    setActiveDragActivity(null);
  }, []);

  return {
    dragId,
    dragCopy,
    ghostPosition,
    activeDragActivity,
    draggedSnappedTime,
    onDragStart,
    onDragOver,
    onDragEnd,
    handleDragCancel,
  };
}
