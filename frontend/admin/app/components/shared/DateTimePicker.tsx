'use client';

import React, { useMemo, useCallback } from 'react';

export interface DateTimePickerProps {
  /** ISO datetime string, e.g. "2026-06-15T14:00" */
  value: string;
  /** Callback with new ISO datetime string */
  onChange: (value: string) => void;
  /** Grid frequency in minutes (e.g. 15, 30) — used for time step when precise=false */
  gridFrequency: number;
  /** When true, show all minutes; when false, show only gridFrequency-aligned times */
  precise: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Generate time options as "HH:MM" strings based on step. */
function generateTimeOptions(stepMinutes: number): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    options.push(
      `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
    );
  }
  return options;
}

/** Extract "HH:MM" from an ISO datetime string. Falls back to "00:00". */
function extractTimeHHMM(iso: string): string {
  if (!iso) return '00:00';
  const timePart = iso.split('T')[1];
  if (!timePart) return '00:00';
  const hhmm = timePart.slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  return '00:00';
}

/** Extract the date portion "YYYY-MM-DD" from an ISO string. */
function extractDate(iso: string): string {
  if (!iso) return '';
  return iso.split('T')[0] ?? '';
}

/** Find the closest option in the list. */
function snapToOptions(timeHHMM: string, options: string[]): string {
  if (options.includes(timeHHMM)) return timeHHMM;

  const [h, m] = timeHHMM.split(':').map(Number);
  const inputMinutes = h * 60 + m;

  let closest = options[0]!;
  let minDiff = Infinity;

  for (const opt of options) {
    const [oh, om] = opt.split(':').map(Number);
    const diff = Math.abs(inputMinutes - (oh * 60 + om));
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }

  return closest;
}

// ─── Component ────────────────────────────────────────────────────────────

export function DateTimePicker({
  value,
  onChange,
  gridFrequency,
  precise,
}: DateTimePickerProps) {
  const stepMinutes = precise ? 1 : gridFrequency;

  const options = useMemo(() => generateTimeOptions(stepMinutes), [stepMinutes]);

  const selectedDate = useMemo(() => extractDate(value), [value]);

  const selectedTime = useMemo(() => {
    const hhmm = extractTimeHHMM(value);
    return snapToOptions(hhmm, options);
  }, [value, options]);

  const handleDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = e.target.value;
      if (newDate) {
        onChange(`${newDate}T${selectedTime}`);
      }
    },
    [onChange, selectedTime],
  );

  const handleTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newTime = e.target.value;
      onChange(`${selectedDate}T${newTime}`);
    },
    [onChange, selectedDate],
  );

  const inputClasses =
    'w-full rounded-lg border px-3 py-2 text-sm bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand)]';
  const inputStyle = { borderColor: 'var(--line, #e5e7eb)' };

  return (
    <div className="flex gap-2" data-testid="date-time-picker">
      <input
        type="date"
        value={selectedDate}
        onChange={handleDateChange}
        className={inputClasses}
        style={inputStyle}
        data-testid="date-time-picker-date"
      />
      <select
        value={selectedTime}
        onChange={handleTimeChange}
        className={inputClasses}
        style={inputStyle}
        data-testid="date-time-picker-time"
      >
        {options.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    </div>
  );
}
