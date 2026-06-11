'use client';

import React, { useCallback } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { getMonday, formatDateISO } from '@/lib/utils';
import { FilterDropdown } from '../shared/FilterDropdown';

// ─── Topbar ───────────────────────────────────────────────────────────────

export function Topbar() {
  const {
    masters,
    locations,
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    currentWeek,
  } = useSchedule();
  const { selectDateRange } = useNavigation();

  const handleViewModeSwitch = useCallback((newMode: 'day' | 'week') => {
    if (newMode === viewMode) return;

    if (newMode === 'week') {
      // DayView → WeekView: Show week containing selectedDay
      const monday = getMonday(selectedDay);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(formatDateISO(monday), formatDateISO(sunday));
    } else {
      // WeekView → DayView: Show today if in current week, else first day of week
      const today = new Date();
      const weekMonday = getMonday(currentWeek);
      const weekSunday = new Date(weekMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
      if (today >= weekMonday && today <= weekSunday) {
        setSelectedDay(today);
      } else {
        setSelectedDay(weekMonday);
      }
    }

    setViewMode(newMode);
  }, [viewMode, selectedDay, currentWeek, selectDateRange, setSelectedDay, setViewMode]);

  return (
    <div
      className="sticky top-0 z-40 flex h-12 items-center border-b px-3"
      style={{
        backgroundColor: 'var(--white)',
        borderColor: 'var(--line)',
      }}
    >
      {/* ── Left: spacer ── */}
      <div />

      {/* ── Center: View Toggle (Day/Week) ── */}
      <div className="flex-1 flex justify-center">
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--surface)' }}>
          <button
            onClick={() => handleViewModeSwitch('day')}
            className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
            style={viewMode === 'day'
              ? { backgroundColor: 'var(--brand)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
              : { color: 'var(--ink-light)' }
            }
          >
            День
          </button>
          <button
            onClick={() => handleViewModeSwitch('week')}
            className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
            style={viewMode === 'week'
              ? { backgroundColor: 'var(--brand)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
              : { color: 'var(--ink-light)' }
            }
          >
            Неделя
          </button>
        </div>
      </div>

      {/* ── Right: Filter Dropdown ── */}
      <div className="flex items-center justify-end">
        <FilterDropdown
          masters={masters}
          locations={locations}
          selectedMasterIds={filterMasterIds}
          selectedLocationIds={filterLocationIds}
          onMasterSelectionChange={setFilterMasterIds}
          onLocationSelectionChange={setFilterLocationIds}
        />
      </div>
    </div>
  );
}
