'use client';

import React, { useMemo } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import { ARTISTS } from '@/lib/mock-data';
import { DAYS, MONTHS, getMonday, formatDate } from '@/lib/utils';

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
  { label: 'Расписание', icon: 'calendar', active: true },
  { label: 'Бронирования', icon: 'clipboard', active: false },
  { label: 'Клиенты', icon: 'users', active: false },
  { label: 'Мастера', icon: 'palette', active: false },
  { label: 'Чат', icon: 'chat', active: false },
] as const;

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  calendar: CalendarIcon,
  clipboard: ClipboardIcon,
  users: UsersIcon,
  palette: PaletteIcon,
  chat: ChatIcon,
};

// ─── MiniCalendar ─────────────────────────────────────────────────────────

interface MiniCalendarProps {
  currentWeek: Date;
  setCurrentWeek: (date: Date) => void;
  collapsed: boolean;
}

function MiniCalendar({ currentWeek, setCurrentWeek, collapsed }: MiniCalendarProps) {
  const today = new Date();

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(currentWeek.getFullYear(), currentWeek.getMonth(), 1);
    const lastDayOfMonth = new Date(currentWeek.getFullYear(), currentWeek.getMonth() + 1, 0);

    const startDate = getMonday(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - 7);

    const endDate = new Date(lastDayOfMonth);
    endDate.setDate(endDate.getDate() + 13);

    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [currentWeek]);

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

      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] text-white/40 font-medium py-0.5">
            {d}
          </div>
        ))}
      </div>

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
          {NAV_ITEMS.map(item => {
            const IconComponent = ICON_MAP[item.icon];
            return (
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
                <IconComponent className={item.active ? 'text-white' : 'text-white/60'} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && <div className="border-t border-white/10 mx-3" />}

        {/* Artist Legend */}
        <ArtistLegend collapsed={sidebarCollapsed} />
      </div>

      {/* ── Bottom Section ── */}
      <div className="border-t border-white/10">
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

        {/* User Avatar */}
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-3 pb-3">
            <div className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-xs text-white font-medium">
              А
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/70 truncate">Админ</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
