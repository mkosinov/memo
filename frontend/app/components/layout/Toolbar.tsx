'use client';

import React from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { getMonday, MONTHS_GENITIVE } from '@/lib/utils';

// ─── Toolbar ──────────────────────────────────────────────────────────────

export function Toolbar() {
  const { currentWeek, setCurrentWeek } = useSchedule();

  const monday = getMonday(currentWeek);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const dateRangeLabel = `${monday.getDate()}–${sunday.getDate()} ${MONTHS_GENITIVE[sunday.getMonth()]} ${sunday.getFullYear()}`;

  const handlePrevWeek = () => {
    const prev = new Date(monday);
    prev.setDate(prev.getDate() - 7);
    setCurrentWeek(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(monday);
    next.setDate(next.getDate() + 7);
    setCurrentWeek(next);
  };

  const handleToday = () => {
    setCurrentWeek(getMonday(new Date()));
  };

  return (
    <div
      className="sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4"
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
        >
          <option value="">Все мастера</option>
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
        >
          <option value="">Все локации</option>
        </select>
      </div>
    </div>
  );
}
