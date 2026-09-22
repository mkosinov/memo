'use client';

import React, { Suspense, useEffect, useMemo, useCallback, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Calendar,
  Clipboard,
  Users,
  Palette,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  History,
  Image as ImageIcon,
} from 'lucide-react';
import { useUI } from '@/contexts/UIContext';
import { useMasters } from '@/hooks/useMasters';
import { useAuth } from '@/contexts/AuthContext';
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
  // GH #344 §7: the audit journal — admin-only reading surface (the
  // backend pair GET /audit-logs(+/authors) is require_admin).
  '/audit',
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

// GH #344 §7: «Журнал» — standalone admin-only item placed AFTER the
// «Справочники» collapsible. Like PHOTO_ITEM it is a const single link;
// the isAdminOnly('/audit') filter below drops it for masters.
const AUDIT_ITEM = { label: 'Журнал', Icon: History, href: '/audit' } as const;

// ─── MiniCalendar ─────────────────────────────────────────────────────────
// #138 T4 (spec §2.3): the calendar is a NAVIGATOR + period indicator, not an
// owner of the period. It reads the CURRENT page's period via useSearchParams
// (under Suspense — the layout tree has no data-bearing ancestor) and
// navigates by pushing /schedule?view=&date=. Month paging/picker is local
// display state, re-synced to the page's period on EVERY navigation.

interface MiniCalendarProps {
  collapsed: boolean;
}

const MINI_VIEW_MODES = ['week', 'day'] as const;
type MiniViewMode = (typeof MINI_VIEW_MODES)[number];

/** Strict `YYYY-MM-DD` AND a real calendar date (mirrors useScheduleView). */
function parseDateParam(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Reject rollovers like 2026-02-31 (Date would silently land in March)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** Today's local midnight. */
function todayMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The period of the CURRENT page, as the mini calendar mirrors it. */
type CalendarPeriod =
  | { kind: 'schedule'; view: MiniViewMode; date: Date }
  | { kind: 'range'; from: Date; to: Date }
  | { kind: 'neutral'; today: Date };

function readPagePeriod(pathname: string, params: URLSearchParams): CalendarPeriod {
  const today = todayMidnight();
  if (pathname === '/schedule') {
    const rawView = params.get('view');
    const view: MiniViewMode =
      rawView !== null && (MINI_VIEW_MODES as readonly string[]).includes(rawView)
        ? (rawView as MiniViewMode)
        : 'week';
    return { kind: 'schedule', view, date: parseDateParam(params.get('date')) ?? today };
  }
  if (pathname === '/records') {
    const from = parseDateParam(params.get('from'));
    const to = parseDateParam(params.get('to'));
    // Red range ONLY for an explicit valid pair (from ≤ to) — the default
    // current-week records period stays uncoloured (spec §2.3).
    if (from && to && from.getTime() <= to.getTime()) {
      return { kind: 'range', from, to };
    }
  }
  return { kind: 'neutral', today };
}

function MiniCalendar({ collapsed }: MiniCalendarProps) {
  // useSearchParams in a layout-level client component requires a Suspense
  // boundary for prerendering; fallback null keeps the sidebar shape stable.
  return (
    <Suspense fallback={null}>
      {!collapsed && <MiniCalendarContent />}
    </Suspense>
  );
}

function MiniCalendarContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const today = todayMidnight();
  const period = useMemo(
    () => readPagePeriod(pathname, searchParams),
    [pathname, searchParams],
  );

  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const monthButtonRef = useRef<HTMLButtonElement>(null);
  const [pickerTop, setPickerTop] = useState(0);

  // Displayed month = local state; re-synced to the page's period on EVERY
  // navigation (e.g. /records?from=… shows the ?from month; a day click on
  // /schedule shows the ?date month). Month arrows/picker write NO URL.
  const [monthAnchor, setMonthAnchor] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const searchKey = searchParams.toString();
  useEffect(() => {
    const p = readPagePeriod(pathname, new URLSearchParams(searchKey));
    const anchor = p.kind === 'range' ? p.from : p.kind === 'schedule' ? p.date : p.today;
    setMonthAnchor(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  }, [pathname, searchKey]);

  // Navigation: day click → week view of that day; double-click → day view.
  // Pushing an identical URL creates no history entry (native router).
  const pushSchedule = useCallback(
    (view: MiniViewMode, date: Date) => {
      router.push(`/schedule?view=${view}&date=${toISODate(date)}`);
    },
    [router],
  );

  const handleDayClick = useCallback((day: Date) => pushSchedule('week', day), [pushSchedule]);

  const handleDayDoubleClick = useCallback((day: Date) => pushSchedule('day', day), [pushSchedule]);

  const handleGoToToday = useCallback(() => {
    // Keep the current view when already on /schedule (incl. day mode — legacy
    // behaviour); from any other page land on the current week.
    const view = period.kind === 'schedule' ? period.view : 'week';
    pushSchedule(view, today);
  }, [period, pushSchedule, today]);

  const handlePrevMonth = useCallback(() => {
    setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1));
  }, [monthAnchor]);

  const handleNextMonth = useCallback(() => {
    setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1));
  }, [monthAnchor]);

  const calendarDays = useMemo(() => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

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
  }, [monthAnchor]);

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

  // Week-row indicator: mirrors the page's period (schedule date / today).
  // Suppressed entirely in range mode — the red range replaces it.
  const indicatorMonday =
    period.kind === 'range' ? null : getMonday(period.kind === 'schedule' ? period.date : period.today);

  const isInIndicatorWeek = (date: Date) =>
    indicatorMonday !== null && getMonday(date).getTime() === indicatorMonday.getTime();

  const isCurrentMonth = (date: Date) =>
    date.getMonth() === monthAnchor.getMonth();

  const monthName = MONTHS[monthAnchor.getMonth()];

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
            {monthName} {monthAnchor.getFullYear()}
          </button>

          {showMonthPicker && (
            <MonthYearPicker
              selectedMonth={monthAnchor.getMonth()}
              selectedYear={monthAnchor.getFullYear()}
              onSelect={(month, year) => {
                // Local display state — paging/picker writes no URL (#138 §2.3)
                setMonthAnchor(new Date(year, month, 1));
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
          const weekIsActive = isInIndicatorWeek(week[0]);

          return (
            <div
              key={wi}
              className={`w-full grid grid-cols-7 gap-0 rounded-md py-0.5 transition-colors duration-150
                ${weekIsActive ? 'bg-brand/30' : ''}`}
            >
              {week.map((day, di) => {
                const isDayToday = isSameDay(day, today);
                const inWeek = isInIndicatorWeek(day);
                const inMonth = isCurrentMonth(day);

                // Day-level brand highlight (existing inline toggle):
                // day view → the single selected day; week view → every day
                // of the active week. Range mode replaces it with red.
                const isDayHighlighted =
                  period.kind === 'schedule' &&
                  (period.view === 'day' ? isSameDay(day, period.date) : isInIndicatorWeek(day));

                // /records with a valid explicit ?from&to → red range tint,
                // CLIPPED to the visible month (spec §2.3 «срез видимого
                // месяца»): out-of-month ghost cells stay plain. Edges carry
                // distinct rounding ("[5 6 7]" — start/end read).
                const dayKey = toISODate(day);
                const isRangeStart =
                  inMonth && period.kind === 'range' && dayKey === toISODate(period.from);
                const isRangeEnd =
                  inMonth && period.kind === 'range' && dayKey === toISODate(period.to);
                const inRange =
                  inMonth &&
                  period.kind === 'range' &&
                  dayKey >= toISODate(period.from) &&
                  dayKey <= toISODate(period.to);

                // Shape + background: circle for today/day-highlight, pill
                // edges for the range range start/end, plain tint for the middle.
                let shapeClass = 'rounded-full';
                let highlightBg = '';
                if (isRangeStart || isRangeEnd) {
                  shapeClass = `${isRangeStart ? 'rounded-l-full' : ''} ${isRangeEnd ? 'rounded-r-full' : ''}`;
                  highlightBg = 'bg-red-400/45';
                } else if (inRange) {
                  shapeClass = '';
                  highlightBg = 'bg-red-400/25';
                } else if (isDayToday) {
                  highlightBg = 'bg-brand text-white';
                } else if (isDayHighlighted) {
                  highlightBg = 'bg-brand/40 text-white';
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
                      className={`relative flex items-center justify-center w-5 h-5 text-[11px] ${shapeClass}
                        ${!inMonth ? 'text-white/20' : isDayToday ? 'text-white font-bold' : inWeek ? 'text-white/90' : 'text-white/50'}
                        ${highlightBg}
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

  // #138 T4: the view-mode/selected-day mirror state (event-driven) and the
  // NavigationContext period wiring are gone — MiniCalendar reads the page
  // period from searchParams itself.

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
        <MiniCalendar collapsed={sidebarCollapsed} />

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

          {/* Журнал — standalone (GH #344 §7, admin-only, after Справочников) */}
          {isAdmin && (
            (() => {
              const active = isActive(AUDIT_ITEM.href);
              return (
                <Link
                  href={AUDIT_ITEM.href}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150
                    ${active
                    ? 'bg-brand text-white font-medium'
                    : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                  }
                    ${sidebarCollapsed ? 'justify-center px-1' : ''}`}
                  aria-label={AUDIT_ITEM.label}
                  title={sidebarCollapsed ? AUDIT_ITEM.label : undefined}
                >
                  <History size={18} strokeWidth={2} className={active ? 'text-white' : 'text-white/60'} />
                  {!sidebarCollapsed && <span>{AUDIT_ITEM.label}</span>}
                </Link>
              );
            })()
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
