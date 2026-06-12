'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { DndContext, DragOverlay, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import { useDnD } from '@/hooks/useDnD';
import { resolveById } from '@memo/domain';
import type { Activity } from '@memo/domain';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';
import { ActivityCard } from './ActivityCard';
import { ScheduleColumnHeader } from './ScheduleColumnHeader';
import { ActivityDetailsModal } from '../modal/ActivityDetailsModal';
import { DAYS, getMonday, TIME_COL_WIDTH, isSameDay, formatTime, calculateGridTimeRange } from '@/lib/utils';

export function WeekView() {
  const { currentWeek, activities, scheduleIndex, masters, services, locations: studios, stamp, addActivity, updateActivity, loading, error, filterMasterIds, filterLocationIds, cellHeight = 60, gridFrequency = 30, workingHoursStart = 9, workingHoursEnd = 21 } = useSchedule();
  const { showToast } = useUI();
  const monday = getMonday(currentWeek);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalActivity, setModalActivity] = useState<Activity | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'quickAdd'>('edit');

  const openCreateModal = useCallback((dayIndex: number, startTime: number) => {
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

  // Expose modal openers for E2E tests (avoids @dnd-kit pointer interception)
  // Uses native DOM events processed by React's useEffect to ensure state flushes
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

      showToast(`Создано: ${service.name} — ${DAYS[dayIndex]} ${formatTime(startTime)}`);
    },
    [stamp, services, addActivity, showToast],
  );

  // Resolve ScheduleAdminDTO[] → Activity[] with duration in hours + serviceName for DayColumn/DnD compat
  const resolvedActivities = useMemo(
    () => activities.map(a => ({ ...a, duration: a.durationMinutes / 60, serviceName: a.serviceTitle })),
    [activities],
  );

  // Adaptive grid time range — extends beyond working hours if activities go outside
  const gridRange = useMemo(
    () => calculateGridTimeRange(resolvedActivities, workingHoursStart, workingHoursEnd),
    [resolvedActivities, workingHoursStart, workingHoursEnd],
  );

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
    activities: resolvedActivities,
    addActivity,
    updateActivity,
    showToast,
    gridFrequency,
  });

  // Use pre-built index from schedule context for O(1) day lookups
  const activitiesByDate = scheduleIndex.byDate;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  const dateToISO = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const today = new Date();

  const dragMaster = activeDragActivity
    ? masters.find((a) => a.id === activeDragActivity.masterId) || masters[0]
    : null;

  // Calculate ghost span for drag overlay (how many slots the dragged card occupies)
  const durMinutes = activeDragActivity?.durationMinutes ?? (activeDragActivity?.duration ?? 0) * 60;
  const ghostHeight = activeDragActivity ? Math.ceil(durMinutes / gridFrequency) : null;

  // NowLine
  const [nowPos, setNowPos] = useState(0);
  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      setNowPos((hours - gridRange.start) * cellHeight * 2);
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, [cellHeight, gridRange.start]);

  const showNowLine = days.some(d => isSameDay(d, today)) && nowPos >= 0;

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

  if (activities.length === 0) {
    // Check if there are activities but all hidden by filters
    const hasFilters = filterMasterIds.length > 0 || filterLocationIds.length > 0;
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <span>{hasFilters ? 'Нет занятий по выбранным фильтрам' : 'Нет занятий на эту неделю'}</span>
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
      <div className="min-w-[800px] h-full flex flex-col">
        {/* Header row — sticky above cards */}
        <ScheduleColumnHeader>
          {days.map((day, i) => (
            <div
              key={i}
              className="flex-1 text-center py-2 text-xs font-medium"
              style={{ color: isSameDay(day, today) ? 'var(--brand)' : 'var(--ink-mid)' }}
            >
              <div className="uppercase tracking-wide">{DAYS[i]}</div>
              <div className={`text-base font-bold ${isSameDay(day, today) ? 'text-brand' : ''}`}>
                {day.getDate()}
              </div>
            </div>
          ))}
        </ScheduleColumnHeader>

        {/* Grid row — scrollable */}
        <div className="flex-1 flex overflow-auto relative">
          <TimeColumn cellHeight={cellHeight} gridFrequency={gridFrequency} gridStart={gridRange.start} gridEnd={gridRange.end} />
          {days.map((day, i) => (
            <DayColumn
              key={i}
              dayIndex={i}
              date={day}
              activities={resolveById(activitiesByDate.get(dateToISO(day)) ?? [], scheduleIndex.byId).map(a => ({ ...a, duration: a.durationMinutes / 60, serviceName: a.serviceTitle }))}
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
              gridFrequency={gridFrequency}
              gridStart={gridRange.start}
              gridEnd={gridRange.end}
            />
          ))}

          {/* NowLine — full width across all columns, red */}
          {showNowLine && (
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
          <div className="opacity-80 scale-95 relative" style={{ width: '180px' }} data-drag-ghost="true">
            {/* Time preview label — shows snapped position while dragging */}
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
                  ? { ...activeDragActivity, startTime: draggedSnappedTime }
                  : activeDragActivity
              }
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
