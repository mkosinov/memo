'use client';

import React from 'react';
import { LOCATIONS, SERVICES, ARTISTS } from '@/lib/mock-data';

interface BookingFiltersProps {
  dateFrom: string;
  dateTo: string;
  locationId: string;
  serviceId: string;
  masterId: string;
  status: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  onMasterChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onReset: () => void;
}

export function BookingFilters({
  dateFrom,
  dateTo,
  locationId,
  serviceId,
  masterId,
  status,
  onDateFromChange,
  onDateToChange,
  onLocationChange,
  onServiceChange,
  onMasterChange,
  onStatusChange,
  onReset,
}: BookingFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Дата от</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по дате от"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Дата до</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по дате до"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Локация</label>
        <select
          value={locationId}
          onChange={(e) => onLocationChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по локации"
        >
          <option value="">Все локации</option>
          {LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Услуга</label>
        <select
          value={serviceId}
          onChange={(e) => onServiceChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по услуге"
        >
          <option value="">Все услуги</option>
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Мастер</label>
        <select
          value={masterId}
          onChange={(e) => onMasterChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по мастеру"
        >
          <option value="">Все мастера</option>
          {ARTISTS.map((a) => (
            <option key={a.id} value={a.id}>{a.shortName}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Статус</label>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Фильтр по статусу"
        >
          <option value="">Все статусы</option>
          <option value="WAITING">Ожидание</option>
          <option value="VISITED">Посетили</option>
          <option value="MISSED">Неявка</option>
          <option value="CANCELLED">Отменена</option>
        </select>
      </div>

      <button
        onClick={onReset}
        className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg"
        style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}
      >
        Сбросить
      </button>
    </div>
  );
}
