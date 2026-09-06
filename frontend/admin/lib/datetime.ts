// ─── Floating-local time module (GH #142) ──────────────────────────────────
// Single-TZ app: naive strings = studio wall clock (RFC 5545 floating time).
// The ONLY place that parses/composes schedule-canonical datetime strings.
// Future multi-TZ / Temporal support lands here (spec §11/§7).

/**
 * Result of parsing a schedule-canonical datetime string.
 *
 * `time`/`date` are convenience caches for string rendering — time math MUST
 * read `startMinutes`; never re-derive minutes from `time`.
 */
export interface ParsedLocalISO {
  date: string;        // YYYY-MM-DD
  time: string;        // HH:MM (display cache — never a source for time math)
  startMinutes: number; // minutes from midnight
  dayIndex: number;    // Mon=0..Sun=6
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * THE parser (spec §7). `new Date(start)` on a zone-less string parses as
 * LOCAL per the ES spec, so local getters return exactly the embedded studio
 * wall time regardless of browser TZ. Strings WITH `Z`/offset (test fixtures)
 * parse to the same instants; local getters then show browser-local wall time
 * — accepted and consistent for display-only paths.
 */
export function parseLocalISO(start: string): ParsedLocalISO {
  const d = new Date(start);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(hours)}:${pad2(minutes)}`,
    startMinutes: hours * 60 + minutes,
    dayIndex: (d.getDay() + 6) % 7,
  };
}

/**
 * Compose a floating-local datetime string ('YYYY-MM-DDTHH:MM:00') from a
 * Date using LOCAL getters — API writes. Replaces the inline padStart blocks
 * in ScheduleContext. Seconds are always '00' (schedule granularity: minutes).
 */
export function dateToLocalISO(date: Date): string {
  return `${toISODate(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:00`;
}

/** Compose a datetime string from a date key + integer minutes (mutation payloads: drag/drop, quick-add). */
export function composeLocalISO(date: string, startMinutes: number): string {
  const hh = pad2(Math.floor(startMinutes / 60));
  const mm = pad2(startMinutes % 60);
  return `${date}T${hh}:${mm}:00`;
}

/** Local YYYY-MM-DD date key — replaces `formatDateISO` and the `toISOString().slice(0, 10)` dups. */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Date key of the week day `dayIndex` (Mon=0..Sun=6) relative to the given week's Monday. */
export function dayIndexToDate(monday: Date, dayIndex: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + dayIndex);
  return toISODate(d);
}

/** Mon=0..Sun=6 index of a Date (absorbs `transformers.normalizeDay`). */
export function weekDayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Format integer minutes-from-midnight as 'HH:MM' — display ONLY. */
export function formatTime(startMinutes: number): string {
  const h = Math.floor(startMinutes / 60);
  const m = startMinutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Parse 'HH:MM' to integer minutes (replaces `hhmmToDecimal`). Invalid input → NaN; callers guard as today. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** The Monday (local midnight) of the week containing `date`. Semantics identical to the legacy `utils.getMonday`. */
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // getDay(): 0=Sun, 1=Mon, ... 6=Sat
  // Convert to Mon=0 ... Sun=6, then subtract to get Monday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Minute slots from `startMinutes` to `endMinutes` (exclusive — the legacy
 * `utils.generateTimeSlots` boundary) stepping by `gridFrequency` minutes.
 * Integer minutes make the legacy float-rounding hack unnecessary.
 */
export function generateTimeSlots(
  gridFrequency: number,
  startMinutes: number,
  endMinutes: number,
): number[] {
  const slots: number[] = [];
  for (let m = startMinutes; m < endMinutes; m += gridFrequency) {
    slots.push(m);
  }
  return slots;
}

/**
 * Adaptive grid time range in MINUTE space — port of the legacy
 * `utils.calculateGridTimeRange` (decimal hours → integer minutes).
 * Extends the working-hours range to fit activities outside it, never shrinks
 * below it, keeps at least 1 hour of padding, and clamps to a single day
 * [0, 1440] (the legacy [0, 24] hours clamp).
 *
 * @param acts - visible activities for the period
 * @param workingHoursStartH - default grid start, in hours (e.g. 9)
 * @param workingHoursEndH - default grid end, in hours (e.g. 21)
 */
export function calculateGridTimeRange(
  acts: Array<{ startMinutes: number; durationMinutes: number }>,
  workingHoursStartH: number,
  workingHoursEndH: number,
): { startMinutes: number; endMinutes: number } {
  const workingStart = workingHoursStartH * 60;
  const workingEnd = workingHoursEndH * 60;

  if (acts.length === 0) {
    return { startMinutes: workingStart, endMinutes: workingEnd };
  }

  let earliestStart = Infinity;
  let latestEnd = -Infinity;

  for (const a of acts) {
    if (a.startMinutes < earliestStart) earliestStart = a.startMinutes;
    const endTime = a.startMinutes + a.durationMinutes;
    if (endTime > latestEnd) latestEnd = endTime;
  }

  // Extend start only if an activity starts before working hours (at least
  // 1 hour padding). Clamp to [0, 1440] — minutes represent a single day.
  const adaptiveStart = earliestStart < workingStart
    ? Math.max(0, Math.floor(earliestStart / 60) * 60 - 60)
    : workingStart;

  // Extend end only if an activity ends after working hours (at least 1 hour padding).
  const adaptiveEnd = Math.min(1440, latestEnd > workingEnd
    ? Math.ceil(latestEnd / 60) * 60 + 60
    : workingEnd);

  return { startMinutes: adaptiveStart, endMinutes: adaptiveEnd };
}
