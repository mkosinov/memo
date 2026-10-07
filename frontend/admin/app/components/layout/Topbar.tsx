'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { useScheduleData, SCHEDULE_ACTIVITY_MUTATION_KEY } from '@/contexts/schedule/ScheduleDataContext';
import { useScheduleView as useScheduleUrlView } from '@/hooks/useScheduleView';
import { useScheduleView } from '@/contexts/schedule/ScheduleViewContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useSavingToast } from '@/hooks/useSavingToast';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import { useUI } from '@/contexts/UIContext';
import { CELL_HEIGHT_OPTIONS, GRID_FREQUENCY_OPTIONS, formatWeekRange, formatDayLabel } from '@/lib/utils';
import { MultiSelect } from '../shared/MultiSelect';
import { CalendarPopover } from '../shared/CalendarPopover';
import type { Master, Location } from '@memo/domain';

// ─── Helpers ──────────────────────────────────────────────────────────────

function groupMastersBySpecialty(master: Master): string {
  return master.specialty || 'Без специальности';
}

/** Options of the single view selector (the «Вид» dropdown). */
const VIEW_OPTIONS = [
  { kind: 'masters', label: 'День мастеров' },
  { kind: 'locations', label: 'День локаций' },
  { kind: 'week', label: 'Неделя' },
] as const;

type ViewOptionKind = (typeof VIEW_OPTIONS)[number]['kind'];

// ─── Topbar ───────────────────────────────────────────────────────────────

export function Topbar() {
  const { masters, locations } = useScheduleData();
  const { rightPanelCollapsed, toggleRightPanel } = useUI();
  // View state: consumed straight from the URL hook — the single writer of
  // /schedule?view=&date=&col= (#138 Task 3). Day-anchor logic lives there.
  const {
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    currentWeek,
    columnMode,
    setColumnMode,
    prevPeriod,
    nextPeriod,
  } = useScheduleUrlView();
  // Non-view concerns (filter lists) stay on the context.
  const {
    filterMasterIds,
    filterLocationIds,
    setFilterMasterIds,
    setFilterLocationIds,
  } = useScheduleView();
  const {
    cellHeight,
    setCellHeight,
    gridFrequency,
    setGridFrequency,
    workingHoursStart,
    setWorkingHoursStart,
    workingHoursEnd,
    setWorkingHoursEnd,
  } = useGridSettings();
  const { settings, updateSettings } = useUserSettings();

  // Beforeunload guard while any schedule mutation is in flight (spec §5).
  // The visible «Сохраняем…» indicator moved into the toast stack (see useSavingToast).
  const isSaving = useMutationState({
    filters: { mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY },
    select: (mutation) => mutation.state.status === 'pending',
  }).some(Boolean);
  useUnsavedChangesGuard(isSaving);
  useSavingToast();

  // Dropdown state
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);

  // View selector dropdown state
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  // Calendar popover state
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close popups on outside click
  useEffect(() => {
    if (!zoomOpen && !viewMenuOpen) return;
    const refs = [zoomRef, viewMenuRef];
    const handleClickOutside = (e: MouseEvent) => {
      if (refs.some((ref) => ref.current?.contains(e.target as Node))) return;
      setZoomOpen(false);
      setViewMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [zoomOpen, viewMenuOpen]);

  // #138 Task 3: pure delegation — the hook's setViewMode owns the day anchor
  // (today if the viewed week is current, else its Monday) and writes the URL.
  // Topbar duplicates neither.
  const handleViewModeSwitch = useCallback((newMode: 'day' | 'week') => {
    if (newMode === viewMode) return;
    setViewMode(newMode);
  }, [viewMode, setViewMode]);

  // Single view selector (three options over the same hook writes):
  // «Неделя» → setViewMode only; a day option → setColumnMode (display
  // replace, skipped when already active) + setViewMode('day') when coming
  // from the week (navigation push — the day anchor lives in the hook).
  const handleViewSelect = useCallback((kind: ViewOptionKind) => {
    setViewMenuOpen(false);
    if (kind === 'week') {
      handleViewModeSwitch('week');
      return;
    }
    if (columnMode !== kind) {
      setColumnMode(kind);
    }
    handleViewModeSwitch('day');
  }, [columnMode, setColumnMode, handleViewModeSwitch]);

  const handleZoomSelect = useCallback((height: number) => {
    setCellHeight(height);
    setZoomOpen(false);
  }, [setCellHeight]);

  const handleFrequencySelect = useCallback((freq: number) => {
    setGridFrequency(freq);
  }, [setGridFrequency]);

  // Date selection writes ONLY ?date in both modes: the hook derives
  // currentWeek = Monday of ?date, so a week-view selection moves the week
  // without ever touching ?view (#138 Task 3 DoD).
  const handleCalendarDateSelect = useCallback((date: Date) => {
    setSelectedDay(date);
    setCalendarOpen(false);
  }, [setSelectedDay]);

  // The active option of the single view selector: in week view it is
  // «Неделя», in day view the current column mode.
  const activeViewOption = viewMode === 'week' ? 'week' : columnMode;
  const activeViewLabel = VIEW_OPTIONS.find(({ kind }) => kind === activeViewOption)?.label;

  return (
    <div
      data-testid="topbar"
      className="sticky top-0 z-[var(--z-topbar)] flex h-12 items-center gap-2 border-b px-3 justify-end"
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

      {/* ── Area: Filters (masters + locations) ── */}
      <TopbarArea label="Фильтры" data-testid="topbar-filters-area">
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
          footer={
            <ArchivedToggle
              testId="show-archived-masters-toggle"
              checked={settings.showArchivedMasters}
              onChange={(next) => updateSettings({ showArchivedMasters: next })}
            />
          }
        />
        <MultiSelect<Location>
          items={locations}
          selectedIds={filterLocationIds}
          onSelectionChange={setFilterLocationIds}
          label="Локации"
          getId={(l) => l.id}
          getLabel={(l) => l.title}
          footer={
            <ArchivedToggle
              testId="show-archived-locations-toggle"
              checked={settings.showArchivedLocations}
              onChange={(next) => updateSettings({ showArchivedLocations: next })}
            />
          }
        />
      </TopbarArea>

      {/* ── Area: View — single dropdown selector (day by masters / day by locations / week) ── */}
      <TopbarArea label="Вид" data-testid="topbar-view-area">
        <div className="relative" ref={viewMenuRef}>
          <button
            onClick={() => setViewMenuOpen(prev => !prev)}
            data-testid="view-selector"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap"
            style={{
              backgroundColor: 'var(--white)',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
            }}
            aria-haspopup="menu"
            aria-expanded={viewMenuOpen}
          >
            {activeViewLabel}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {viewMenuOpen && (
            <div
              className="absolute top-full right-0 mt-1 min-w-[160px] rounded-lg border py-1 z-[var(--z-popover)]"
              style={{
                backgroundColor: 'var(--white)',
                borderColor: 'var(--line)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
              role="menu"
              data-testid="view-mode-menu"
            >
              {VIEW_OPTIONS.map(({ kind, label }) => {
                const active = activeViewOption === kind;
                return (
                  <button
                    key={kind}
                    role="menuitem"
                    data-testid={`view-${kind}`}
                    data-active={active}
                    onClick={() => handleViewSelect(kind)}
                    className="w-full px-3 py-1.5 text-left text-xs font-medium transition-colors flex items-center gap-2"
                    style={active
                      ? { color: 'var(--brand)' }
                      : { color: 'var(--ink)' }
                    }
                  >
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    <span className={active ? '' : 'pl-[20px]'}>{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </TopbarArea>

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
            className="absolute top-full right-0 mt-1 min-w-[140px] rounded-lg border py-1 z-[var(--z-popover)]"
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

      {/* ── Tools panel toggle (stamp) — lives in the topbar, right of the
          zoom; the bottom floating button was removed. Same aria contract as
          the old StampFab («Открыть/Закрыть панель инструментов»). ── */}
      <button
        onClick={toggleRightPanel}
        data-testid="stamp-toggle"
        className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-surface shrink-0"
        style={{
          color: rightPanelCollapsed ? 'var(--ink-mid)' : 'var(--brand)',
          border: `1px solid ${rightPanelCollapsed ? 'var(--line)' : 'var(--brand)'}`,
        }}
        aria-label={rightPanelCollapsed ? 'Открыть панель инструментов' : 'Закрыть панель инструментов'}
        title={rightPanelCollapsed ? 'Инструменты' : 'Закрыть инструменты'}
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 21h14" />
          <path d="M5 18h14v3H5z" />
          <path d="M9 18V9l3-6 3 6v9" />
          <path d="M7 18h10" />
          <circle cx="12" cy="11" r="1" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

/**
 * Labeled topbar area — groups related controls into one visually distinct
 * region (surface background + border + small uppercase caption on the left).
 */
function TopbarArea({
  label,
  'data-testid': testId,
  children,
}: {
  label: string;
  'data-testid'?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2 rounded-lg border px-2 py-1 shrink-0"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--line)',
      }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide select-none"
        style={{ color: 'var(--ink-light)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

/** GH #267: «Показывать архивные» checkbox in a filter dropdown footer. */
function ArchivedToggle({
  testId,
  checked,
  onChange,
}: {
  testId: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="w-full flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-gray-300 accent-[var(--brand)] cursor-pointer shrink-0"
        data-testid={testId}
      />
      <span className="text-[11px] font-medium" style={{ color: 'var(--ink, #1a1a1a)' }}>
        Показывать архивные
      </span>
    </label>
  );
}
