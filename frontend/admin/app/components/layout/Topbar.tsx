'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { CELL_HEIGHT_OPTIONS, GRID_FREQUENCY_OPTIONS, formatWeekRange, formatDayLabel } from '@/lib/utils';
import { getMonday, toISODate } from '@/lib/datetime';
import { useNavigation } from '@/contexts/NavigationContext';
import { MultiSelect } from '../shared/MultiSelect';
import { CalendarPopover } from '../shared/CalendarPopover';
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
    cellHeight,
    setCellHeight,
    gridFrequency,
    setGridFrequency,
    workingHoursStart,
    setWorkingHoursStart,
    workingHoursEnd,
    setWorkingHoursEnd,
    prevPeriod,
    nextPeriod,
  } = useSchedule();
  const { selectDateRange } = useNavigation();

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Zoom popup state
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);

  // Calendar popover state
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

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

  // Close zoom popup on outside click
  useEffect(() => {
    if (!zoomOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) {
        setZoomOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [zoomOpen]);

  const handleViewModeSwitch = useCallback((newMode: 'day' | 'week') => {
    if (newMode === viewMode) return;

    if (newMode === 'week') {
      // DayView → WeekView: Show week containing selectedDay
      const monday = getMonday(selectedDay);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(monday), toISODate(sunday));
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
    setDropdownOpen(prev => !prev);
  }, [handleViewModeSwitch]);

  const handleColumnModeSelect = useCallback((mode: 'masters' | 'locations') => {
    setColumnMode(mode);
    setDropdownOpen(false);
    // Also switch to day view if not already
    if (viewMode !== 'day') {
      handleViewModeSwitch('day');
    }
  }, [setColumnMode, viewMode, handleViewModeSwitch]);

  const handleZoomSelect = useCallback((height: number) => {
    setCellHeight(height);
    setZoomOpen(false);
  }, [setCellHeight]);

  const handleFrequencySelect = useCallback((freq: number) => {
    setGridFrequency(freq);
  }, [setGridFrequency]);

  const handleCalendarDateSelect = useCallback((date: Date) => {
    if (viewMode === 'week') {
      // In week mode: select the week containing the clicked date
      const monday = getMonday(date);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(monday), toISODate(sunday));
    } else {
      // In day mode: select the single day
      setSelectedDay(date);
      // Also navigate the week range to contain this day
      const monday = getMonday(date);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(toISODate(monday), toISODate(sunday));
    }
    setCalendarOpen(false);
  }, [viewMode, selectDateRange, setSelectedDay]);

  const dayLabel = columnMode === 'masters' ? 'День по мастерам' : 'День по локациям';

  return (
    <div
      className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b px-3 justify-end"
      style={{
        backgroundColor: 'var(--white)',
        borderColor: 'var(--line)',
      }}
    >
      {/* ── Left: Date Navigation ── */}
      <div
        className="flex items-center mr-auto"
        data-testid="date-nav"
      >
        <button
          onClick={prevPeriod}
          data-testid="date-nav-prev"
          className="flex items-center justify-center w-7 h-7 rounded-l-md text-xs font-medium transition-colors hover:bg-surface"
          style={{ color: 'var(--ink-mid)', border: '1px solid var(--line)', borderRight: 'none' }}
          aria-label="Предыдущий период"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="relative" ref={calendarRef}>
          <button
            onClick={() => setCalendarOpen(prev => !prev)}
            data-testid="date-nav-text"
            className="flex items-center h-7 px-2.5 text-[11px] font-medium select-none whitespace-nowrap cursor-pointer transition-colors hover:bg-surface"
            style={{
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: '0',
            }}
          >
            {viewMode === 'week'
              ? formatWeekRange(currentWeek)
              : formatDayLabel(selectedDay)
            }
          </button>
          <CalendarPopover
            isOpen={calendarOpen}
            onClose={() => setCalendarOpen(false)}
            onSelectDate={handleCalendarDateSelect}
            selectedDate={viewMode === 'week' ? currentWeek : selectedDay}
          />
        </div>
        <button
          onClick={nextPeriod}
          data-testid="date-nav-next"
          className="flex items-center justify-center w-7 h-7 rounded-r-md text-xs font-medium transition-colors hover:bg-surface"
          style={{ color: 'var(--ink-mid)', border: '1px solid var(--line)', borderLeft: 'none' }}
          aria-label="Следующий период"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* ── Right: Masters + Locations filters ── */}
      <div className="flex items-center gap-2">
        <MultiSelect<Master>
          items={masters}
          selectedIds={filterMasterIds}
          onSelectionChange={setFilterMasterIds}
          label="Мастера"
          getId={(m) => m.id}
          getLabel={(m) => m.name}
          getGroup={groupMastersBySpecialty}
          renderItemLabel={(m) => (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: m.color }}
              />
              <span style={{ color: 'var(--ink, #1a1a1a)' }}>{m.name}</span>
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
          <button
            onClick={handleDayButtonClick}
            className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors"
            style={viewMode === 'day'
              ? { backgroundColor: 'var(--brand)', color: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
              : { color: 'var(--ink-light)' }
            }
            data-testid="day-button"
          >
            {dayLabel}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

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

      {/* ── Zoom icon + popup ── */}
      <div className="relative" ref={zoomRef}>
        <button
          onClick={() => setZoomOpen(prev => !prev)}
          data-testid="zoom-button"
          className="flex items-center justify-center w-7 h-7 rounded-md text-xs transition-colors hover:bg-surface"
          style={{ color: 'var(--ink-mid)', border: '1px solid var(--line)' }}
          aria-label="Масштаб расписания"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>

        {zoomOpen && (
          <div
            className="absolute top-full right-0 mt-1 min-w-[140px] rounded-lg border py-1 z-50"
            style={{
              backgroundColor: 'var(--white)',
              borderColor: 'var(--line)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            role="menu"
            data-testid="zoom-popup"
          >
            {CELL_HEIGHT_OPTIONS.map((option) => (
              <button
                key={option.value}
                role="menuitem"
                data-testid={`zoom-option-${option.value}`}
                data-active={cellHeight === option.value}
                onClick={() => handleZoomSelect(option.value)}
                className="w-full px-3 py-1.5 text-left text-xs font-medium transition-colors flex items-center gap-2"
                style={cellHeight === option.value
                  ? { color: 'var(--brand)' }
                  : { color: 'var(--ink)' }
                }
              >
                {cellHeight === option.value && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={cellHeight === option.value ? '' : 'pl-[20px]'}>
                  {option.label}
                </span>
              </button>
            ))}
            {/* ── Divider ── */}
            <div className="my-1 mx-2 border-t" style={{ borderColor: 'var(--line)' }} />
            {/* ── Frequency section label ── */}
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>
              Частота сетки:
            </div>
            {GRID_FREQUENCY_OPTIONS.map((option) => (
              <button
                key={option.value}
                role="menuitem"
                data-testid={`grid-freq-${option.value}`}
                data-active={gridFrequency === option.value}
                onClick={() => handleFrequencySelect(option.value)}
                className="w-full px-3 py-1.5 text-left text-xs font-medium transition-colors flex items-center gap-2"
                style={gridFrequency === option.value
                  ? { color: 'var(--brand)' }
                  : { color: 'var(--ink)' }
                }
              >
                {gridFrequency === option.value && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={gridFrequency === option.value ? '' : 'pl-[20px]'}>
                  {option.label}
                </span>
              </button>
            ))}
            {/* ── Divider ── */}
            <div className="my-1 mx-2 border-t" style={{ borderColor: 'var(--line)' }} />
            {/* ── Working hours section ── */}
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-light)' }}>
              Рабочее время:
            </div>
            <div className="px-3 py-2 flex items-center gap-2">
              <label className="text-[11px] font-medium" style={{ color: 'var(--ink)' }}>С</label>
              <input
                type="number"
                min={0}
                max={23}
                value={workingHoursStart}
                onChange={(e) => setWorkingHoursStart(Number(e.target.value))}
                className="w-12 px-1.5 py-0.5 text-[11px] font-medium rounded border text-center"
                style={{
                  borderColor: 'var(--line)',
                  color: 'var(--ink)',
                  backgroundColor: 'var(--white)',
                }}
                aria-label="Рабочее время начало"
              />
              <span className="text-[11px]" style={{ color: 'var(--ink-light)' }}>:00</span>
              <label className="text-[11px] font-medium" style={{ color: 'var(--ink)' }}>По</label>
              <input
                type="number"
                min={0}
                max={23}
                value={workingHoursEnd}
                onChange={(e) => setWorkingHoursEnd(Number(e.target.value))}
                className="w-12 px-1.5 py-0.5 text-[11px] font-medium rounded border text-center"
                style={{
                  borderColor: 'var(--line)',
                  color: 'var(--ink)',
                  backgroundColor: 'var(--white)',
                }}
                aria-label="Рабочее время окончание"
              />
              <span className="text-[11px]" style={{ color: 'var(--ink-light)' }}>:00</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
