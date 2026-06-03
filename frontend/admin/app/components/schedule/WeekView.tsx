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
import { ActivityModal } from '../modal/ActivityModal';
import { DAYS, getMonday, TIME_COL_WIDTH, isSameDay, formatTime, HOURS_START, CELL_HEIGHT } from '@/lib/utils';

export function WeekView() {
  const { currentWeek, activities, scheduleIndex, artists, services, locations: studios, stamp, addActivity, updateActivity, loading, error, filterMasterId, filterLocationId } = useSchedule();
  const { showToast } = useUI();
  const monday = getMonday(currentWeek);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalActivity, setModalActivity] = useState<Activity | null>(null);
  const [modalDayIndex, setModalDayIndex] = useState(0);
  const [modalStartTime, setModalStartTime] = useState(9);

  const openCreateModal = useCallback((dayIndex: number, startTime: number) => {
    setModalActivity(null);
    setModalDayIndex(dayIndex);
    setModalStartTime(startTime);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((activity: Activity) => {
    setModalActivity(activity);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalActivity(null);
  }, []);

  const handleSave = useCallback((data: Omit<Activity, 'id'>) => {
    if (modalActivity) {
      updateActivity(modalActivity.id, data);
      showToast(`«${data.serviceName}» сохранено`);
    } else {
      addActivity(data);
      showToast(`Создано: ${data.serviceName}`);
    }
    closeModal();
  }, [modalActivity, addActivity, updateActivity, showToast, closeModal]);

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

  // Use pre-built index from schedule context for O(1) day lookups
  const activitiesByDate = scheduleIndex.byDate;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  const dateToISO = (date: Date): string => date.toISOString().slice(0, 10);

  const today = new Date();

  const dragArtist = activeDragActivity
    ? artists.find((a) => a.id === activeDragActivity.masterId) || artists[0]
    : null;

  // Calculate ghost span for drag overlay (how many slots the dragged card occupies)
  const durMinutes = activeDragActivity?.durationMinutes ?? (activeDragActivity?.duration ?? 0) * 60;
  const ghostHeight = activeDragActivity ? Math.ceil(durMinutes / 30) : null;

  // NowLine
  const [nowPos, setNowPos] = useState(0);
  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      setNowPos((hours - HOURS_START) * CELL_HEIGHT * 2);
    };
    update();
    const iv = setInterval(update, 30000);
    return () => clearInterval(iv);
  }, []);

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
    const hasFilters = filterMasterId !== null || filterLocationId !== null;
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
        <div
          className="sticky top-0 z-[25] flex bg-white border-b shrink-0"
          style={{ paddingLeft: TIME_COL_WIDTH }}
        >
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
        </div>

        {/* Grid row — scrollable */}
        <div className="flex-1 flex overflow-auto relative">
          <TimeColumn />
          {days.map((day, i) => (
            <DayColumn
              key={i}
              dayIndex={i}
              date={day}
              activities={resolveById(activitiesByDate.get(dateToISO(day)) ?? [], scheduleIndex.byId).map(a => ({ ...a, duration: a.durationMinutes / 60, serviceName: a.serviceTitle }))}
              artists={artists}
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
              stampReady={stamp.ready}
              stamp={stamp}
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
        {activeDragActivity && dragArtist ? (
          <div className="opacity-80 scale-95" style={{ width: '180px' }} data-drag-ghost="true">
            <ActivityCard
              activity={activeDragActivity}
              artist={dragArtist}
              studios={studios}
              style={{ top: 0 }}
            />
          </div>
        ) : null}
      </DragOverlay>

      <ActivityModal
        isOpen={modalOpen}
        onClose={closeModal}
        onSave={handleSave}
        initialActivity={modalActivity}
        defaultDay={modalDayIndex}
        defaultStartTime={modalStartTime}
      />
    </DndContext>
  );
}
