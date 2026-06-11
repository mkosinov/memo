'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { getMonday, formatDateISO } from '@/lib/utils';
import { MultiSelect } from '../shared/MultiSelect';
import type { Master, Location } from '@memo/domain';

// ─── Helpers ──────────────────────────────────────────────────────────────

function groupMastersBySpecialty(master: Master): string {
  return master.specialty || 'Без специальности';
}

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
    columnMode,
    setColumnMode,
  } = useSchedule();
  const { selectDateRange } = useNavigation();

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

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

  const handleDayButtonClick = useCallback(() => {
    handleViewModeSwitch('day');
  }, [handleViewModeSwitch]);

  const handleDropdownToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDropdownOpen(prev => !prev);
  }, []);

  const handleColumnModeSelect = useCallback((mode: 'masters' | 'locations') => {
    setColumnMode(mode);
    setDropdownOpen(false);
    // Also switch to day view if not already
    if (viewMode !== 'day') {
      handleViewModeSwitch('day');
    }
  }, [setColumnMode, viewMode, handleViewModeSwitch]);

  const dayLabel = columnMode === 'masters' ? 'День по мастерам' : 'День по локациям';

  return (
    <div
      className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b px-3"
      style={{
        backgroundColor: 'var(--white)',
        borderColor: 'var(--line)',
      }}
    >
      {/* ── Left: Masters + Locations filters ── */}
      <div className="flex items-center gap-2">
        <MultiSelect<Master>
          items={masters}
          selectedIds={filterMasterIds}
          onSelectionChange={setFilterMasterIds}
          label="Мастера"
          getId={(m) => m.id}
          getLabel={(m) => m.shortName}
          getGroup={groupMastersBySpecialty}
          renderItemLabel={(m) => (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: m.color }}
              />
              <span style={{ color: 'var(--ink, #1a1a1a)' }}>{m.shortName}</span>
            </span>
          )}
        />
        <MultiSelect<Location>
          items={locations}
          selectedIds={filterLocationIds}
          onSelectionChange={setFilterLocationIds}
          label="Локации"
          getId={(l) => l.id}
          getLabel={(l) => l.name}
        />
      </div>

      {/* ── Right: Combined Day+ColumnMode / Week Toggle ── */}
      <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--surface)' }}>
        {/* Day button with dropdown */}
        <div className="relative" ref={dropdownRef}>
          <div className="flex items-center">
            <button
              onClick={handleDayButtonClick}
              className="rounded-l-md px-3 py-1 text-xs font-medium transition-colors"
              style={viewMode === 'day'
                ? { backgroundColor: 'var(--brand)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                : { color: 'var(--ink-light)' }
              }
              data-testid="day-button"
            >
              {dayLabel}
            </button>
            <button
              onClick={handleDropdownToggle}
              className="rounded-r-md px-1.5 py-1 text-xs transition-colors border-l"
              style={viewMode === 'day'
                ? { backgroundColor: 'var(--brand)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }
                : { color: 'var(--ink-light)', borderColor: 'var(--ink-faint)' }
              }
              aria-label="Открыть меню выбора режима колонок"
              data-testid="column-mode-dropdown"
            >
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div
              className="absolute top-full right-0 mt-1 min-w-[160px] rounded-lg border py-1 z-50"
              style={{
                backgroundColor: 'var(--white)',
                borderColor: 'var(--line)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
              role="menu"
              data-testid="column-mode-menu"
            >
              <button
                role="menuitem"
                data-active={columnMode === 'masters'}
                onClick={() => handleColumnModeSelect('masters')}
                className="w-full px-3 py-1.5 text-left text-xs font-medium transition-colors flex items-center gap-2"
                style={columnMode === 'masters'
                  ? { color: 'var(--brand)' }
                  : { color: 'var(--ink)' }
                }
              >
                {columnMode === 'masters' && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={columnMode === 'masters' ? '' : 'pl-[20px]'}>
                  По мастерам
                </span>
              </button>
              <button
                role="menuitem"
                data-active={columnMode === 'locations'}
                onClick={() => handleColumnModeSelect('locations')}
                className="w-full px-3 py-1.5 text-left text-xs font-medium transition-colors flex items-center gap-2"
                style={columnMode === 'locations'
                  ? { color: 'var(--brand)' }
                  : { color: 'var(--ink)' }
                }
              >
                {columnMode === 'locations' && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={columnMode === 'locations' ? '' : 'pl-[20px]'}>
                  По локациям
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Week button */}
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
  );
}
