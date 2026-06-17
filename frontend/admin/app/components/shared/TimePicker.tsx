'use client';

import React, { useMemo, useCallback } from 'react';

export interface TimePickerProps {
  value: string; // ISO datetime string, e.g. "2026-06-11T14:00:00"
  onChange: (value: string) => void;
  gridFrequency: number;
  precise: boolean;
  label?: string;
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
  const hhmm = timePart.slice(0, 5); // "HH:MM"
  // Validate format
  if (/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  return '00:00';
}

/** Extract the date portion "YYYY-MM-DD" from an ISO string. */
function extractDate(iso: string): string {
  if (!iso) return '';
  const datePart = iso.split('T')[0];
  return datePart ?? '';
}

/** Extract the suffix after "HH:MM" (e.g. ":00" or ":45"). */
function extractTimeSuffix(iso: string): string {
  if (!iso) return '';
  const timePart = iso.split('T')[1];
  if (!timePart || timePart.length <= 5) return '';
  return timePart.slice(5); // e.g. ":00", ":30", ":45"
}

/** Find the closest grid-aligned time in the options list. */
function snapToGrid(timeHHMM: string, options: string[]): string {
  if (options.includes(timeHHMM)) return timeHHMM;

  // Parse the input time to minutes
  const [h, m] = timeHHMM.split(':').map(Number);
  const inputMinutes = h * 60 + m;

  let closest = options[0]!;
  let minDiff = Infinity;

  for (const opt of options) {
    const [oh, om] = opt.split(':').map(Number);
    const optMinutes = oh * 60 + om;
    const diff = Math.abs(inputMinutes - optMinutes);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }

  return closest;
}

// ─── Component ────────────────────────────────────────────────────────────

export function TimePicker({
  value,
  onChange,
  gridFrequency,
  precise,
  label,
}: TimePickerProps) {
  const stepMinutes = precise ? 1 : gridFrequency;

  const options = useMemo(() => generateTimeOptions(stepMinutes), [stepMinutes]);

  const selectedTime = useMemo(() => {
    const hhmm = extractTimeHHMM(value);
    return snapToGrid(hhmm, options);
  }, [value, options]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newTime = e.target.value;
      const date = extractDate(value);
      const suffix = extractTimeSuffix(value);
      onChange(`${date}T${newTime}${suffix}`);
    },
    [value, onChange],
  );

  const inputClasses =
    'w-full rounded-lg border px-3 py-2 text-sm bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand)]';
  const inputStyle = { borderColor: 'var(--line, #e5e7eb)' };

  return (
    <div>
      {label && (
        <label
          className="text-xs font-medium text-ink-mid block mb-1"
          htmlFor="time-picker-select"
        >
          {label}
        </label>
      )}
      <select
        id="time-picker-select"
        aria-label={label}
        className={inputClasses}
        style={inputStyle}
        value={selectedTime}
        onChange={handleChange}
        data-testid="time-picker-select"
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
