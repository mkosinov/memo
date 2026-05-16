'use client';

import React, { useState, useCallback } from 'react';
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import { useDnD } from '@/hooks/useDnD';
import type { Activity } from '@/lib/types';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';
import { ActivityCard } from './ActivityCard';
import { ActivityModal } from '../modal/ActivityModal';
import { DAYS, getMonday, TIME_COL_WIDTH } from '@/lib/utils';

export function WeekView() {
  const { currentWeek, activities, artists, services, studios, stamp, addActivity, updateActivity } = useSchedule();
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

  // Stamp-based quick creation (when stamp is ready)
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
        serviceId: stamp.serviceId,
        serviceName: service.name,
        minAge: service.minAge,
        locationId: firstLocation,
        occupied: 0,
        capacity: service.maxCapacity,
        isPrivate: false,
      });

      showToast(
        `Создано: ${service.name} — ${DAYS[dayIndex]} ${startTime % 1 === 0 ? `${startTime}:00` : `${Math.floor(startTime)}:30`}`,
      );
    },
    [stamp, services, addActivity, showToast],
  );

  const {
    dragId,
    dragCopy,
    activeDragActivity,
    onDragStart,
    onDragOver,
    onDragEnd,
    handleDragCancel,
  } = useDnD({
    activities,
    addActivity,
    updateActivity,
    showToast,
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  const today = new Date();

  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  // Find the artist for the dragged activity
  const dragArtist = activeDragActivity
    ? artists.find((a) => a.id === activeDragActivity.masterId) || artists[0]
    : null;

  return (
    <DndContext
      collisionDetection={pointerWithin}
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
      <div className="min-w-[800px]">
        {/* Header row */}
        <div
          className="sticky top-0 z-10 flex bg-white border-b"
          style={{ paddingLeft: TIME_COL_WIDTH }}
        >
          {days.map((day, i) => (
            <div
              key={i}
              className="flex-1 text-center py-2 text-xs font-medium"
              style={{ color: isToday(day) ? 'var(--brand)' : 'var(--ink-mid)' }}
            >
              <div className="uppercase tracking-wide">{DAYS[i]}</div>
              <div className={`text-base font-bold ${isToday(day) ? 'text-brand' : ''}`}>
                {day.getDate()}
              </div>
            </div>
          ))}
        </div>

        {/* Grid row */}
        <div className="flex">
          <TimeColumn />
          {days.map((day, i) => (
            <DayColumn
              key={i}
              dayIndex={i}
              date={day}
              activities={activities.filter((a) => a.day === i)}
              artists={artists}
              studios={studios}
              services={services}
              dragCopy={dragCopy}
              dragId={dragId}
              onCreateActivity={handleCreateActivity}
              onOpenCreateModal={openCreateModal}
              onOpenEditModal={openEditModal}
              stampReady={stamp.ready}
              stamp={stamp}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDragActivity && dragArtist ? (
          <div className="opacity-80 scale-95" style={{ width: '180px' }} data-drag-ghost="true">
            <ActivityCard activity={activeDragActivity} artist={dragArtist} studios={studios} />
          </div>
        ) : null}
      </DragOverlay>

      {/* Activity Modal */}
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
