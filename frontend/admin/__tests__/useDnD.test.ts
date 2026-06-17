import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDnD, snapToGrid, slotIndexToTime, parseSlotId } from '../hooks/useDnD';
import type { Activity } from '@memo/domain';
import { HOURS_START } from '../lib/utils';

const mockActivities: Activity[] = [
  {
    id: 'ev_1',
    day: 0,
    masterId: 'm1',
    startTime: 10,
    duration: 2,
    serviceId: 's1',
    serviceName: 'Картина маслом',
    minAge: '12',
    locationId: 'alpika',
    occupied: 3,
    capacity: 8,
    isPrivate: false,
  },
  {
    id: 'ev_2',
    day: 2,
    masterId: 'm2',
    startTime: 14.5,
    duration: 1.5,
    serviceId: 's2',
    serviceName: 'Картина акрилом',
    minAge: '6',
    locationId: 'grand',
    occupied: 4,
    capacity: 6,
    isPrivate: false,
  },
];

function createMocks() {
  return {
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    showToast: vi.fn(),
    activities: mockActivities,
  };
}

describe('useDnD', () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  function renderDnD() {
    return renderHook(() =>
      useDnD({
        activities: mocks.activities,
        addActivity: mocks.addActivity,
        updateActivity: mocks.updateActivity,
        showToast: mocks.showToast,
      }),
    );
  }

  function renderDnDWithFrequency(freq: number) {
    return renderHook(() =>
      useDnD({
        activities: mocks.activities,
        addActivity: mocks.addActivity,
        updateActivity: mocks.updateActivity,
        showToast: mocks.showToast,
        gridFrequency: freq,
      }),
    );
  }

  describe('initial state', () => {
    it('starts with no dragId', () => {
      const { result } = renderDnD();
      expect(result.current.dragId).toBeNull();
    });

    it('starts with dragCopy false', () => {
      const { result } = renderDnD();
      expect(result.current.dragCopy).toBe(false);
    });

    it('starts with no ghostPosition', () => {
      const { result } = renderDnD();
      expect(result.current.ghostPosition).toBeNull();
    });
  });

  describe('onDragStart', () => {
    it('sets dragId to the dragged activity id', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      expect(result.current.dragId).toBe('ev_1');
    });

    it('sets dragCopy to true when altKey is pressed', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: true });
      });
      expect(result.current.dragCopy).toBe(true);
    });

    it('keeps dragCopy false when altKey is not pressed', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: false });
      });
      expect(result.current.dragCopy).toBe(false);
    });

    it('returns the dragged activity for DragOverlay', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      expect(result.current.activeDragActivity).toEqual(mockActivities[0]);
    });
  });

  describe('onDragEnd', () => {
    it('updates activity day and startTime when dropped on different slot', () => {
      const { result } = renderDnD();
      // Start drag
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      // Drop on slot-3-4 (day 3, slot 4 → 9:00 + 4*0.5 = 11:00)
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-3-4' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 3,
        startTime: HOURS_START + 4 * 0.5,
      });
    });

    it('creates new activity when in copy mode', () => {
      const { result } = renderDnD();
      // Start drag with alt key
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: true });
      });
      // Drop
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-2-6' },
        } as any);
      });
      expect(mocks.addActivity).toHaveBeenCalled();
      const added = mocks.addActivity.mock.calls[0][0];
      expect(added.day).toBe(2);
      expect(added.startTime).toBe(HOURS_START + 6 * 0.5);
      expect(added.masterId).toBe('m1');
      expect(added.duration).toBe(2);
    });

    it('shows toast on successful drop', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-1-2' },
        } as any);
      });
      expect(mocks.showToast).toHaveBeenCalledWith('Событие перемещено', expect.any(Function));
    });

    it('does nothing when dropped outside droppable', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: null,
        } as any);
      });
      expect(mocks.updateActivity).not.toHaveBeenCalled();
      expect(mocks.addActivity).not.toHaveBeenCalled();
    });

    it('resets state after drop', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-0' },
        } as any);
      });
      expect(result.current.dragId).toBeNull();
      expect(result.current.dragCopy).toBe(false);
      expect(result.current.ghostPosition).toBeNull();
      expect(result.current.activeDragActivity).toBeNull();
    });
  });

  describe('handleDragCancel', () => {
    it('resets all drag state', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: true });
      });
      act(() => {
        result.current.handleDragCancel();
      });
      expect(result.current.dragId).toBeNull();
      expect(result.current.dragCopy).toBe(false);
      expect(result.current.ghostPosition).toBeNull();
      expect(result.current.activeDragActivity).toBeNull();
    });
  });

  describe('ghostPosition', () => {
    it('updates ghostPosition when dragging over a slot', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragOver({
          over: { id: 'slot-2-5', data: { current: { dayIndex: 2, slotIndex: 5 } } },
        } as any);
      });
      expect(result.current.ghostPosition).toEqual({ dayIndex: 2, slotIndex: 5 });
    });

    it('clears ghostPosition on drag end', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragOver({
          over: { id: 'slot-1-3', data: { current: { dayIndex: 1, slotIndex: 3 } } },
        } as any);
      });
      expect(result.current.ghostPosition).toEqual({ dayIndex: 1, slotIndex: 3 });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-1-3' },
        } as any);
      });
      expect(result.current.ghostPosition).toBeNull();
    });
  });

  describe('snap calculation', () => {
    it('calculates startTime correctly for slot 0 (9:00)', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-0' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 9,
      });
    });

    it('calculates startTime correctly for slot 1 (9:30)', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-1' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 9.5,
      });
    });

    it('calculates startTime correctly for slot 24 (21:00)', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-5-24' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 5,
        startTime: 21,
      });
    });
  });

  describe('gridFrequency snapping', () => {
    it('snaps to 15-min grid when gridFrequency=15', () => {
      // With gridFrequency=15, slot-0-1 = 9 + 1*(15/60) = 9.25 (9:15)
      const { result } = renderDnDWithFrequency(15);
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-1' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 9.25, // 9:15 — grid now has 15-min slots
      });
    });

    it('snaps to 5-min grid when gridFrequency=5', () => {
      // With gridFrequency=5, slot-0-1 = 9 + 1*(5/60) = 9.083… (9:05)
      const { result } = renderDnDWithFrequency(5);
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-1' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: expect.closeTo(9 + 5 / 60, 10), // 9:05
      });
    });

    it('snaps to 30-min grid when gridFrequency=30 (default)', () => {
      const { result } = renderDnDWithFrequency(30);
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-1' },
        } as any);
      });
      // 9:30 is already a 30-min multiple
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 9.5,
      });
    });

    it('snaps copied activity to gridFrequency on copy-drag', () => {
      // With gridFrequency=15, slot-2-6 = 9 + 6*(15/60) = 9 + 1.5 = 10.5 (10:30)
      const { result } = renderDnDWithFrequency(15);
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: true });
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-2-6' },
        } as any);
      });
      expect(mocks.addActivity).toHaveBeenCalled();
      const added = mocks.addActivity.mock.calls[0][0];
      expect(added.startTime).toBe(10.5); // 10:30
    });

    it('defaults gridFrequency to 30 when not provided', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-1' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 9.5,
      });
    });
  });

  describe('cross-column DnD (columnField)', () => {
    function renderDnDWithColumnField(field: 'masterId' | 'locationId') {
      return renderHook(() =>
        useDnD({
          activities: mocks.activities,
          addActivity: mocks.addActivity,
          updateActivity: mocks.updateActivity,
          showToast: mocks.showToast,
          columnField: field,
        }),
      );
    }

    it('updates masterId when dropping on a different master column', () => {
      const { result } = renderDnDWithColumnField('masterId');
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      // ev_1 has masterId='m1', drop on column m2
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-2', columnId: 'm2' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 10,
        masterId: 'm2',
      });
    });

    it('does NOT update masterId when dropping on the same master column', () => {
      const { result } = renderDnDWithColumnField('masterId');
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      // ev_1 has masterId='m1', drop on column m1 (same)
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-2', columnId: 'm1' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 10,
      });
    });

    it('updates locationId when columnField=locations', () => {
      const { result } = renderDnDWithColumnField('locationId');
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      // ev_1 has locationId='alpika', drop on column grand
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-2', columnId: 'grand' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 10,
        locationId: 'grand',
      });
    });

    it('updates masterId and startTime together', () => {
      const { result } = renderDnDWithColumnField('masterId');
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      // Drop on a different time AND different master
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-3-8', columnId: 'm2' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 3,
        startTime: 13, // slot 8 → 9 + 8*0.5 = 13
        masterId: 'm2',
      });
    });

    it('undo callback restores both time and column', () => {
      const { result } = renderDnDWithColumnField('masterId');
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-1-4', columnId: 'm2' },
        } as any);
      });
      // Get the undo callback from the toast call
      const toastCall = mocks.showToast.mock.calls.find(
        (call: unknown[]) => call[0] === 'Событие перемещено',
      );
      expect(toastCall).toBeTruthy();
      const undoFn = toastCall![1] as () => void;
      // Call undo
      undoFn();
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 10,
        masterId: 'm1',
      });
    });

    it('does not include columnField when no columnField option', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-2', columnId: 'm2' },
        } as any);
      });
      // Should NOT include masterId since columnField is not set
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        day: 0,
        startTime: 10,
      });
    });

    it('copies activity to a different column with columnField', () => {
      const { result } = renderHook(() =>
        useDnD({
          activities: mocks.activities,
          addActivity: mocks.addActivity,
          updateActivity: mocks.updateActivity,
          showToast: mocks.showToast,
          columnField: 'masterId',
        }),
      );
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: true });
      });
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-0-4', columnId: 'm2' },
        } as any);
      });
      expect(mocks.addActivity).toHaveBeenCalled();
      const added = mocks.addActivity.mock.calls[0][0];
      expect(added.masterId).toBe('m2'); // Should use target column's masterId
      expect(added.locationId).toBe('alpika'); // locationId stays the same
    });
  });

  describe('slotIndexToTime (exported)', () => {
    it('returns 30-min intervals by default', () => {
      expect(slotIndexToTime(0)).toBe(9);
      expect(slotIndexToTime(1)).toBe(9.5);
      expect(slotIndexToTime(2)).toBe(10);
    });

    it('returns 15-min intervals when gridFrequency=15', () => {
      expect(slotIndexToTime(0, 15)).toBe(9);
      expect(slotIndexToTime(1, 15)).toBe(9.25);
      expect(slotIndexToTime(2, 15)).toBe(9.5);
      expect(slotIndexToTime(4, 15)).toBe(10);
    });

    it('returns 5-min intervals when gridFrequency=5', () => {
      expect(slotIndexToTime(0, 5)).toBe(9);
      expect(slotIndexToTime(1, 5)).toBeCloseTo(9 + 5 / 60, 10);
      expect(slotIndexToTime(6, 5)).toBeCloseTo(9.5, 10);
    });
  });

  describe('snapToGrid (exported)', () => {
    it('returns same time when already aligned to gridFrequency=30', () => {
      expect(snapToGrid(9.0, 30)).toBe(9.0);
      expect(snapToGrid(9.5, 30)).toBe(9.5);
      expect(snapToGrid(10.0, 30)).toBe(10.0);
    });

    it('returns same time when already aligned to gridFrequency=15', () => {
      expect(snapToGrid(9.0, 15)).toBe(9.0);
      expect(snapToGrid(9.25, 15)).toBe(9.25);  // 9:15
      expect(snapToGrid(9.5, 15)).toBe(9.5);     // 9:30
      expect(snapToGrid(9.75, 15)).toBe(9.75);   // 9:45
    });

    it('returns same time when already aligned to gridFrequency=5', () => {
      expect(snapToGrid(9.0, 5)).toBe(9.0);
      expect(snapToGrid(9 + 5/60, 5)).toBeCloseTo(9 + 5/60, 10);   // 9:05
      expect(snapToGrid(9 + 10/60, 5)).toBeCloseTo(9 + 10/60, 10);  // 9:10
      expect(snapToGrid(9 + 15/60, 5)).toBeCloseTo(9 + 15/60, 10);  // 9:15
    });

    it('rounds 10:12 to 10:15 when gridFrequency=15', () => {
      // 10:12 = 10 + 12/60 = 10.2
      const result = snapToGrid(10.2, 15);
      expect(result).toBeCloseTo(10.25, 10); // 10:15
    });

    it('rounds 10:21 to 10:15 when gridFrequency=15 (rounds down)', () => {
      // 10:21 = 10 + 21/60 = 10.35
      const result = snapToGrid(10.35, 15);
      expect(result).toBeCloseTo(10.25, 10); // 10:15 (closer than 10:30)
    });

    it('rounds 10:20 to 10:20 when gridFrequency=5', () => {
      // 10:20 = 10 + 20/60 = 10.333...
      const result = snapToGrid(10 + 20/60, 5);
      expect(result).toBeCloseTo(10 + 20/60, 10);
    });

    it('rounds 10:22 to 10:20 when gridFrequency=5', () => {
      // 10:22 = 10 + 22/60 = 10.366...
      const result = snapToGrid(10 + 22/60, 5);
      expect(result).toBeCloseTo(10 + 20/60, 10); // 10:20
    });

    it('does not change time for invalid gridFrequency', () => {
      expect(snapToGrid(10.2, 0)).toBe(10.2);
      expect(snapToGrid(10.2, -5)).toBe(10.2);
      expect(snapToGrid(10.2, 90)).toBe(10.2);
    });
  });

  describe('parseSlotId (exported)', () => {
    it('parses legacy numeric format "slot-3-4"', () => {
      expect(parseSlotId('slot-3-4')).toEqual({ dayIndex: 3, slotIndex: 4 });
    });

    it('parses legacy "slot-0-0"', () => {
      expect(parseSlotId('slot-0-0')).toEqual({ dayIndex: 0, slotIndex: 0 });
    });

    it('parses UUID columnId format "slot-abc123-5"', () => {
      const result = parseSlotId('slot-abc123-5');
      expect(result).toEqual({ dayIndex: 0, slotIndex: 5, columnId: 'abc123' });
    });

    it('parses UUID columnId format with dashes', () => {
      const result = parseSlotId('slot-a1b2c3d4-e5f6-7-10');
      expect(result).toEqual({ dayIndex: 0, slotIndex: 10, columnId: 'a1b2c3d4-e5f6-7' });
    });

    it('returns null for invalid IDs', () => {
      expect(parseSlotId('invalid')).toBeNull();
      expect(parseSlotId('slot-')).toBeNull();
      expect(parseSlotId('slot-3')).toBeNull();
    });
  });

  describe('ghostPosition with columnId', () => {
    it('includes columnId in ghostPosition from droppable data', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragOver({
          over: {
            id: 'slot-m1-5',
            data: { current: { dayIndex: 0, slotIndex: 5, columnId: 'm1' } },
          },
        } as any);
      });
      expect(result.current.ghostPosition).toEqual({
        dayIndex: 0,
        slotIndex: 5,
        columnId: 'm1',
      });
    });

    it('falls back to columnId from slot ID when data.current has no columnId', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragOver({
          over: {
            id: 'slot-m2-3',
            data: { current: { dayIndex: 0, slotIndex: 3 } },
          },
        } as any);
      });
      expect(result.current.ghostPosition).toEqual({
        dayIndex: 0,
        slotIndex: 3,
        columnId: 'm2',
      });
    });

    it('ghostPosition has no columnId for legacy numeric slot IDs', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      act(() => {
        result.current.onDragOver({
          over: {
            id: 'slot-2-5',
            data: { current: { dayIndex: 2, slotIndex: 5 } },
          },
        } as any);
      });
      expect(result.current.ghostPosition).toEqual({ dayIndex: 2, slotIndex: 5 });
    });
  });

  describe('cross-column copy with columnId', () => {
    it('copies activity to a different master column via slot ID', () => {
      const { result } = renderHook(() =>
        useDnD({
          activities: mocks.activities,
          addActivity: mocks.addActivity,
          updateActivity: mocks.updateActivity,
          showToast: mocks.showToast,
          columnField: 'masterId',
        }),
      );
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any, { altKey: true });
      });
      // Drop on column m2 via slot ID
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-m2-4', columnId: 'm2' },
        } as any);
      });
      expect(mocks.addActivity).toHaveBeenCalled();
      const added = mocks.addActivity.mock.calls[0][0];
      expect(added.masterId).toBe('m2');
      expect(added.locationId).toBe('alpika'); // unchanged
    });
  });
});
