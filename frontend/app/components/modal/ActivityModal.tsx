'use client';

import React, { useState, useEffect } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import type { Activity } from '@/lib/types';
import { DAYS } from '@/lib/utils';

interface ActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (activity: Omit<Activity, 'id'>) => void;
  initialActivity?: Activity | null;
  defaultDay?: number;
  defaultStartTime?: number;
}

export function ActivityModal({
  isOpen,
  onClose,
  onSave,
  initialActivity,
  defaultDay = 0,
  defaultStartTime = 9,
}: ActivityModalProps) {
  const { artists, services, studios } = useSchedule();

  const [masterId, setMasterId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [duration, setDuration] = useState(1);
  const [occupied, setOccupied] = useState(0);
  const [capacity, setCapacity] = useState(8);
  const [isPrivate, setIsPrivate] = useState(false);
  const [day, setDay] = useState(defaultDay);

  // Auto-fill from selected service (only in create mode)
  const selectedService = services.find((s) => s.id === serviceId);
  useEffect(() => {
    if (selectedService && !initialActivity) {
      setDuration(selectedService.duration);
      setCapacity(selectedService.maxCapacity);
    }
  }, [selectedService, initialActivity]);

  // Populate form when editing or reset for create
  useEffect(() => {
    if (initialActivity) {
      setMasterId(initialActivity.masterId);
      setServiceId(initialActivity.serviceId);
      setLocationId(initialActivity.locationId);
      setStartTime(initialActivity.startTime);
      setDuration(initialActivity.duration);
      setOccupied(initialActivity.occupied);
      setCapacity(initialActivity.capacity);
      setIsPrivate(initialActivity.isPrivate);
      setDay(initialActivity.day);
    } else {
      setMasterId('');
      setServiceId('');
      setLocationId('');
      setStartTime(defaultStartTime);
      setDuration(1);
      setOccupied(0);
      setCapacity(8);
      setIsPrivate(false);
      setDay(defaultDay);
    }
  }, [initialActivity, defaultDay, defaultStartTime]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterId || !serviceId || !locationId) return;

    const service = services.find((s) => s.id === serviceId);
    onSave({
      day,
      masterId,
      startTime,
      duration,
      serviceId,
      serviceName: service?.name || '',
      minAge: service?.minAge || '',
      locationId,
      occupied,
      capacity,
      isPrivate,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        data-testid="modal-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {initialActivity ? 'Редактировать событие' : 'Новое событие'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Master + Service */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-master">
                Мастер
              </label>
              <select
                id="modal-master"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={masterId}
                onChange={(e) => setMasterId(e.target.value)}
                required
              >
                <option value="">Выберите</option>
                {artists.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.shortName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-service">
                Услуга
              </label>
              <select
                id="modal-service"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                required
              >
                <option value="">Выберите</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs font-medium text-gray-600" htmlFor="modal-location">
              Локация
            </label>
            <select
              id="modal-location"
              className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
            >
              <option value="">Выберите</option>
              {studios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji ? `${s.emoji} ` : ''}
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Day + Start Time + Duration */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-day">
                День
              </label>
              <select
                id="modal-day"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-start">
                Начало
              </label>
              <input
                id="modal-start"
                type="number"
                step="0.5"
                min="9"
                max="21"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={startTime}
                onChange={(e) => setStartTime(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-duration">
                Длительность
              </label>
              <input
                id="modal-duration"
                type="number"
                step="0.5"
                min="0.5"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Occupied + Capacity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-occupied">
                Занято
              </label>
              <input
                id="modal-occupied"
                type="number"
                min="0"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={occupied}
                onChange={(e) => setOccupied(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600" htmlFor="modal-capacity">
                Вместимость
              </label>
              <input
                id="modal-capacity"
                type="number"
                min="1"
                className="w-full rounded-lg border px-3 py-2 text-sm mt-1"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Private checkbox */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Приватное событие
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm text-white rounded-lg"
              style={{ backgroundColor: 'var(--brand, #004D56)' }}
            >
              {initialActivity ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
