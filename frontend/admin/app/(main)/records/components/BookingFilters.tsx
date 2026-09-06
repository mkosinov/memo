'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { displayMasterName } from '@/lib/utils';
import { getMonday, toISODate } from '@/lib/datetime';
import { StatusFiltersPicker } from '@/app/components/shared/StatusFiltersPicker';
import { Combobox, type ComboboxOption } from '@/app/components/shared/Combobox';
import { useLocationsRaw } from '@/hooks/useLocations';
import { useServicesRaw } from '@/hooks/useServices';
import { useMastersRaw } from '@/hooks/useMasters';
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
    dateFrom: toISODate(monday),
    dateTo: toISODate(sunday),
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

  // Selection data owned by this component (GH #213 §6.4, R2): the shared RAW
  // hooks (#140) on the CANONICAL keys — TanStack dedupes with every other
  // ['locations']/['services']/['masters'] consumer. Raw shapes keep the
  // `!archived` filter and name/title/first_name labels verbatim (the domain
  // hooks' transforms would drop `archived`).
  const { data: locations = [] } = useLocationsRaw();
  const { data: services = [] } = useServicesRaw();
  const { data: masters = [] } = useMastersRaw();

  const locationList = locations.filter(l => !l.archived);
  const serviceList = services.filter(s => !s.archived);
  const masterList = masters.filter(m => !m.archived);

  // GH #214 Task 8 (§6 rows 10-12): option arrays per spec §6.2 — queries,
  // keys and the `!archived` filters above are unchanged; only the control
  // swaps. Master label unifies to «Фамилия Имя» (§6.1) + swatch from color.
  const locationOptions: ComboboxOption[] = locationList.map((l) => ({
    value: l.id,
    label: l.name,
    searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
  }));
  const serviceOptions: ComboboxOption[] = serviceList.map((s) => ({
    value: s.id,
    label: s.title,
  }));
  const masterOptions: ComboboxOption[] = masterList.map((m) => ({
    value: m.id,
    label: displayMasterName(m),
    color: m.color,
  }));

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
        <Combobox
          clearLabel="Все локации"
          value={locationId}
          options={locationOptions}
          onChange={(v) => onLocationChange(v)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          ariaLabel="Фильтр по локации"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Услуга</label>
        <Combobox
          clearLabel="Все услуги"
          value={serviceId}
          options={serviceOptions}
          onChange={(v) => onServiceChange(v)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          ariaLabel="Фильтр по услуге"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>Мастер</label>
        <Combobox
          clearLabel="Все мастера"
          value={masterId}
          options={masterOptions}
          onChange={(v) => onMasterChange(v)}
          className="rounded-lg border px-2 py-1.5 text-xs"
          ariaLabel="Фильтр по мастеру"
        />
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
