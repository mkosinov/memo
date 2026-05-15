import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDnD } from '../hooks/useDnD';
import type { Activity } from '../lib/types';
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
    minAge: '12+',
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
    minAge: '6+',
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
});
