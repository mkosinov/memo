'use client';

import React, { useMemo, useCallback, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar,
  Clipboard,
  Users,
  Palette,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
} from 'lucide-react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useUI } from '@/contexts/UIContext';
import { useMasters } from '@/hooks/useMasters';
import { useAuth } from '@/contexts/AuthContext';
import type { ViewModeType } from '@/contexts/schedule/ScheduleViewContext';
import { DAYS, DAYS_FULL, MONTHS, MONTHS_GENITIVE, formatDate, isSameDay } from '@/lib/utils';
import { getMonday, toISODate } from '@/lib/datetime';
import { MonthYearPicker } from '../shared/MonthYearPicker';
import { UserMenu } from './UserMenu';
import type { Master } from '@memo/domain';

// ─── Icons ─────────────────────────────────────────────────────────────────
// GH #143: hand-written SVGs replaced by lucide-react (D3–D6). Sizing contract
// for sidebar icons: size={18} strokeWidth={2}; inline chevrons carry their own
// size (12 for the mini-calendar arrows, 16 for the sidebar collapse toggle).

/** Thin wrapper over lucide ChevronRight — rotates 90° when the section is expanded. */
function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <ChevronRight
      size={12}
      strokeWidth={2}
      className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''} ${className ?? ''}`}
    />
  );
}

// GH #262 §5.1: SunIcon/MoonIcon moved into UserMenu — the theme slider now
// lives in the user popup, not in the sidebar bottom row.

// ─── Navigation Items ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: 'Расписание', Icon: Calendar, href: '/schedule' },
  { label: 'Записи', Icon: Clipboard, href: '/records' },
  { label: 'Клиенты', Icon: Users, href: '/clients' },
] as const;

/**
 * GH #263 T9 — the section roots a master must NOT reach, single source for
 * BOTH the menu filter (below) and the (main)/layout access guard. The
 * backend scope (§3.5) already refuses these reads; this hides the UI paths.
 * Sub-paths match too (guard uses startsWith), so e.g. /clients/123 is
 * covered by '/clients'.
 */
export const ADMIN_ONLY_SECTIONS = [
  '/clients',
  '/locations',
  '/tags',
  '/staff',
  '/positions',
] as const;

const DIRECTORY_ITEMS = [
  // GH #266: «Сотрудники» — the staff directory screen (/staff). Placed in
  // «Справочники» per the user's 2026-09-10 decision. NOTE: this is NOT the
  // «Мастера» legend below — that one (colored dots, non-link) is the schedule
  // legend and is unchanged (D2).
  { label: 'Сотрудники', href: '/staff' },
  { label: 'Услуги', href: '/services' },
  { label: 'Локации', href: '/locations' },
  { label: 'Теги', href: '/tags' },
  // GH #266 T9: the positions dictionary (salary-side; D4).
  { label: 'Должности', href: '/positions' },
] as const;

/** GH #263 T9: master menu filter — drop every admin-only destination. */
const isAdminOnly = (href: string): boolean =>
  (ADMIN_ONLY_SECTIONS as readonly string[]).some(
    (section) => href === section || href.startsWith(`${section}/`),
  );

const PHOTO_ITEM = { label: 'Фото', Icon: ImageIcon, href: '/photos' } as const;

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
  const monthButtonRef = useRef<HTMLButtonElement>(null);
  const [pickerTop, setPickerTop] = useState(0);

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

    // End = Monday of the week containing lastDayOfMonth + 13 days (2 full weeks)
    // This ensures at least one full week (Mon-Sun) after the month ends
    const endDate = getMonday(lastDayOfMonth);
    endDate.setDate(endDate.getDate() + 13);

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
    // Always switch to week view containing this day
    document.dispatchEvent(new CustomEvent('__memo-switch-to-week-view', { detail: { date: day } }));
  };

  const handleDayDoubleClick = (day: Date) => {
    // Double-click in WeekView: switch to DayView and select that day
    document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date: day } }));
  };

  const handlePrevMonth = useCallback(() => {
    // Use 15th of prev month to ensure getMonday returns a date in the prev month
    const target = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth() - 1, 15);
    onWeekSelect(target);
  }, [selectedWeek, onWeekSelect]);

  const handleNextMonth = useCallback(() => {
    // Use 15th of next month to ensure getMonday returns a date in the next month
    const target = new Date(selectedWeek.getFullYear(), selectedWeek.getMonth() + 1, 15);
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
      {/* Today button — link style */}
      <button
        type="button"
        onClick={handleGoToToday}
        className="w-full text-xs text-white/70 hover:text-white hover:underline transition-colors whitespace-nowrap text-center mb-2"
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
          <ChevronLeft size={12} strokeWidth={2} />
        </button>

        <div className="relative">
          <button
            ref={monthButtonRef}
            type="button"
            onClick={() => {
              setShowMonthPicker(prev => {
                if (!prev && monthButtonRef.current) {
                  const rect = monthButtonRef.current.getBoundingClientRect();
                  setPickerTop(rect.bottom + 4);
                }
                return !prev;
              });
            }}
            className="flex items-center gap-1 text-xs font-semibold text-white/90 hover:text-white transition-colors"
          >
            {monthName} {selectedWeek.getFullYear()}
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
              triggerRef={monthButtonRef}
              style={{ top: `${pickerTop}px` }}
            />
          )}
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          className="flex items-center justify-center w-6 h-6 rounded-md text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Следующий месяц"
        >
          <ChevronRight size={12} strokeWidth={2} />
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
  const { sidebarCollapsed, toggleSidebar } = useUI();
  const { status, user } = useAuth();
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // GH #263 T9: masters lose the admin-only destinations (nav + directories)
  // and the «Мастера» collapsible; admins see everything (no diff).
  const isAdmin = user?.role === 'admin';
  const navItems = useMemo(
    () => (isAdmin ? NAV_ITEMS : NAV_ITEMS.filter((i) => !isAdminOnly(i.href))),
    [isAdmin],
  );
  const directoryItems = useMemo(
    () =>
      isAdmin
        ? DIRECTORY_ITEMS
        : DIRECTORY_ITEMS.filter((i) => !isAdminOnly(i.href)),
    [isAdmin],
  );

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
    selectDateRange(toISODate(monday), toISODate(sunday));
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
      className={`fixed left-0 top-0 h-full bg-sidebar z-[var(--z-sidebar)] transition-all duration-200 flex flex-col`}
      style={{
        width: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
        backgroundColor: 'var(--sidebar-bg)',
      }}
    >
      {/* ── Logo Section ── */}
      <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : ''} p-6 border-b border-white/10`}>
        <img
          src="/logo-white.png"
          alt="Colour Mountains"
          className={`flex-shrink-0 object-contain ${sidebarCollapsed ? 'w-6 h-auto' : 'max-h-8 w-auto'}`}
        />
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
          {navItems.map(item => {
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
                <item.Icon size={18} strokeWidth={2} className={active ? 'text-white' : 'text-white/60'} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}

          {/* Мастера — collapsible (admin-only: GH #263 T9) */}
          {isAdmin && (
            <button
              onClick={() => toggleMenu('masters')}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
                text-white/60 hover:bg-white/5 hover:text-white/90
                ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
              aria-label="Мастера"
              aria-expanded={openMenu === 'masters'}
              title={sidebarCollapsed ? 'Мастера' : undefined}
            >
              <Palette size={18} strokeWidth={2} className="text-white/60" />
              {!sidebarCollapsed && (
                <>
                  <span className="flex-1 text-left">Мастера</span>
                  <ChevronIcon expanded={openMenu === 'masters'} className="text-white/40" />
                </>
              )}
            </button>
          )}
          {isAdmin && openMenu === 'masters' && !sidebarCollapsed && (
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
                  <span className="text-xs text-white/70 truncate">
                    {master.name}
                  </span>
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
            <BookOpen size={18} strokeWidth={2} className="text-white/60" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left">Справочники</span>
                <ChevronIcon expanded={openMenu === 'directories'} className="text-white/40" />
              </>
            )}
          </button>
          {openMenu === 'directories' && !sidebarCollapsed && (
            <div className="ml-4 mt-0.5 mb-1 space-y-0.5">
              {directoryItems.map(item => {
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
                <ImageIcon size={18} strokeWidth={2} className={active ? 'text-white' : 'text-white/60'} />
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
        {/* User plate → UserMenu popup (GH #262 §5.1). Collapsed sidebar:
            avatar-only circular trigger (was hidden entirely before). */}
        {status === 'authenticated' && <UserMenu collapsed={sidebarCollapsed} />}

        {/* Collapse — the theme slider moved into the UserMenu popup (§5.1) */}
        <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-end'} px-3 py-2`}>
          <button
            onClick={toggleSidebar}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
            aria-label={sidebarCollapsed ? 'Развернуть sidebar' : 'Свернуть sidebar'}
            title={sidebarCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            <ChevronLeft
              size={16}
              strokeWidth={2}
              className={`transition-transform duration-200 ${sidebarCollapsed ? 'rotate-180' : ''}`}
            />
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
