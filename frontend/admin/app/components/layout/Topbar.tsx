'use client';

import React from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { getMonday, formatDateISO, MONTHS_GENITIVE } from '@/lib/utils';

// ─── Topbar ───────────────────────────────────────────────────────────────

export function Topbar() {
  const { dateFrom, selectDateRange } = useNavigation();
  const {
    artists,
    locations,
    filterMasterId,
    filterLocationId,
    setFilterMasterId,
    setFilterLocationId,
  } = useSchedule();

  const monday = new Date(dateFrom + 'T00:00:00');
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const dateRangeLabel = `${monday.getDate()}–${sunday.getDate()} ${MONTHS_GENITIVE[sunday.getMonth()]} ${sunday.getFullYear()}`;

  const handlePrevWeek = () => {
    const prev = new Date(monday);
    prev.setDate(prev.getDate() - 7);
    const prevMonday = getMonday(prev);
    const prevSunday = new Date(prevMonday);
    prevSunday.setDate(prevSunday.getDate() + 6);
    selectDateRange(formatDateISO(prevMonday), formatDateISO(prevSunday));
  };

  const handleNextWeek = () => {
    const next = new Date(monday);
    next.setDate(next.getDate() + 7);
    const nextMonday = getMonday(next);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);
    selectDateRange(formatDateISO(nextMonday), formatDateISO(nextSunday));
  };

  const handleToday = () => {
    const today = new Date();
    const thisMonday = getMonday(today);
    const thisSunday = new Date(thisMonday);
    thisSunday.setDate(thisSunday.getDate() + 6);
    selectDateRange(formatDateISO(thisMonday), formatDateISO(thisSunday));
  };

  return (
    <div
      className="sticky top-0 z-40 flex h-12 items-center justify-between border-b px-3"
      style={{
        backgroundColor: 'var(--white)',
        borderColor: 'var(--line)',
      }}
    >
      {/* ── Left: Week Navigation ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={handlePrevWeek}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mid transition-colors hover:bg-surface hover:text-ink"
          aria-label="Предыдущая неделя"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span
          data-testid="date-range"
          className="text-sm font-medium"
          style={{ color: 'var(--ink)' }}
        >
          {dateRangeLabel}
        </span>

        <button
          onClick={handleNextWeek}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mid transition-colors hover:bg-surface hover:text-ink"
          aria-label="Следующая неделя"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button
          onClick={handleToday}
          className="ml-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            color: 'var(--brand)',
            border: '1px solid var(--brand)',
          }}
        >
          Сегодня
        </button>
      </div>

      {/* ── Center: View Toggle (Day/Week) ── */}
      <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--surface)' }}>
        <button
          className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
          style={{ color: 'var(--ink-light)' }}
        >
          День
        </button>
        <button
          className="rounded-md px-3 py-1 text-xs font-medium text-white shadow-sm"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          Неделя
        </button>
      </div>

      {/* ── Right: Filters ── */}
      <div className="flex items-center gap-2">
        {/* Artist filter */}
        <select
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--line)',
            color: 'var(--ink-mid)',
            backgroundColor: 'var(--white)',
          }}
          aria-label="Фильтр по мастеру"
          value={filterMasterId ?? ''}
          onChange={e => setFilterMasterId(e.target.value || null)}
        >
          <option value="">Все мастера</option>
          {artists.map(a => (
            <option key={a.id} value={a.id}>{a.shortName}</option>
          ))}
        </select>

        {/* Location filter */}
        <select
          className="rounded-lg border px-2 py-1.5 text-xs"
          style={{
            borderColor: 'var(--line)',
            color: 'var(--ink-mid)',
            backgroundColor: 'var(--white)',
          }}
          aria-label="Фильтр по локации"
          value={filterLocationId ?? ''}
          onChange={e => setFilterLocationId(e.target.value || null)}
        >
          <option value="">Все локации</option>
          {locations.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
