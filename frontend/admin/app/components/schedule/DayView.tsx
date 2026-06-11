'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { DndContext, DragOverlay, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import { useDnD } from '@/hooks/useDnD';
import { useColumnReorder } from '@/hooks/useColumnReorder';
import { resolveById } from '@memo/domain';
import type { Activity } from '@memo/domain';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';
import { ActivityCard } from './ActivityCard';
import { ScheduleColumnHeader } from './ScheduleColumnHeader';
import { ActivityDetailsModal } from '../modal/ActivityDetailsModal';
import { TIME_COL_WIDTH, isSameDay, formatTime, HOURS_START } from '@/lib/utils';

export function DayView() {
  const {
    scheduleIndex,
    masters,
    services,
    locations: studios,
    stamp,
    addActivity,
    updateActivity,
    loading,
    error,
    filterMasterIds,
    selectedDay,
    showAllColumns,
    columnMode,
    cellHeight = 60,
  } = useSchedule();
  const { showToast } = useUI();

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalActivity, setModalActivity] = useState<Activity | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'quickAdd'>('edit');

  const openCreateModal = useCallback((_dayIndex: number, _startTime: number) => {
    setModalActivity(null);
    setModalMode('edit');
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((activity: Activity) => {
    setModalActivity(activity);
    setModalMode('edit');
    setModalOpen(true);
  }, []);

  const openQuickAdd = useCallback((activity: Activity) => {
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
    (dayIndex: number, startTime: number) => {
      if (!stamp.ready || !stamp.masterId || !stamp.serviceId || stamp.locations.size === 0) return;
      const service = services.find((s) => s.id === stamp.serviceId);
      if (!service) return;
      const firstLocation = stamp.locations.values().next().value as string;

      addActivity({
        day: dayIndex,
        masterId: stamp.masterId,
        startTime,
        duration: service.duration,
        durationMinutes: service.durationMinutes,
        serviceId: stamp.serviceId,
        serviceName: service.name,
        minAge: service.minAge,
        locationId: firstLocation,
        occupied: 0,
        capacity: service.maxCapacity,
        isPrivate: false,
      });

      showToast(`Создано: ${service.name} — ${formatTime(startTime)}`);
    },
    [stamp, services, addActivity, showToast],
  );

  // Resolve activities for the selected day
  const selectedDayISO = useMemo(() => {
    const y = selectedDay.getFullYear();
    const m = String(selectedDay.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDay.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [selectedDay]);

  const dayActivities = useMemo(() => {
    const ids = scheduleIndex.byDate.get(selectedDayISO) ?? [];
    return resolveById(ids, scheduleIndex.byId);
  }, [scheduleIndex, selectedDayISO]);

  // Resolve ScheduleAdminDTO[] → Activity[] with duration in hours + serviceName
  const resolvedActivities = useMemo(
    () => dayActivities.map(a => ({ ...a, duration: a.durationMinutes / 60, serviceName: a.serviceTitle })),
    [dayActivities],
  );

  // Determine columns based on explicit columnMode (not implicit filter logic)
  const columns = useMemo(() => {
    if (columnMode === 'locations') {
      // Show locations as columns
      const allLocations = studios;
      if (showAllColumns) return allLocations;
      // Only show locations that have activities on this day
      const activeLocationIds = new Set(dayActivities.map(a => a.locationId));
      return allLocations.filter(l => activeLocationIds.has(l.id));
    } else {
      // Show masters as columns
      const allMasters = masters;
      if (showAllColumns) return allMasters;
      // Only show masters that have activities on this day
      const activeMasterIds = new Set(dayActivities.map(a => a.masterId));
      return allMasters.filter(m => activeMasterIds.has(m.id));
    }
  }, [columnMode, studios, masters, showAllColumns, dayActivities]);

  // Column reorder via Cmd/Alt + drag
  const {
    modifierHeld,
    orderedColumns,
    onColumnDrop,
  } = useColumnReorder({ columns, columnMode });
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Group activities by column
  const activitiesByColumn = useMemo(() => {
    const map = new Map<string, typeof resolvedActivities>();
    for (const activity of resolvedActivities) {
      const colKey = columnMode === 'locations' ? activity.locationId : activity.masterId;
      const arr = map.get(colKey) ?? [];
      arr.push(activity);
      map.set(colKey, arr);
    }
    return map;
  }, [resolvedActivities, columnMode]);

  // DnD
  const {
    dragId,
    dragCopy,
    ghostPosition,
    activeDragActivity,
    onDragStart,
    onDragOver,
    onDragEnd,
    handleDragCancel,
  } = useDnD({
    activities: resolvedActivities,
    addActivity,
    updateActivity,
    showToast,
  });

  const today = new Date();

  const dragMaster = activeDragActivity
    ? masters.find((a) => a.id === activeDragActivity.masterId) || masters[0]
    : null;

  const durMinutes = activeDragActivity?.durationMinutes ?? (activeDragActivity?.duration ?? 0) * 60;
  const ghostHeight = activeDragActivity ? Math.ceil(durMinutes / 30) : null;

  // NowLine
  const [nowPos, setNowPos] = useState(0);
  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      setNowPos((hours - HOURS_START) * cellHeight * 2);
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, [cellHeight]);

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
      collisionDetection={closestCenter}
      onDragStart={(event) => {
        const nativeEvent = event.activatorEvent as MouseEvent | undefined;
        const dragData = event.active.data?.current as Record<string, unknown> | undefined;
        onDragStart(
          { active: { id: event.active.id, data: { current: { activity: dragData?.activity as Activity | undefined } } } },
          { altKey: nativeEvent?.altKey },
        );
      }}
      onDragOver={(event) => {
        onDragOver({
          over: event.over
            ? { id: event.over.id, data: { current: event.over.data?.current } }
            : null,
        });
      }}
      onDragEnd={(event) => {
        onDragEnd({
          active: { id: event.active.id },
          over: event.over ? { id: event.over.id } : null,
        });
      }}
      onDragCancel={() => {
        handleDragCancel();
      }}
    >
      <div className="min-w-[600px] h-full flex flex-col">
        {/* Column headers */}
        <ScheduleColumnHeader stickyTop="52px" zIndex={24}>
          {orderedColumns.map((col) => {
            const isDropTarget = dropTargetId === col.id && draggedColumnId !== col.id;
            return (
              <div
                key={col.id}
                draggable={modifierHeld}
                onDragStart={(e) => {
                  if (!modifierHeld) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData('text/plain', col.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggedColumnId(col.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTargetId(col.id);
                }}
                onDragLeave={() => {
                  setDropTargetId((prev) => (prev === col.id ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData('text/plain');
                  if (draggedId && draggedId !== col.id) {
                    onColumnDrop(draggedId, col.id);
                  }
                  setDraggedColumnId(null);
                  setDropTargetId(null);
                }}
                onDragEnd={() => {
                  setDraggedColumnId(null);
                  setDropTargetId(null);
                }}
                className={`flex-1 text-center py-2 text-xs font-medium transition-all duration-150 ${
                  modifierHeld ? 'cursor-grab' : 'cursor-default'
                } ${draggedColumnId === col.id ? 'opacity-50 scale-95' : ''} ${
                  isDropTarget ? 'border-l-2 border-l-[var(--brand)]' : ''
                }`}
                style={{ color: 'var(--ink-mid)' }}
              >
                <div className="uppercase tracking-wide">
                  {columnMode === 'locations' ? col.name : (col as { shortName?: string }).shortName ?? col.name}
                </div>
              </div>
            );
          })}
          {orderedColumns.length === 0 && (
            <div className="flex-1 text-center py-2 text-xs" style={{ color: 'var(--ink-light)' }}>
              Нет занятий на этот день
            </div>
          )}
        </ScheduleColumnHeader>

        {/* Grid row — scrollable */}
        <div className="flex-1 flex overflow-auto relative">
          <TimeColumn cellHeight={cellHeight} />
          {orderedColumns.map((col) => {
            const colActivities = activitiesByColumn.get(col.id) ?? [];
            return (
              <DayColumn
                key={col.id}
                dayIndex={0}
                date={selectedDay}
                activities={colActivities.map(a => ({ ...a, duration: a.durationMinutes / 60, serviceName: a.serviceTitle }))}
                masters={masters}
                studios={studios}
                services={services}
                dragCopy={dragCopy}
                dragId={dragId}
                ghostHeight={ghostHeight}
                ghostDayIndex={ghostPosition?.dayIndex ?? null}
                ghostSlotIndex={ghostPosition?.slotIndex ?? null}
                onCreateActivity={handleCreateActivity}
                onOpenCreateModal={openCreateModal}
                onOpenEditModal={openEditModal}
                onQuickAdd={openQuickAdd}
                stampReady={stamp.ready}
                stamp={stamp}
                cellHeight={cellHeight}
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
        {activeDragActivity && dragMaster ? (
          <div className="opacity-80 scale-95" style={{ width: '180px' }} data-drag-ghost="true">
            <ActivityCard
              activity={activeDragActivity}
              master={dragMaster}
              studios={studios}
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
