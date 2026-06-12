'use client';

import React, { useMemo, useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNavigation } from '@/contexts/NavigationContext';
import { useUI } from '@/contexts/UIContext';
import type { ViewModeType } from '@/contexts/ScheduleContext';
import { useMasters } from '@/hooks/useMasters';
import { DAYS, DAYS_FULL, MONTHS, MONTHS_GENITIVE, getMonday, formatDate, formatDateISO, isSameDay } from '@/lib/utils';
import { MonthYearPicker } from '../shared/MonthYearPicker';
import type { Master } from '@memo/domain';

// ─── SVG Icon Components ──────────────────────────────────────────────────

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function PaletteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''} ${className ?? ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

// ─── Navigation Items ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Расписание', icon: 'calendar', href: '/schedule' },
  { label: 'Записи', icon: 'clipboard', href: '/records' },
  { label: 'Клиенты', icon: 'users', href: '/clients' },
] as const;

const DIRECTORY_ITEMS = [
  { label: 'Услуги', icon: 'package', href: '/services' },
  { label: 'Локации', icon: 'mapPin', href: '/locations' },
  { label: 'Теги', icon: 'tag', href: '/tags' },
] as const;

const PHOTO_ITEM = { label: 'Фото', icon: 'image', href: '/photos' } as const;

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  calendar: CalendarIcon,
  clipboard: ClipboardIcon,
  users: UsersIcon,
  palette: PaletteIcon,
  chat: ChatIcon,
  package: PackageIcon,
  mapPin: MapPinIcon,
  tag: TagIcon,
  image: ImageIcon,
};

// ─── MiniCalendar ─────────────────────────────────────────────────────────

interface MiniCalendarProps {
  selectedWeek: Date;
  selectedDay: Date;
  viewMode: 'day' | 'week';
  onWeekSelect: (date: Date) => void;
  collapsed: boolean;
}

function MiniCalendar({ selectedWeek, selectedDay, viewMode, onWeekSelect, collapsed }: MiniCalendarProps) {
  const today = new Date();
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const handleGoToToday = useCallback(() => {
    const now = new Date();
    const monday = getMonday(now);
    onWeekSelect(monday);
    // Also dispatch event so ScheduleContext can reset selectedDay
    document.dispatchEvent(new CustomEvent('__memo-go-to-today'));
    // In day mode, also select the single day
    if (viewMode === 'day') {
      document.dispatchEvent(new CustomEvent('__memo-select-day', { detail: { date: now } }));
    }
  }, [onWeekSelect, viewMode]);

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth(), 1);
    const lastDayOfMonth = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth() + 1, 0);

    const startDate = getMonday(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - 7);

    // End on Sunday of the week containing the last day of the month
    const endDate = new Date(lastDayOfMonth);
    const dayOfWeek = endDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    endDate.setDate(endDate.getDate() + daysUntilSunday);

    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [selectedWeek]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    let week: Date[] = [];
    for (const day of calendarDays) {
      if (day.getDay() === 1 && week.length > 0) {
        result.push(week);
        week = [];
      }
      week.push(day);
    }
    if (week.length > 0) result.push(week);
    return result;
  }, [calendarDays]);

  const currentWeekMonday = getMonday(selectedWeek);

  const handleWeekClick = (weekMonday: Date) => {
    onWeekSelect(weekMonday);
  };

  const handleDayClick = (day: Date) => {
    if (viewMode === 'day') {
      // DayView: select single day (dispatch a special event for ScheduleContext)
      document.dispatchEvent(new CustomEvent('__memo-select-day', { detail: { date: day } }));
    } else {
      // WeekView: select the week containing this day
      const weekMonday = getMonday(day);
      handleWeekClick(weekMonday);
    }
  };

  const handleDayDoubleClick = (day: Date) => {
    // Double-click in WeekView: switch to DayView and select that day
    document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date: day } }));
  };

  const handlePrevMonth = useCallback(() => {
    const target = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth() - 1, 1);
    onWeekSelect(target);
  }, [selectedWeek, onWeekSelect]);

  const handleNextMonth = useCallback(() => {
    const target = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth() + 1, 1);
    onWeekSelect(target);
  }, [selectedWeek, onWeekSelect]);

  const isInCurrentWeek = (date: Date) => {
    const dMonday = getMonday(date);
    return dMonday.getTime() === currentWeekMonday.getTime();
  };

  const isCurrentMonth = (date: Date) =>
    date.getMonth() === selectedWeek.getMonth();

  if (collapsed) return null;

  const monthName = MONTHS[selectedWeek.getMonth()];

  return (
    <div className="px-3 py-2">
      {/* Today button — full width */}
      <button
        type="button"
        onClick={handleGoToToday}
        className="w-full rounded-md px-2 py-1 text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10 whitespace-nowrap text-center mb-2"
        style={{
          border: '1px solid rgba(255,255,255,0.3)',
        }}
      >
        Сегодня {today.getDate()} {MONTHS_GENITIVE[today.getMonth()]}, {DAYS_FULL[(today.getDay() + 6) % 7]}
      </button>

      {/* Month picker row: ← Month Year ▼ → */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="flex items-center justify-center w-6 h-6 rounded-md text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Предыдущий месяц"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMonthPicker(prev => !prev)}
            className="flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white transition-colors"
          >
            {monthName} {selectedWeek.getFullYear()}
            <svg
              className={`w-3 h-3 transition-transform duration-150 ${showMonthPicker ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {showMonthPicker && (
            <MonthYearPicker
              selectedMonth={selectedWeek.getMonth()}
              selectedYear={selectedWeek.getFullYear()}
              onSelect={(month, year) => {
                const target = new Date(year, month, 1);
                onWeekSelect(target);
                setShowMonthPicker(false);
              }}
              onClose={() => setShowMonthPicker(false)}
            />
          )}
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          className="flex items-center justify-center w-6 h-6 rounded-md text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Следующий месяц"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] text-white/40 font-medium py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-0.5">
        {weeks.map((week, wi) => {
          const weekMonday = week[0];
          const isActive = weekMonday.getTime() === currentWeekMonday.getTime();

          return (
            <div
              key={wi}
              className={`w-full grid grid-cols-7 gap-0 rounded-md py-0.5 transition-colors duration-150
                ${isActive ? 'bg-brand/30' : ''}`}
            >
              {week.map((day, di) => {
                const isDayToday = isSameDay(day, today);
                const inWeek = isInCurrentWeek(day);
                const inMonth = isCurrentMonth(day);

                // Highlight logic based on viewMode
                let isHighlighted = false;
                if (viewMode === 'day') {
                  // Day mode: highlight the specific selected day
                  isHighlighted = isSameDay(day, selectedDay);
                } else {
                  // Week mode: highlight entire week row
                  isHighlighted = isActive;
                }

                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => handleDayClick(day)}
                    onDoubleClick={() => handleDayDoubleClick(day)}
                    className="flex items-center justify-center hover:bg-white/5 transition-colors"
                    aria-label={formatDate(day)}
                  >
                    <span
                      className={`relative flex items-center justify-center w-5 h-5 text-[11px] rounded-full
                        ${!inMonth ? 'text-white/20' : isDayToday ? 'text-white font-bold' : inWeek ? 'text-white/90' : 'text-white/50'}
                        ${isDayToday ? 'bg-brand text-white' : ''}
                        ${isHighlighted && !isDayToday ? 'bg-brand/40 text-white' : ''}
                      `}
                    >
                      {day.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Master Legend ────────────────────────────────────────────────────────

interface MasterLegendProps {
  collapsed: boolean;
  masters: Master[];
}

function MasterLegend({ collapsed, masters }: MasterLegendProps) {
  if (collapsed) {
    return (
      <div className="px-2 py-2 space-y-1.5">
        {masters.slice(0, 4).map(master => (
          <div
            key={master.id}
            className="w-5 h-5 rounded-full mx-auto"
            style={{ backgroundColor: master.color }}
            title={master.shortName}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-2">
        Мастера
      </div>
      <div className="space-y-1.5">
        {masters.map(master => (
          <div key={master.id} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: master.color }}
            />
            <span className="text-xs text-white/70 truncate">{master.shortName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Menubar ──────────────────────────────────────────────────────────────

export function Menubar() {
  const { dateFrom, selectDateRange } = useNavigation();
  const { data: masters = [] } = useMasters();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme } = useUI();
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Track viewMode & selectedDay via custom events from ScheduleContext
  // (Menubar lives outside ScheduleProvider in the component tree)
  const [viewMode, setViewMode] = useState<ViewModeType>('week');
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  React.useEffect(() => {
    const handleViewMode = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.viewMode) setViewMode(detail.viewMode);
    };
    const handleSelectedDay = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.selectedDay) setSelectedDay(new Date(detail.selectedDay));
    };
    document.addEventListener('__memo-view-mode-changed', handleViewMode);
    document.addEventListener('__memo-selected-day-changed', handleSelectedDay);
    return () => {
      document.removeEventListener('__memo-view-mode-changed', handleViewMode);
      document.removeEventListener('__memo-selected-day-changed', handleSelectedDay);
    };
  }, []);

  const selectedWeek = useMemo(() => new Date(dateFrom + 'T00:00:00'), [dateFrom]);

  const handleWeekSelect = useCallback((date: Date) => {
    const monday = getMonday(date);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    selectDateRange(formatDateISO(monday), formatDateISO(sunday));
  }, [selectDateRange]);

  const toggleMenu = useCallback((menu: string) => {
    setOpenMenu(prev => prev === menu ? null : menu);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      data-testid="menubar"
      className={`fixed left-0 top-0 h-full bg-sidebar z-30 transition-all duration-200 flex flex-col`}
      style={{
        width: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
        backgroundColor: 'var(--sidebar-bg)',
      }}
    >
      {/* ── Logo Section ── */}
      <div className={`flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'px-4'} py-4 border-b border-white/10`}>
        <div className="flex items-center gap-2">
          <span className="text-lg" role="img" aria-label="mountain">🏔</span>
          {!sidebarCollapsed && (
            <span className="text-sm font-bold text-white tracking-wide">
              Colour Mountains
            </span>
          )}
        </div>
      </div>

      {/* ── Scrollable Content ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* MiniCalendar */}
        <MiniCalendar
          selectedWeek={selectedWeek}
          selectedDay={selectedDay}
          viewMode={viewMode}
          onWeekSelect={handleWeekSelect}
          collapsed={sidebarCollapsed}
        />

        {!sidebarCollapsed && <div className="border-t border-white/10 mx-3" />}

        {/* Navigation */}
        <nav className={`py-2 ${sidebarCollapsed ? 'px-1' : 'px-2'}`}>
          {/* Regular nav items */}
          {NAV_ITEMS.map(item => {
            const IconComponent = ICON_MAP[item.icon];
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
                  ${active
                    ? 'bg-brand text-white font-medium'
                    : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                  }
                  ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
                aria-label={item.label}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <IconComponent className={active ? 'text-white' : 'text-white/60'} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}

          {/* Мастера — collapsible */}
          <button
            onClick={() => toggleMenu('masters')}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
              text-white/60 hover:bg-white/5 hover:text-white/90
              ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
            aria-label="Мастера"
            aria-expanded={openMenu === 'masters'}
            title={sidebarCollapsed ? 'Мастера' : undefined}
          >
            <PaletteIcon className="text-white/60" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left">Мастера</span>
                <ChevronIcon expanded={openMenu === 'masters'} className="text-white/40" />
              </>
            )}
          </button>
          {openMenu === 'masters' && !sidebarCollapsed && (
            <div className="ml-4 mt-0.5 mb-1 space-y-0.5">
              {masters.map(master => (
                <div
                  key={master.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md"
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: master.color }}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-white/70 truncate">
                      {master.name}
                    </span>
                    {master.specialty && (
                      <span className="text-[10px] text-white/40 truncate">
                        {master.specialty}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Справочники — collapsible */}
          <button
            onClick={() => toggleMenu('directories')}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
              text-white/60 hover:bg-white/5 hover:text-white/90
              ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
            aria-label="Справочники"
            aria-expanded={openMenu === 'directories'}
            title={sidebarCollapsed ? 'Справочники' : undefined}
          >
            <BookIcon className="text-white/60" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left">Справочники</span>
                <ChevronIcon expanded={openMenu === 'directories'} className="text-white/40" />
              </>
            )}
          </button>
          {openMenu === 'directories' && !sidebarCollapsed && (
            <div className="ml-4 mt-0.5 mb-1 space-y-0.5">
              {DIRECTORY_ITEMS.map(item => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors
                      ${active
                        ? 'text-white bg-white/10 font-medium'
                        : 'text-white/60 hover:text-white/90 hover:bg-white/5'
                      }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Фото — standalone */}
          {(() => {
            const active = isActive(PHOTO_ITEM.href);
            return (
              <Link
                href={PHOTO_ITEM.href}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
                  ${active
                    ? 'bg-brand text-white font-medium'
                    : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                  }
                  ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
                aria-label={PHOTO_ITEM.label}
                title={sidebarCollapsed ? PHOTO_ITEM.label : undefined}
              >
                <ImageIcon className={active ? 'text-white' : 'text-white/60'} />
                {!sidebarCollapsed && <span>{PHOTO_ITEM.label}</span>}
              </Link>
            );
          })()}
        </nav>

        {!sidebarCollapsed && <div className="border-t border-white/10 mx-3" />}

        {/* Master Legend — removed, duplicates Masters submenu */}
      </div>

      {/* ── Bottom Section ── */}
      <div className="border-t border-white/10">
        {/* User Avatar */}
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <div className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-xs text-white font-medium">
              А
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/70 truncate">Админ</div>
            </div>
          </div>
        )}

        {/* Theme Toggle (slider) + Collapse */}
        <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-2 py-3' : 'justify-between px-3 py-2'}`}>
          {/* Theme slider switch */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1 bg-white/10 rounded-full p-0.5 cursor-pointer transition-colors hover:bg-white/15"
            aria-label="Переключить тему"
            title="Переключить тему"
          >
            <div className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${theme === 'light' ? 'bg-white/20 text-white' : 'text-white/40'}`}>
              <SunIcon />
            </div>
            <div className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${theme === 'dark' ? 'bg-white/20 text-white' : 'text-white/40'}`}>
              <MoonIcon />
            </div>
          </button>

          <button
            onClick={toggleSidebar}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
            aria-label={sidebarCollapsed ? 'Развернуть sidebar' : 'Свернуть sidebar'}
            title={sidebarCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${sidebarCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Version at bottom */}
        {!sidebarCollapsed && (
          <div className="px-3 pb-2">
            <span className="text-[10px] text-white/30">memo v0.0.1</span>
          </div>
        )}
      </div>
    </aside>
  );
}
