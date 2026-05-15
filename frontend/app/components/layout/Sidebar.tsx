'use client';

import React, { useMemo } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import { ARTISTS } from '@/lib/mock-data';
import { DAYS, MONTHS, getMonday, formatDate } from '@/lib/utils';

// ─── Navigation Items ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Расписание', icon: '📅', active: true },
  { label: 'Бронирования', icon: '📋', active: false },
  { label: 'Клиенты', icon: '👥', active: false },
  { label: 'Мастера', icon: '🎨', active: false },
  { label: 'Чат', icon: '💬', active: false },
] as const;

// ─── MiniCalendar ─────────────────────────────────────────────────────────

interface MiniCalendarProps {
  currentWeek: Date;
  setCurrentWeek: (date: Date) => void;
  collapsed: boolean;
}

function MiniCalendar({ currentWeek, setCurrentWeek, collapsed }: MiniCalendarProps) {
  const today = new Date();

  const calendarDays = useMemo(() => {
    // Show current month + 1 week before/after
    const firstDayOfMonth = new Date(currentWeek.getFullYear(), currentWeek.getMonth(), 1);
    const lastDayOfMonth = new Date(currentWeek.getFullYear(), currentWeek.getMonth() + 1, 0);

    // Start from the Monday of the week that contains the 1st of the month
    const startDate = getMonday(firstDayOfMonth);
    // Go back one more week
    startDate.setDate(startDate.getDate() - 7);

    // End: last day of month + 1 week
    const endDate = new Date(lastDayOfMonth);
    endDate.setDate(endDate.getDate() + 13); // enough to cover the last week

    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [currentWeek]);

  // Group into weeks (rows of 7 starting from Monday)
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

  const currentWeekMonday = getMonday(currentWeek);

  const handleWeekClick = (weekMonday: Date) => {
    setCurrentWeek(new Date(weekMonday));
  };

  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const isInCurrentWeek = (date: Date) => {
    const dMonday = getMonday(date);
    return dMonday.getTime() === currentWeekMonday.getTime();
  };

  const isCurrentMonth = (date: Date) =>
    date.getMonth() === currentWeek.getMonth();

  if (collapsed) return null;

  const monthName = MONTHS[currentWeek.getMonth()];

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white/90">{monthName} {currentWeek.getFullYear()}</span>
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
            <button
              key={wi}
              onClick={() => handleWeekClick(weekMonday)}
              className={`w-full grid grid-cols-7 gap-0 rounded-md py-0.5 transition-colors duration-150
                ${isActive ? 'bg-brand/30' : 'hover:bg-white/5'}`}
              aria-label={`Неделя с ${formatDate(weekMonday)}`}
            >
              {week.map((day, di) => {
                const today = isToday(day);
                const inWeek = isInCurrentWeek(day);
                const inMonth = isCurrentMonth(day);

                return (
                  <div key={di} className="flex items-center justify-center">
                    <span
                      className={`relative flex items-center justify-center w-5 h-5 text-[11px] rounded-full
                        ${!inMonth ? 'text-white/20' : today ? 'text-white font-bold' : inWeek ? 'text-white/90' : 'text-white/50'}
                        ${today ? 'bg-brand text-white' : ''}
                      `}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Artist Legend ────────────────────────────────────────────────────────

interface ArtistLegendProps {
  collapsed: boolean;
}

function ArtistLegend({ collapsed }: ArtistLegendProps) {
  if (collapsed) {
    return (
      <div className="px-2 py-2 space-y-1.5">
        {ARTISTS.slice(0, 4).map(artist => (
          <div
            key={artist.id}
            className="w-5 h-5 rounded-full mx-auto"
            style={{ backgroundColor: artist.color }}
            title={artist.shortName}
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
        {ARTISTS.map(artist => (
          <div key={artist.id} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: artist.color }}
            />
            <span className="text-xs text-white/70 truncate">{artist.shortName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────

export function Sidebar() {
  const { currentWeek, setCurrentWeek } = useSchedule();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme } = useUI();

  return (
    <aside
      data-testid="sidebar"
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
          currentWeek={currentWeek}
          setCurrentWeek={setCurrentWeek}
          collapsed={sidebarCollapsed}
        />

        {!sidebarCollapsed && <div className="border-t border-white/10 mx-3" />}

        {/* Navigation */}
        <nav className={`py-2 ${sidebarCollapsed ? 'px-1' : 'px-2'}`}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.label}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
                ${item.active
                  ? 'bg-brand text-white font-medium'
                  : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                }
                ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
              aria-label={item.label}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="text-base">{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {!sidebarCollapsed && <div className="border-t border-white/10 mx-3" />}

        {/* Artist Legend */}
        <ArtistLegend collapsed={sidebarCollapsed} />
      </div>

      {/* ── Bottom Section ── */}
      <div className="border-t border-white/10">
        {/* Theme Toggle + Collapse */}
        <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-2 py-3' : 'justify-between px-3 py-2'}`}>
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
            aria-label="Переключить тему"
            title="Переключить тему"
          >
            {theme === 'light' ? '☀' : '☾'}
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

        {/* User Avatar + Version */}
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-3 pb-3">
            <div className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-xs text-white font-medium">
              А
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/70 truncate">Админ</div>
              <div className="text-[10px] text-white/30">v0.1.0</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
