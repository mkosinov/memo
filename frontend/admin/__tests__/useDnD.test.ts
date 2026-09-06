import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDnD, snapToGrid, slotIndexToMinutes, parseSlotId } from '../hooks/useDnD';
import type { ScheduleAdminDTO } from '@memo/domain';

// ─── Fixtures (ScheduleAdminDTO — integer minutes, GH #142) ─────────────────

function createActivity(overrides: Partial<ScheduleAdminDTO> = {}): ScheduleAdminDTO {
  return {
    id: 'ev_1',
    day: 0,
    masterId: 'm1',
    serviceId: 's1',
    serviceTitle: 'Картина маслом',
    locationId: 'alpika',
    locationName: 'Альпика',
    masterName: 'Ольга Середа',
    masterColor: '#5B8C7A',
    date: '2026-06-15',
    time: '10:00',
    startMinutes: 600, // 10:00
    durationMinutes: 120, // 2 hours
    minAge: '12',
    maxAge: '99',
    occupied: 3,
    capacity: 8,
    isPrivate: false,
    comment: '',
    priceMin: 2500,
    priceMax: 5000,
    ...overrides,
  };
}

const mockActivities: ScheduleAdminDTO[] = [
  createActivity(),
  createActivity({
    id: 'ev_2',
    day: 2,
    masterId: 'm2',
    serviceId: 's2',
    serviceTitle: 'Картина акрилом',
    locationId: 'grand',
    locationName: 'Гранд Отель Поляна',
    masterName: 'Юлия Большакова',
    masterColor: '#6B7E9C',
    date: '2026-06-17',
    time: '14:30',
    startMinutes: 870, // 14:30
    durationMinutes: 90,
    minAge: '6',
    occupied: 4,
    capacity: 6,
  }),
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
    it('updates activity dayIndex and startMinutes when dropped on different slot', () => {
      const { result } = renderDnD();
      // Start drag
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      // Drop on slot-3-4 (day 3, slot 4 → 540 + 4*30 = 660 = 11:00)
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-3-4' },
        } as any);
      });
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        dayIndex: 3,
        startMinutes: 660,
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
      // Drop on slot-2-6 (day 2, 540 + 6*30 = 720 = 12:00)
      act(() => {
        result.current.onDragEnd({
          active: { id: 'ev_1' },
          over: { id: 'slot-2-6' },
        } as any);
      });
      expect(mocks.addActivity).toHaveBeenCalled();
      const added = mocks.addActivity.mock.calls[0][0];
      expect(added.dayIndex).toBe(2);
      expect(added.startMinutes).toBe(720);
      expect(added.masterId).toBe('m1');
      expect(added.durationMinutes).toBe(120);
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

    it('exposes draggedSnappedTime in minutes while hovering a slot', () => {
      const { result } = renderDnD();
      act(() => {
        result.current.onDragStart({
          active: { id: 'ev_1', data: { current: { activity: mockActivities[0] } } },
        } as any);
      });
      expect(result.current.draggedSnappedTime).toBeNull();
      act(() => {
        result.current.onDragOver({
          over: { id: 'slot-2-5', data: { current: { dayIndex: 2, slotIndex: 5 } } },
        } as any);
      });
      // slot 5 on the default 30-min grid → 540 + 5*30 = 690 (11:30)
      expect(result.current.draggedSnappedTime).toBe(690);
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
    it('calculates startMinutes correctly for slot 0 (9:00)', () => {
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
        dayIndex: 0,
        startMinutes: 540,
      });
    });

    it('calculates startMinutes correctly for slot 1 (9:30)', () => {
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
        dayIndex: 0,
        startMinutes: 570,
      });
    });

    it('calculates startMinutes correctly for slot 24 (21:00)', () => {
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
        dayIndex: 5,
        startMinutes: 1260,
      });
    });
  });

  describe('gridFrequency snapping', () => {
    it('snaps to 15-min grid when gridFrequency=15', () => {
      // With gridFrequency=15, slot-0-1 = 540 + 1*15 = 555 (9:15)
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
        dayIndex: 0,
        startMinutes: 555, // 9:15 — grid now has 15-min slots
      });
    });

    it('snaps to 5-min grid when gridFrequency=5', () => {
      // With gridFrequency=5, slot-0-1 = 540 + 1*5 = 545 (9:05) — exact integer
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
        dayIndex: 0,
        startMinutes: 545, // 9:05
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
        dayIndex: 0,
        startMinutes: 570,
      });
    });

    it('snaps to 60-min grid when gridFrequency=60', () => {
      // With gridFrequency=60, slot-0-1 = 540 + 1*60 = 600 (10:00)
      const { result } = renderDnDWithFrequency(60);
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
        dayIndex: 0,
        startMinutes: 600, // 10:00 — hourly grid
      });
    });

    it('snaps copied activity to gridFrequency on copy-drag', () => {
      // With gridFrequency=15, slot-2-6 = 540 + 6*15 = 630 (10:30)
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
      expect(added.startMinutes).toBe(630); // 10:30
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
        dayIndex: 0,
        startMinutes: 570,
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
        dayIndex: 0,
        startMinutes: 600,
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
        dayIndex: 0,
        startMinutes: 600,
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
        dayIndex: 0,
        startMinutes: 600,
        locationId: 'grand',
      });
    });

    it('updates masterId and startMinutes together', () => {
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
        dayIndex: 3,
        startMinutes: 780, // slot 8 → 540 + 8*30 = 780 (13:00)
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
      // Call undo — restores the original DTO position (day=0, startMinutes=600)
      undoFn();
      expect(mocks.updateActivity).toHaveBeenCalledWith('ev_1', {
        dayIndex: 0,
        startMinutes: 600,
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
        dayIndex: 0,
        startMinutes: 600,
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

  describe('slotIndexToMinutes (exported)', () => {
    it('returns 30-min intervals by default', () => {
      expect(slotIndexToMinutes(0)).toBe(540);
      expect(slotIndexToMinutes(1)).toBe(570);
      expect(slotIndexToMinutes(2)).toBe(600);
    });

    it('returns 15-min intervals when gridFrequency=15', () => {
      expect(slotIndexToMinutes(0, 15)).toBe(540);
      expect(slotIndexToMinutes(1, 15)).toBe(555);
      expect(slotIndexToMinutes(2, 15)).toBe(570);
      expect(slotIndexToMinutes(4, 15)).toBe(600);
    });

    it('returns 5-min intervals when gridFrequency=5', () => {
      expect(slotIndexToMinutes(0, 5)).toBe(540);
      expect(slotIndexToMinutes(1, 5)).toBe(545);
      expect(slotIndexToMinutes(6, 5)).toBe(570);
    });

    it('returns 60-min intervals when gridFrequency=60', () => {
      expect(slotIndexToMinutes(0, 60)).toBe(540);
      expect(slotIndexToMinutes(1, 60)).toBe(600);
      expect(slotIndexToMinutes(2, 60)).toBe(660);
    });

    it('honors a custom gridStartMinutes', () => {
      expect(slotIndexToMinutes(0, 30, 480)).toBe(480); // 8:00 grid start
      expect(slotIndexToMinutes(2, 30, 480)).toBe(540); // 8:00 + 2*30 = 9:00
      expect(slotIndexToMinutes(1, 15, 600)).toBe(615); // 10:00 + 15 = 10:15
    });
  });

  describe('snapToGrid (exported, minute space)', () => {
    it('returns same minutes when already aligned to gridFrequency=30', () => {
      expect(snapToGrid(540, 30)).toBe(540);
      expect(snapToGrid(570, 30)).toBe(570);
      expect(snapToGrid(600, 30)).toBe(600);
    });

    it('returns same minutes when already aligned to gridFrequency=15', () => {
      expect(snapToGrid(540, 15)).toBe(540);
      expect(snapToGrid(555, 15)).toBe(555); // 9:15
      expect(snapToGrid(570, 15)).toBe(570); // 9:30
      expect(snapToGrid(585, 15)).toBe(585); // 9:45
    });

    it('returns same minutes when already aligned to gridFrequency=5', () => {
      expect(snapToGrid(540, 5)).toBe(540);
      expect(snapToGrid(545, 5)).toBe(545); // 9:05
      expect(snapToGrid(550, 5)).toBe(550); // 9:10
      expect(snapToGrid(555, 5)).toBe(555); // 9:15
    });

    it('returns same minutes when already aligned to gridFrequency=60', () => {
      expect(snapToGrid(540, 60)).toBe(540); // 9:00
      expect(snapToGrid(600, 60)).toBe(600); // 10:00
    });

    it('rounds 10:12 to 10:15 when gridFrequency=15', () => {
      expect(snapToGrid(612, 15)).toBe(615); // 10:15
    });

    it('rounds 10:21 to 10:15 when gridFrequency=15 (rounds down)', () => {
      expect(snapToGrid(621, 15)).toBe(615); // 10:15 (closer than 10:30)
    });

    it('rounds 10:20 to 10:20 when gridFrequency=5', () => {
      expect(snapToGrid(620, 5)).toBe(620);
    });

    it('rounds 10:22 to 10:20 when gridFrequency=5', () => {
      expect(snapToGrid(622, 5)).toBe(620); // 10:20
    });

    it('rounds to the nearest hour when gridFrequency=60', () => {
      expect(snapToGrid(612, 60)).toBe(600); // 10:12 → 10:00
      expect(snapToGrid(630, 60)).toBe(660); // 10:30 → 11:00 (half rounds up)
      expect(snapToGrid(640, 60)).toBe(660); // 10:40 → 11:00
    });

    it('does not change minutes for invalid gridFrequency', () => {
      expect(snapToGrid(612, 0)).toBe(612);
      expect(snapToGrid(612, -5)).toBe(612);
      expect(snapToGrid(612, 90)).toBe(612);
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
