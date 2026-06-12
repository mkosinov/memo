'use client';

import { useState, useCallback, useMemo } from 'react';
import type { Activity } from '@memo/domain';
import { HOURS_START } from '@/lib/utils';

// Re-export types from @dnd-kit/core for reference.
// The hook uses simplified event shapes below since it only consumes a subset of fields.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { DragStartEvent as _DragStartEvent, DragEndEvent as _DragEndEvent, DragOverEvent as _DragOverEvent } from '@dnd-kit/core';

interface UseDnDOptions {
  activities: Activity[];
  addActivity: (activity: Omit<Activity, 'id'>) => void;
  updateActivity: (id: string, updates: Partial<Activity>) => void;
  showToast: (message: string, undo?: () => void) => void;
  /** Grid frequency in minutes (5, 15, or 30). DnD snaps dropped times to the nearest multiple. */
  gridFrequency?: number;
}

/**
 * Simplified event types derived from @dnd-kit/core.
 * The hook only uses a subset of fields (active.id, active.data.current.activity, over.id),
 * so these interfaces avoid requiring the full library types (rect, disabled, etc.).
 */
interface DragStartEvent {
  active: { id: string | number; data: { current?: { activity?: Activity } } };
}

interface DragEndEvent {
  active: { id: string | number };
  over: { id: string | number } | null;
}

interface DragOverEvent {
  over: { id: string | number; data: { current?: { dayIndex?: number; slotIndex?: number } } } | null;
}

interface DragStartInput {
  altKey?: boolean;
}

interface GhostPosition {
  dayIndex: number;
  slotIndex: number;
}

/**
 * Parse a droppable slot ID like "slot-3-4" into { dayIndex: 3, slotIndex: 4 }.
 * Returns null if the ID doesn't match the pattern.
 */
export function parseSlotId(id: string): { dayIndex: number; slotIndex: number } | null {
  const match = id.match(/^slot-(\d+)-(\d+)$/);
  if (!match) return null;
  return {
    dayIndex: parseInt(match[1], 10),
    slotIndex: parseInt(match[2], 10),
  };
}

/**
 * Calculate startTime from slotIndex. The visual grid always uses 30-minute
 * intervals, so each slot corresponds to 30 minutes regardless of gridFrequency.
 *
 * slotIndexToTime(0) = 9:00, slotIndexToTime(1) = 9:30, slotIndexToTime(2) = 10:00, etc.
 */
export function slotIndexToTime(slotIndex: number): number {
  return HOURS_START + slotIndex * 0.5;
}

/**
 * Snap a time value (in hours) to the nearest gridFrequency multiple.
 *
 * Example: snapToGrid(10.2, 15) → 10.25 (rounds 10:12 → 10:15)
 *          snapToGrid(9.0, 30)  → 9.0   (already aligned)
 *          snapToGrid(9.1, 5)   → 9.083… (rounds 9:06 → 9:05)
 */
export function snapToGrid(time: number, gridFrequency: number): number {
  if (gridFrequency <= 0 || gridFrequency > 60) return time;
  const minutes = time * 60;
  const snapped = Math.round(minutes / gridFrequency) * gridFrequency;
  return Math.round(snapped * 100) / 100 / 60; // avoid float drift
}

export function useDnD({ activities, addActivity, updateActivity, showToast, gridFrequency = 30 }: UseDnDOptions) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragCopy, setDragCopy] = useState(false);
  const [ghostPosition, setGhostPosition] = useState<GhostPosition | null>(null);
  const [activeDragActivity, setActiveDragActivity] = useState<Activity | null>(null);

  /** The snapped time during drag (derived from ghostPosition). Shows as preview on the card. */
  const draggedSnappedTime = useMemo(() => {
    if (!ghostPosition || !activeDragActivity) return null;
    return snapToGrid(slotIndexToTime(ghostPosition.slotIndex), gridFrequency);
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
        setGhostPosition(parsed);
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

      const { dayIndex, slotIndex } = parsed;
      const newStartTime = snapToGrid(slotIndexToTime(slotIndex), gridFrequency);

      if (dragCopy && activeDragActivity) {
        // Create a copy at the new position
        addActivity({
          day: dayIndex,
          masterId: activeDragActivity.masterId,
          startTime: newStartTime,
          duration: activeDragActivity.duration,
          durationMinutes: activeDragActivity.durationMinutes ?? activeDragActivity.duration * 60,
          serviceId: activeDragActivity.serviceId,
          serviceName: activeDragActivity.serviceName,
          minAge: activeDragActivity.minAge,
          locationId: activeDragActivity.locationId,
          occupied: activeDragActivity.occupied,
          capacity: activeDragActivity.capacity,
          isPrivate: activeDragActivity.isPrivate,
        });
        showToast('Событие скопировано');
      } else if (dragId) {
        // Move existing activity
        const original = activities.find((a) => a.id === dragId);
        if (original) {
          const updates: Partial<Activity> = {
            day: dayIndex,
            startTime: newStartTime,
          };
          updateActivity(dragId, updates);

          // Undo callback
          const undo = () => {
            updateActivity(dragId, {
              day: original.day,
              startTime: original.startTime,
            });
          };
          showToast('Событие перемещено', undo);
        }
      }

      setDragId(null);
      setDragCopy(false);
      setGhostPosition(null);
      setActiveDragActivity(null);
    },
    [dragId, dragCopy, activeDragActivity, activities, addActivity, updateActivity, showToast],
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
