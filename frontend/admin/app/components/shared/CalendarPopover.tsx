'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { MONTHS, DAYS } from '@/lib/utils';

interface CalendarPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDate: (date: Date) => void;
  selectedDate: Date;
}

/**
 * Compact calendar popover for date selection in the Topbar.
 * Shows a single month grid with navigation arrows.
 */
export function CalendarPopover({
  isOpen,
  onClose,
  onSelectDate,
  selectedDate,
}: CalendarPopoverProps) {
  // Initialize with the month of selectedDate
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const dialogRef = useRef<HTMLDivElement>(null);

  // Sync viewMonth/viewYear when selectedDate changes (e.g., from prev/next period)
  useEffect(() => {
    if (isOpen) {
      setViewMonth(selectedDate.getMonth());
      setViewYear(selectedDate.getFullYear());
    }
  }, [isOpen, selectedDate]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handlePrevMonth = useCallback(() => {
    setViewMonth(prev => {
      if (prev === 0) {
        setViewYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setViewMonth(prev => {
      if (prev === 11) {
        setViewYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
  }, []);

  const handleDayClick = useCallback((day: number) => {
    const clicked = new Date(viewYear, viewMonth, day);
    onSelectDate(clicked);
    onClose();
  }, [viewYear, viewMonth, onSelectDate, onClose]);

  // Build the calendar grid days
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // getDay(): 0=Sun, 1=Mon... We want Mon=0 ... Sun=6
    let startDayOfWeek = firstDay.getDay(); // 0=Sun
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // Convert to Mon=0

    // Build array: empty cells + day numbers
    const cells: Array<{ day: number; empty: boolean }> = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      cells.push({ day: 0, empty: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, empty: false });
    }
    return cells;
  }, [viewYear, viewMonth]);

  // Today's date for highlighting
  const today = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }, []);

  // Selected date for highlighting
  const selected = useMemo(() => ({
    year: selectedDate.getFullYear(),
    month: selectedDate.getMonth(),
    day: selectedDate.getDate(),
  }), [selectedDate]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Календарь"
      data-testid="calendar-popover"
      className="absolute top-full left-0 mt-1 rounded-lg border z-50 p-3"
      style={{
        backgroundColor: 'var(--white)',
        borderColor: 'var(--line)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        width: '240px',
      }}
    >
      {/* ── Month/Year header with navigation ── */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={handlePrevMonth}
          aria-label="Предыдущий месяц"
          className="flex items-center justify-center w-6 h-6 rounded-md text-xs transition-colors hover:bg-surface"
          style={{ color: 'var(--ink-mid)' }}
          data-testid="calendar-prev-month"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 2L3.5 5L6.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span
          className="text-[11px] font-semibold select-none"
          style={{ color: 'var(--ink)' }}
        >
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button
          onClick={handleNextMonth}
          aria-label="Следующий месяц"
          className="flex items-center justify-center w-6 h-6 rounded-md text-xs transition-colors hover:bg-surface"
          style={{ color: 'var(--ink-mid)' }}
          data-testid="calendar-next-month"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* ── Day-of-week headers ── */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAYS.map(day => (
          <div
            key={day}
            className="text-center text-[9px] font-medium py-0.5"
            style={{ color: 'var(--ink-light)' }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* ── Day grid ── */}
      <div className="grid grid-cols-7 gap-0">
        {calendarDays.map((cell, idx) => {
          if (cell.empty) {
            return <div key={`empty-${idx}`} className="w-full aspect-square" />;
          }

          const isToday = cell.day === today.day && viewMonth === today.month && viewYear === today.year;
          const isSelected = cell.day === selected.day && viewMonth === selected.month && viewYear === selected.year;

          return (
            <button
              key={cell.day}
              onClick={() => handleDayClick(cell.day)}
              data-selected={isSelected}
              data-today={isToday}
              className="w-full aspect-square flex items-center justify-center text-[11px] font-medium rounded-md transition-colors cursor-pointer"
              style={{
                color: isSelected
                  ? 'white'
                  : isToday
                    ? 'var(--brand)'
                    : 'var(--ink)',
                backgroundColor: isSelected
                  ? 'var(--brand)'
                  : isToday
                    ? 'var(--brand-faint)'
                    : 'transparent',
                fontWeight: isSelected || isToday ? 600 : 400,
              }}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
