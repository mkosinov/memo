'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@/contexts/NavigationContext';
import { getMonday, formatDateISO } from '@/lib/utils';
import { StatusFiltersPicker } from '@/app/components/shared/StatusFiltersPicker';
import { getAllLocations, getAllServices, getAllMasters } from '@memo/api-client';
import type { LocationResponse, ServiceResponse, MasterResponse } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';

interface BookingFiltersProps {
  locationId: string;
  serviceId: string;
  masterId: string;
  status: string;
  search: string;
  onLocationChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  onMasterChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  onReset: () => void;
}

function getCurrentWeekRange(): { dateFrom: string; dateTo: string } {
  const monday = getMonday(new Date());
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return {
    dateFrom: formatDateISO(monday),
    dateTo: formatDateISO(sunday),
  };
}

export function BookingFilters({
  locationId,
  serviceId,
  masterId,
  status,
  search,
  onLocationChange,
  onServiceChange,
  onMasterChange,
  onStatusChange,
  onSearchChange,
  onReset,
}: BookingFiltersProps) {
  const { dateFrom, dateTo, selectDateRange } = useNavigation();

  // Selection data owned by this component (GH #213 §6.4, R2): direct queries
  // on the CANONICAL keys with the RAW getAll* fetchers — TanStack dedupes
  // with every other ['locations']/['services']/['masters'] consumer. Raw
  // shapes keep the `!archived` filter and name/title/first_name labels
  // verbatim (the shared hooks' transforms would drop `archived`).
  const { data: locations = [] } = useQuery<LocationResponse[]>({
    queryKey: ['locations'],
    queryFn: () => getAllLocations(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: services = [] } = useQuery<ServiceResponse[]>({
    queryKey: ['services'],
    queryFn: () => getAllServices(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: masters = [] } = useQuery<MasterResponse[]>({
    queryKey: ['masters'],
    queryFn: () => getAllMasters(),
    staleTime: 5 * 60 * 1000,
  });

  const locationList = locations.filter(l => !l.archived);
  const serviceList = services.filter(s => !s.archived);
  const masterList = masters.filter(m => !m.archived);

  // GH #212 Task 12 — search input: local draft echoes keystrokes instantly
  // while typing is debounced 300ms before reaching onSearchChange →
  // context setFilters({ search }) → server ?q=. Mirrors DataTable's
  // draft+debounce pattern (spec §6.7). External `search` changes (e.g. the
  // reset button clearing it) sync the draft and cancel a pending debounce.
  const [draft, setDraft] = useState(search);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setDraft(search);
    cancelTimer();
  }, [search, cancelTimer]);

  // No stale onSearchChange after unmount.
  useEffect(() => () => cancelTimer(), [cancelTimer]);

  const handleSearchChange = (value: string) => {
    setDraft(value);
    cancelTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onSearchChange(value);
    }, 300);
  };

  const handleReset = () => {
    onReset();
    const { dateFrom: monday, dateTo: sunday } = getCurrentWeekRange();
    selectDateRange(monday, sunday);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Поиск</label>
        <input
          type="text"
          value={draft}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Клиент или услуга..."
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-mid)', backgroundColor: 'var(--white)' }}
          aria-label="Поиск по клиенту или услуге"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Дата от</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => selectDateRange(e.target.value, dateTo)}
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
          onChange={(e) => selectDateRange(dateFrom, e.target.value)}
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
          {locationList.map((l) => (
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
          {serviceList.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
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
          {masterList.map((m) => (
            <option key={m.id} value={m.id}>{m.first_name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Статус</label>
        <StatusFiltersPicker
          value={status === '' ? null : (status as VisitStatus)}
          onChange={(v) => onStatusChange(v ?? '')}
          size="md"
          testIdPrefix="booking-filters-status"
        />
      </div>

      <button
        onClick={handleReset}
        className="px-3 py-1.5 text-xs font-medium transition-colors rounded-lg"
        style={{ color: 'var(--brand)', border: '1px solid var(--brand)' }}
      >
        Сбросить
      </button>
    </div>
  );
}
