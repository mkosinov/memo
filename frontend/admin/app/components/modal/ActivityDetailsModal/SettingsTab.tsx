'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { MasterPicker } from '@/app/components/shared/MasterPicker';
import type { Activity, Service } from '@memo/domain';
import { decimalToHHMM, hhmmToDecimal } from '@/lib/utils';

interface SettingsTabProps {
  activity: Activity;
  onUpdate: (updates: Partial<Activity>) => void;
}

export function SettingsTab({ activity, onUpdate }: SettingsTabProps) {
  const { masters, services, locations } = useSchedule();

  const [serviceId, setServiceId] = useState(activity.serviceId);
  const [masterId, setMasterId] = useState(activity.masterId);
  const [locationId, setLocationId] = useState(activity.locationId);
  const [capacity, setCapacity] = useState(activity.capacity);
  const [durationStr, setDurationStr] = useState(decimalToHHMM(activity.duration));
  const [isPrivate, setIsPrivate] = useState(activity.isPrivate);
  const [startDateTime, setStartDateTime] = useState(() => {
    // Build datetime-local string from activity.date + activity.startTime
    const dateStr = activity.date || '';
    const timeHH = String(Math.floor(activity.startTime)).padStart(2, '0');
    const timeMM = activity.startTime % 1 >= 0.5 ? '30' : '00';
    if (dateStr) {
      return `${dateStr}T${timeHH}:${timeMM}`;
    }
    return '';
  });

  // Selected service for display
  const selectedService = services.find((s) => s.id === serviceId) as (Service & { tariffs?: Array<{ id: string; title: string; price: number; description?: string | null }> }) | undefined;

  // Age display: if maxAge > 0 → "{minAge}–{maxAge}", else → "{minAge}+"
  const ageDisplay = selectedService
    ? Number(selectedService.maxAge) > 0
      ? `${selectedService.minAge}–${selectedService.maxAge}`
      : `${selectedService.minAge}+`
    : null;

  // Auto-fill from service when service changes
  const handleServiceChange = useCallback(
    (newServiceId: string) => {
      setServiceId(newServiceId);
      const svc = services.find((s) => s.id === newServiceId);
      if (svc) {
        setDurationStr(decimalToHHMM(svc.duration));
        setCapacity(svc.maxCapacity);
        onUpdate({
          serviceId: newServiceId,
          serviceName: svc.name,
          minAge: svc.minAge,
          duration: svc.duration,
          durationMinutes: svc.durationMinutes || svc.duration * 60,
          capacity: svc.maxCapacity,
        });
      }
    },
    [services, onUpdate],
  );

  // Handle datetime change
  const handleDateTimeChange = useCallback(
    (value: string) => {
      setStartDateTime(value);
      if (value) {
        const [datePart, timePart] = value.split('T');
        const [h, m] = timePart.split(':').map(Number);
        const startTimeDecimal = h + m / 60;
        // Calculate day from date
        const date = new Date(datePart + 'T12:00:00');
        const dayOfWeek = (date.getDay() + 6) % 7; // Mon=0
        onUpdate({ startTime: startTimeDecimal, day: dayOfWeek, date: datePart });
      }
    },
    [onUpdate],
  );

  // Handle duration change
  const handleDurationChange = useCallback(
    (value: string) => {
      setDurationStr(value);
      const decimal = hhmmToDecimal(value);
      if (!isNaN(decimal) && decimal > 0) {
        onUpdate({ duration: decimal, durationMinutes: Math.round(decimal * 60) });
      }
    },
    [onUpdate],
  );

  // Sync state from activity prop changes (e.g. after DnD)
  useEffect(() => {
    setServiceId(activity.serviceId);
    setMasterId(activity.masterId);
    setLocationId(activity.locationId);
    setCapacity(activity.capacity);
    setDurationStr(decimalToHHMM(activity.duration));
    setIsPrivate(activity.isPrivate);

    const dateStr = activity.date || '';
    const timeHH = String(Math.floor(activity.startTime)).padStart(2, '0');
    const timeMM = activity.startTime % 1 >= 0.5 ? '30' : '00';
    if (dateStr) {
      setStartDateTime(`${dateStr}T${timeHH}:${timeMM}`);
    }
  }, [activity]);

  const inputClass =
    'w-full rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-4 p-4" data-testid="settings-tab">
      {/* Row 1: Date/Time + Duration + Private toggle */}
      <div className="flex gap-3 items-end" data-testid="settings-row-datetime-duration">
        <div className="flex-1">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-datetime">
            Дата и время
          </label>
          <input
            id="settings-datetime"
            type="datetime-local"
            className={inputClass}
            style={inputStyle}
            value={startDateTime}
            onChange={(e) => handleDateTimeChange(e.target.value)}
            data-testid="input-datetime"
          />
        </div>
        <div className="w-28">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-duration">
            Длительность
          </label>
          <input
            id="settings-duration"
            type="text"
            placeholder="ЧЧ:ММ"
            className={inputClass}
            style={inputStyle}
            value={durationStr}
            onChange={(e) => handleDurationChange(e.target.value)}
            data-testid="input-duration"
          />
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <span className="text-xs text-ink-mid">Приватное</span>
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            onClick={() => {
              setIsPrivate(!isPrivate);
              onUpdate({ isPrivate: !isPrivate });
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              isPrivate ? 'bg-brand' : 'bg-ink-faint'
            }`}
            data-testid="toggle-private"
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                isPrivate ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Row 2: Service + Age (read-only) + Capacity */}
      <div className="flex gap-3" data-testid="settings-row-service-age-capacity">
        <div className="flex-1">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-service">
            Услуга
          </label>
          <select
            id="settings-service"
            className={inputClass}
            style={inputStyle}
            value={serviceId}
            onChange={(e) => handleServiceChange(e.target.value)}
            data-testid="select-service"
          >
            <option value="">Выберите</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <label className="text-xs font-medium text-ink-mid block mb-1">
            Возраст
          </label>
          <div
            className="w-full rounded-lg border px-3 py-2 text-sm bg-surface text-ink-light"
            style={inputStyle}
            data-testid="age-display"
          >
            {ageDisplay || '—'}
          </div>
        </div>
        <div className="w-24">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-capacity">
            Вместимость
          </label>
          <input
            id="settings-capacity"
            type="number"
            min={1}
            className={inputClass}
            style={inputStyle}
            value={capacity}
            onChange={(e) => {
              const val = Number(e.target.value);
              setCapacity(val);
              onUpdate({ capacity: val });
            }}
            data-testid="input-capacity"
          />
        </div>
      </div>

      {/* Tariffs */}
      {selectedService?.tariffs && selectedService.tariffs.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-ink-mid">Тарифы:</span>
          {selectedService.tariffs.map((tariff) => (
            <div key={tariff.id} className="flex items-center justify-between text-sm px-2 py-1 bg-surface rounded">
              <span className="text-ink-mid">{tariff.title}</span>
              <span className="font-medium text-ink">{tariff.price.toLocaleString('ru-RU')} ₽</span>
            </div>
          ))}
        </div>
      )}

      {/* Row 3: Master + Location */}
      <div className="flex gap-3" data-testid="settings-row-master-location">
        <div className="flex-1">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-master">
            Мастер
          </label>
          <MasterPicker
            masters={masters}
            value={masterId}
            onChange={(value) => {
              setMasterId(value);
              onUpdate({ masterId: value });
            }}
            className={`${inputClass} appearance-none`}
          />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-location">
            Локация
          </label>
          <select
            id="settings-location"
            className={inputClass}
            style={inputStyle}
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              onUpdate({ locationId: e.target.value });
            }}
            data-testid="select-location"
          >
            <option value="">Выберите</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
