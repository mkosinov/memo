'use client';

import React, { useState } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import { DAYS } from '@/lib/utils';
import { formatTime } from '@/lib/datetime';
import { parseApiError } from '@/app/lib/api/parseApiError';

/** Слот-префиллы: день недели и время в минутах от полуночи (GH #142 minutes contract). */
export interface CreateDefaults {
  dayIndex: number;
  startMinutes: number;
}

interface Props {
  defaults: CreateDefaults;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => void;
}

const selectClass =
  'w-full rounded-lg border px-2 py-1.5 text-xs bg-[var(--white)] text-[var(--ink)] border-[var(--line)] focus:outline-none focus:border-[var(--brand)]';
const labelClass = 'block text-xs font-medium text-[var(--ink-mid)] mb-1';

/**
 * Единственная вкладка модалки в режиме создания (GH #258/#259, spec §2.1).
 * День/время — префилл из кликнутого слота; услуга/локация авто-заполняют
 * длительность/вместимость (domain-rules/activities.md). Сохранение — тот же
 * addActivity, что у штампа; конфликт-валидации нет (D8).
 */
export function CreateActivityTab({ defaults, onSavingChange, onSaved }: Props) {
  const { masters, services, locations, addActivity } = useScheduleData();
  const { showToast } = useUI();

  const [masterId, setMasterId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [dayIndex, setDayIndex] = useState(defaults.dayIndex);
  const [startHours, setStartHours] = useState(defaults.startMinutes / 60);
  const [durationMinutes, setDurationMinutes] = useState<number | ''>('');
  const [capacity, setCapacity] = useState<number | ''>('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const service = services.find((s) => s.id === serviceId);

  const timeValid = Number.isFinite(startHours) && startHours > 0 && startHours < 24;
  const canSave =
    !!masterId &&
    !!serviceId &&
    !!locationId &&
    timeValid &&
    typeof durationMinutes === 'number' &&
    durationMinutes > 0;

  const submit = () => {
    if (!canSave || saving) return;
    const startMinutes = Math.round(startHours * 60);
    setSaving(true);
    onSavingChange(true);
    addActivity(
      {
        dayIndex,
        masterId,
        serviceId,
        locationId,
        startMinutes,
        durationMinutes: Number(durationMinutes),
        capacity: Number(capacity) || 0,
        isPrivate,
      },
      {
        onSuccess: () => {
          setSaving(false);
          onSavingChange(false);
          showToast(`Создано: ${service?.name} — ${DAYS[dayIndex]} ${formatTime(startMinutes)}`);
          onSaved();
        },
        onError: (err) => {
          setSaving(false);
          onSavingChange(false);
          // Форма остаётся открытой с введённым (spec §2.1.7).
          showToast(parseApiError(err).message, 'error');
        },
      },
    );
    // IMPORTANT: mutate() — fire-and-forget; NO synchronous setSaving(false) here.
    // saving=true lives until a callback — modal must not close, button must not press (spec §2.1.7).
  };

  return (
    <div className="p-4 space-y-3">
      <div>
        <label htmlFor="create-master-input" className={labelClass}>Мастер</label>
        <select
          data-testid="create-master"
          id="create-master-input"
          className={selectClass}
          value={masterId}
          onChange={(e) => setMasterId(e.target.value)}
        >
          <option value="">—</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="create-service-input" className={labelClass}>Услуга</label>
        <select
          data-testid="create-service"
          id="create-service-input"
          className={selectClass}
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            const next = services.find((s) => s.id === e.target.value);
            setDurationMinutes(next ? next.durationMinutes : '');
          }}
        >
          <option value="">—</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="create-location-input" className={labelClass}>Локация</label>
        <select
          data-testid="create-location"
          id="create-location-input"
          className={selectClass}
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            const next = locations.find((l) => l.id === e.target.value);
            setCapacity(next ? (next.defaultCapacity ?? 0) : '');
          }}
        >
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.title}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="create-day-input" className={labelClass}>День</label>
          <select
            data-testid="create-day"
            id="create-day-input"
            className={selectClass}
            value={dayIndex}
            onChange={(e) => setDayIndex(Number(e.target.value))}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="create-time-input" className={labelClass}>Время начала</label>
          <input
            data-testid="create-time"
            id="create-time-input"
            type="number"
            step={0.5}
            min={0.5}
            max={23.5}
            className={selectClass}
            value={startHours}
            onChange={(e) => setStartHours(e.target.value === '' ? NaN : Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="create-duration-input" className={labelClass}>Длительность (мин)</label>
          <input
            data-testid="create-duration"
            id="create-duration-input"
            type="number"
            min={1}
            className={selectClass}
            value={durationMinutes}
            onChange={(e) =>
              setDurationMinutes(e.target.value === '' ? '' : Number(e.target.value))
            }
          />
        </div>
        <div className="flex-1">
          <label htmlFor="create-capacity-input" className={labelClass}>Вместимость</label>
          <input
            data-testid="create-capacity"
            id="create-capacity-input"
            type="number"
            min={0}
            className={selectClass}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          data-testid="create-private"
          id="create-private-input"
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="rounded border-[var(--line)]"
        />
        <label htmlFor="create-private-input" className="text-xs text-[var(--ink)]">
          Приватное занятие
        </label>
      </div>

      <button
        type="button"
        data-testid="btn-create-activity"
        onClick={submit}
        disabled={!canSave || saving}
        className="w-full rounded-lg px-3 py-2 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: 'var(--brand)' }}
      >
        Создать
      </button>

    </div>
  );
}
