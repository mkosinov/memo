'use client';

import React, { useState, useCallback } from 'react';
import { DndContext, DragOverlay, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import { useDnD } from '@/hooks/useDnD';
import { resolveById } from '@memo/domain';
import type { ScheduleAdminDTO } from '@memo/domain';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';
import { ActivityCard } from './ActivityCard';
import { ScheduleColumnHeader } from './ScheduleColumnHeader';
import { ActivityDetailsModal } from '../modal/ActivityDetailsModal';
import { DAYS, TIME_COL_WIDTH, isSameDay } from '@/lib/utils';
import { formatTime, getMonday, toISODate } from '@/lib/datetime';

export function WeekView() {
  const { currentWeek, activities, scheduleIndex, masters, services, locations, stamp, addActivity, updateActivity, loading, error, filterMasterIds, filterLocationIds, cellHeight = 60, gridFrequency = 30, gridStartMinutes, gridEndMinutes } = useSchedule();
  const { showToast } = useUI();
  const monday = getMonday(currentWeek);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalActivity, setModalActivity] = useState<ScheduleAdminDTO | null>(null);
  const [modalMode, setModalMode] = useState<'edit' | 'quickAdd'>('edit');

  const openCreateModal = useCallback((dayIndex: number, startMinutes: number) => {
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

      showToast(`Создано: ${service.name} — ${DAYS[dayIndex]} ${formatTime(startMinutes)}`);
    },
    [stamp, services, locations, addActivity, showToast],
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
    activities,
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

  const today = new Date();

  const dragMaster = activeDragActivity
    ? masters.find((a) => a.id === activeDragActivity.masterId) || masters[0]
    : null;

  // Calculate ghost span for drag overlay (how many slots the dragged card occupies)
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
          { active: { id: event.active.id, data: { current: { activity: dragData?.activity as ScheduleAdminDTO | undefined } } } },
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
          <TimeColumn cellHeight={cellHeight} gridFrequency={gridFrequency} gridStartMinutes={gridStartMinutes} gridEndMinutes={gridEndMinutes} />
          {days.map((day, i) => (
            <DayColumn
              key={i}
              dayIndex={i}
              date={day}
              activities={resolveById(activitiesByDate.get(toISODate(day)) ?? [], scheduleIndex.byId)}
              masters={masters}
              locations={locations}
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
              gridStartMinutes={gridStartMinutes}
              gridEndMinutes={gridEndMinutes}
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
