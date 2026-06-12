'use client';

import React, { useState, useRef, useEffect } from 'react';
import { MONTHS } from '@/lib/utils';

interface MonthYearPickerProps {
  /** Currently selected month (0-11) */
  selectedMonth: number;
  /** Currently selected year */
  selectedYear: number;
  /** Called when a month is selected. Receives month index (0-11) and year. */
  onSelect: (month: number, year: number) => void;
  /** Called when picker should close (outside click) */
  onClose: () => void;
  /** Reference to the trigger button (to exclude from outside click) */
  triggerRef?: React.RefObject<HTMLElement>;
  /** Additional styles for positioning */
  style?: React.CSSProperties;
}

export function MonthYearPicker({ selectedMonth, selectedYear, onSelect, onClose, triggerRef, style }: MonthYearPickerProps) {
  const [year, setYear] = useState(selectedYear);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click (but not on trigger button)
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Don't close if click was on trigger button
        if (triggerRef?.current && triggerRef.current.contains(e.target as Node)) {
          return;
        }
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose, triggerRef]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border rounded-lg shadow-lg p-3 min-w-[200px]"
      style={{ borderColor: 'var(--line, #e5e7eb)', left: '12px', ...style }}
      data-testid="month-year-picker"
    >
      {/* Year navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setYear(y => y - 1)}
          className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-gray-100"
          aria-label="Предыдущий год"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 2L4 6L8 10" stroke="var(--ink-mid, #555)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
          {year}
        </span>
        <button
          type="button"
          onClick={() => setYear(y => y + 1)}
          className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-gray-100"
          aria-label="Следующий год"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2L8 6L4 10" stroke="var(--ink-mid, #555)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Month grid — 4 columns × 3 rows */}
      <div className="grid grid-cols-4 gap-1">
        {MONTHS.map((m, i) => {
          const isSelected = i === selectedMonth && year === selectedYear;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i, year)}
              className={`rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors
                ${isSelected
                  ? 'bg-[var(--brand)] text-white'
                  : 'hover:bg-gray-100 text-gray-700'
                }`}
            >
              {m.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
