'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { DndContext, DragOverlay, closestCorners, rectIntersection, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { useUI } from '@/contexts/UIContext';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import { useDnD } from '@/hooks/useDnD';
import { useColumnReorder } from '@/hooks/useColumnReorder';
import { resolveById } from '@memo/domain';
import type { ScheduleAdminDTO } from '@memo/domain';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';
import { ActivityCard } from './ActivityCard';
import { ScheduleColumnHeader, SortableColumnHeader } from './ScheduleColumnHeader';
import { ActivityDetailsModal } from '../modal/ActivityDetailsModal';
import { TIME_COL_WIDTH, isSameDay } from '@/lib/utils';
import { formatTime, toISODate } from '@/lib/datetime';

/**
 * Custom collision detection that separates column drags from activity drags.
 * When dragging a column header, only considers other column headers as drop targets.
 * When dragging an activity, uses standard closestCorners for slot-based drops.
 */
const separatedCollisionDetection: CollisionDetection = (args) => {
  const { active, droppableContainers } = args;
  const activeData = active.data?.current as Record<string, unknown> | undefined;

  if (activeData?.type === 'column') {
    // Column drag: only consider droppables that are columns (no type or type !== 'slot')
    const columnContainers = droppableContainers.filter((container) => {
      const containerData = container.data?.current as Record<string, unknown> | undefined;
      // Column headers from SortableContext don't have data.type set by useDroppable,
      // but they DO have data set by useSortable. We want containers that are NOT slots.
      return containerData?.type !== 'slot';
    });

    // Use rectIntersection for column-to-column (horizontal layout)
    return rectIntersection({
      ...args,
      droppableContainers: columnContainers,
    });
  }

  // Activity drag: standard closestCorners for slot-based drops
  return closestCorners(args);
};

export function DayView() {
  const {
    scheduleIndex,
    masters,
    services,
    locations,
    addActivity,
    updateActivity,
    loading,
    error,
    gridStartMinutes,
    gridEndMinutes,
  } = useScheduleData();
  const {
    stamp,
    filterMasterIds,
    filterLocationIds,
    selectedDay,
    columnMode,
  } = useScheduleView();
  const { cellHeight, gridFrequency } = useGridSettings();
  const { showToast } = useUI();
  const { getColumnOrder, settings, setColumnOrder: saveColumnOrder } = useUserSettings();

  // Active dragged column ghost state
  const [activeColumn, setActiveColumn] = useState<{ id: string; name: string } | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalActivity, setModalActivity] = useState<ScheduleAdminDTO | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'quickAdd'>('edit');

  const openCreateModal = useCallback((_dayIndex: number, _startMinutes: number) => {
    setModalActivity(null);
    setModalMode('edit');
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((activity: ScheduleAdminDTO) => {
    setModalActivity(activity);
    setModalMode('edit');
    setModalOpen(true);
  }, []);

  const openQuickAdd = useCallback((activity: ScheduleAdminDTO) => {
    setModalActivity(activity);
    setModalMode('quickAdd');
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalActivity(null);
  }, []);

  // Expose modal openers for E2E tests
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTestOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.activity) {
        openEditModal(detail.activity);
      }
    };

    const handleTestQuickAdd = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.activity) {
        openQuickAdd(detail.activity);
      }
    };

    const handleTestClose = () => {
      closeModal();
    };

    document.addEventListener('__memo-open-modal', handleTestOpen);
    document.addEventListener('__memo-quick-add', handleTestQuickAdd);
    document.addEventListener('__memo-close-modal', handleTestClose);
    return () => {
      document.removeEventListener('__memo-open-modal', handleTestOpen);
      document.removeEventListener('__memo-quick-add', handleTestQuickAdd);
      document.removeEventListener('__memo-close-modal', handleTestClose);
    };
  }, [openEditModal, openQuickAdd, closeModal]);

  const handleCreateActivity = React.useCallback(
    (dayIndex: number, startMinutes: number) => {
      if (!stamp.ready || !stamp.masterId || !stamp.serviceId || stamp.locations.size === 0) return;
      const service = services.find((s) => s.id === stamp.serviceId);
      if (!service) return;
      const firstLocation = stamp.locations.values().next().value as string;
      const location = locations.find((l) => l.id === firstLocation);

      addActivity({
        dayIndex,
        masterId: stamp.masterId,
        serviceId: stamp.serviceId,
        locationId: firstLocation,
        startMinutes,
        durationMinutes: service.durationMinutes,
        capacity: location?.defaultCapacity ?? 0,
        isPrivate: false,
      });

      showToast(`Создано: ${service.name} — ${formatTime(startMinutes)}`);
    },
    [stamp, services, locations, addActivity, showToast],
  );

  // Resolve activities for the selected day
  const selectedDayISO = useMemo(() => toISODate(selectedDay), [selectedDay]);

  const dayActivities = useMemo(() => {
    const ids = scheduleIndex.byDate.get(selectedDayISO) ?? [];
    return resolveById(ids, scheduleIndex.byId);
  }, [scheduleIndex, selectedDayISO]);

  // DnD — must be before `columns` so dragId/activeDragActivity are available
  const columnField = columnMode === 'locations' ? 'locationId' as const : 'masterId' as const;

  const {
    dragId,
    dragCopy,
    ghostPosition,
    activeDragActivity,
    draggedSnappedTime,
    onDragStart,
    onDragOver,
    onDragEnd,
    handleDragCancel,
  } = useDnD({
    activities: dayActivities,
    addActivity,
    updateActivity,
    showToast,
    gridFrequency,
    columnField,
  });

  // Determine columns based on filter selection and user column order preference
  const columns = useMemo(() => {
    if (columnMode === 'locations') {
      const allLocations = locations;
      // Empty filter = show all locations (ordered by user settings or default)
      if (filterLocationIds.length === 0) {
        const order = getColumnOrder('locations');
        return order.length > 0
          ? order.map(id => allLocations.find(l => l.id === id)).filter(Boolean) as typeof allLocations
          : allLocations;
      }
      // Filter active: show only filtered columns but respect user column order
      const filterSet = new Set(filterLocationIds);
      const order = getColumnOrder('locations');
      if (order.length > 0) {
        const ordered = order.filter(id => filterSet.has(id));
        // Append any filter IDs not in saved order (newly re-added columns)
        for (const id of filterLocationIds) {
          if (!ordered.includes(id)) {
            ordered.push(id);
          }
        }
        return ordered
          .map(id => allLocations.find(l => l.id === id))
          .filter(Boolean) as typeof allLocations;
      }
      return filterLocationIds
        .map(id => allLocations.find(l => l.id === id))
        .filter(Boolean) as typeof allLocations;
    } else {
      const allMasters = masters;
      // Empty filter = show all masters (ordered by user settings or default)
      if (filterMasterIds.length === 0) {
        const order = getColumnOrder('masters');
        return order.length > 0
          ? order.map(id => allMasters.find(m => m.id === id)).filter(Boolean) as typeof allMasters
          : allMasters;
      }
      // Filter active: show only filtered columns but respect user column order
      const filterSet = new Set(filterMasterIds);
      const order = getColumnOrder('masters');
      if (order.length > 0) {
        const ordered = order.filter(id => filterSet.has(id));
        // Append any filter IDs not in saved order (newly re-added columns)
        for (const id of filterMasterIds) {
          if (!ordered.includes(id)) {
            ordered.push(id);
          }
        }
        return ordered
          .map(id => allMasters.find(m => m.id === id))
          .filter(Boolean) as typeof allMasters;
      }
      return filterMasterIds
        .map(id => allMasters.find(m => m.id === id))
        .filter(Boolean) as typeof allMasters;
    }
  }, [columnMode, locations, masters, filterMasterIds, filterLocationIds, getColumnOrder]);

  // Column reorder
  const {
    orderedColumns,
    onColumnDrop,
  } = useColumnReorder({
    columns,
    columnMode,
    initialOrder: columnMode === 'masters' ? settings.columnOrderMasters : settings.columnOrderLocations,
    onOrderChange: (order) => saveColumnOrder(columnMode, order),
  });

  // Ref for onColumnDrop so the test event effect always has the latest callback
  const onColumnDropRef = React.useRef(onColumnDrop);
  onColumnDropRef.current = onColumnDrop;

  // Expose column reorder for E2E tests via custom event
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleTestColumnReorder = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.draggedId && detail?.targetId) {
        onColumnDropRef.current(detail.draggedId, detail.targetId);
      }
    };

    document.addEventListener('__memo-column-reorder', handleTestColumnReorder);
    return () => {
      document.removeEventListener('__memo-column-reorder', handleTestColumnReorder);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- uses onColumnDropRef.current

  // Group activities by column
  const activitiesByColumn = useMemo(() => {
    const map = new Map<string, ScheduleAdminDTO[]>();
    for (const activity of dayActivities) {
      const colKey = columnMode === 'locations' ? activity.locationId : activity.masterId;
      const arr = map.get(colKey) ?? [];
      arr.push(activity);
      map.set(colKey, arr);
    }
    return map;
  }, [dayActivities, columnMode]);

  // Dynamic column ghost height based on actual grid range
  const columnGhostHeight = (gridEndMinutes - gridStartMinutes) * cellHeight / 30;

  const today = new Date();

  const dragMaster = activeDragActivity
    ? masters.find((a) => a.id === activeDragActivity.masterId) || masters[0]
    : null;

  const ghostHeight = activeDragActivity ? Math.ceil(activeDragActivity.durationMinutes / gridFrequency) : null;

  // NowLine
  const [nowPos, setNowPos] = useState(0);
  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      setNowPos((nowMinutes - gridStartMinutes) * cellHeight / 30);
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, [cellHeight, gridStartMinutes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-surface rounded w-32" />
          <div className="h-4 bg-surface rounded w-48" />
          <div className="h-4 bg-surface rounded w-40" />
        </div>
        <span className="ml-3">Загрузка...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-status-error">
        <span>Ошибка загрузки: {error.message}</span>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={separatedCollisionDetection}
      onDragStart={(event) => {
        const activeData = event.active.data?.current as Record<string, unknown> | undefined;

        if (activeData?.type === 'column') {
          // Column drag — show ghost overlay, clear any leftover activity ghost state
          const col = activeData.column as { id: string; name: string };
          setActiveColumn(col);
          handleDragCancel();
          return;
        }

        // Activity card drag
        const nativeEvent = event.activatorEvent as MouseEvent | undefined;
        onDragStart(
          { active: { id: event.active.id, data: { current: { activity: activeData?.activity as ScheduleAdminDTO | undefined } } } },
          { altKey: nativeEvent?.altKey },
        );
      }}
      onDragOver={(event) => {
        const activeData = event.active.data?.current as Record<string, unknown> | undefined;
        // Only process activity card drag-over events
        if (activeData?.type !== 'column') {
          onDragOver({
            over: event.over
              ? { id: event.over.id, data: { current: event.over.data?.current } }
              : null,
          });
        }
      }}
      onDragEnd={(event) => {
        const { active, over } = event;

        // Clear column drag state regardless of outcome
        setActiveColumn(null);

        if (!over) return;

        const activeData = active.data?.current as Record<string, unknown> | undefined;
        const overData = over.data?.current as Record<string, unknown> | undefined;

        if (activeData?.type === 'column') {
          // Column reorder — check if drop target is a column by ID (not a slot droppable)
          const columnIds = new Set(orderedColumns.map(c => c.id));
          if (columnIds.has(String(over.id)) && active.id !== over.id) {
            // Compute direction: dragging right (dragIdx < targetIdx) → insert AFTER target, left → BEFORE
            const dragIdx = orderedColumns.findIndex(c => c.id === String(active.id));
            const targetIdx = orderedColumns.findIndex(c => c.id === String(over.id));
            const direction = dragIdx < targetIdx ? 'after' : 'before';
            onColumnDrop(String(active.id), String(over.id), direction);
          }
        } else {
          // Activity card move
          const columnId = overData?.columnId as string | undefined;
          onDragEnd({
            active: { id: active.id },
            over: over ? { id: over.id, columnId } : null,
          });
        }
      }}
      onDragCancel={() => {
        handleDragCancel();
        setActiveColumn(null);
      }}
    >
      {/* Column headers — inside DndContext, using SortableContext for @dnd-kit sortable */}
      <SortableContext items={orderedColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
        <ScheduleColumnHeader>
          {orderedColumns.map((col, index) => (
            <SortableColumnHeader
              key={col.id}
              col={col}
              isDropTarget={false}
              isFirst={index === 0}
              isLast={index === orderedColumns.length - 1}
              onMoveLeft={index > 0 ? () => {
                const prevCol = orderedColumns[index - 1];
                onColumnDrop(col.id, prevCol.id);
              } : undefined}
              onMoveRight={index < orderedColumns.length - 1 ? () => {
                const nextCol = orderedColumns[index + 1];
                onColumnDrop(nextCol.id, col.id);
              } : undefined}
            />
          ))}
          {orderedColumns.length === 0 && (
            <div className="flex-1 text-center py-2 text-xs" style={{ color: 'var(--ink-light)' }}>
              Нет занятий на этот день
            </div>
          )}
        </ScheduleColumnHeader>
      </SortableContext>

      <div className="min-w-[600px] h-full flex flex-col">
        {/* Grid row — scrollable */}
        <div className="flex-1 flex overflow-auto relative">
          <TimeColumn cellHeight={cellHeight} gridFrequency={gridFrequency} gridStartMinutes={gridStartMinutes} gridEndMinutes={gridEndMinutes} />
          {orderedColumns.map((col) => {
            const colActivities = activitiesByColumn.get(col.id) ?? [];
            return (
              <DayColumn
                key={col.id}
                dayIndex={0}
                date={selectedDay}
                activities={colActivities}
                masters={masters}
                locations={locations}
                services={services}
                dragCopy={dragCopy}
                dragId={dragId}
                ghostHeight={ghostHeight}
                ghostDayIndex={ghostPosition?.dayIndex ?? null}
                ghostSlotIndex={ghostPosition?.slotIndex ?? null}
                ghostColumnId={ghostPosition?.columnId ?? null}
                onCreateActivity={handleCreateActivity}
                onOpenCreateModal={openCreateModal}
                onOpenEditModal={openEditModal}
                onQuickAdd={openQuickAdd}
                stampReady={stamp.ready}
                stamp={stamp}
                cellHeight={cellHeight}
                gridFrequency={gridFrequency}
                gridStartMinutes={gridStartMinutes}
                gridEndMinutes={gridEndMinutes}
                columnId={col.id}
              />
            );
          })}

          {/* NowLine */}
          {isSameDay(selectedDay, today) && nowPos >= 0 && (
            <div
              data-testid="now-line"
              className="absolute left-0 right-0 z-[22] pointer-events-none"
              style={{ top: nowPos, marginLeft: TIME_COL_WIDTH }}
            >
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm" />
                <div className="flex-1 h-[2px] bg-red-500" />
              </div>
            </div>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeColumn ? (
          <div
            className="flex flex-col bg-white rounded-lg overflow-hidden shadow-xl"
            style={{
              width: '180px',
              height: `${columnGhostHeight}px`,
              border: '1px solid var(--line)',
              opacity: 0.9,
            }}
            data-drag-ghost="true"
          >
            {/* Header — matches ScheduleColumnHeader / SortableColumnHeader style */}
            <div
              className="text-center py-2 text-xs font-medium uppercase tracking-wide shrink-0"
              style={{
                backgroundColor: 'var(--bg)',
                color: 'var(--ink-mid)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              {activeColumn.name}
            </div>
            {/* Body — matches DayColumn grid background with faint horizontal grid lines */}
            <div
              className="flex-1 relative"
              style={{
                background: 'repeating-linear-gradient(to bottom, var(--line) 0px, var(--line) 1px, transparent 1px, transparent 60px)',
                backgroundColor: 'white',
              }}
            />
          </div>
        ) : activeDragActivity && dragMaster ? (
          <div className="opacity-80 scale-95 relative" style={{ width: '180px' }} data-drag-ghost="true">
            {draggedSnappedTime != null && (
              <div
                className="absolute -top-6 left-1/2 -translate-x-1/2 z-[60] px-2 py-0.5 rounded-full text-[11px] font-bold text-white shadow-lg whitespace-nowrap"
                style={{ backgroundColor: 'var(--brand, #004D56)' }}
              >
                {formatTime(draggedSnappedTime)}
              </div>
            )}
            <ActivityCard
              activity={
                draggedSnappedTime != null
                  ? { ...activeDragActivity, startMinutes: draggedSnappedTime }
                  : activeDragActivity
              }
              master={dragMaster}
              locations={locations}
              style={{ top: 0 }}
            />
          </div>
        ) : null}
      </DragOverlay>

      {modalActivity && (
        <ActivityDetailsModal
          isOpen={modalOpen}
          onClose={closeModal}
          activity={modalActivity}
          mode={modalMode}
        />
      )}
    </DndContext>
  );
}
