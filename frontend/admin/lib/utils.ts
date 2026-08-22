// ─── Display Utilities ────────────────────────────────────────────────────

/** Format master name as "Фамилия Имя" (Last Name + First Name). */
export function displayMasterName(master: { first_name: string; last_name: string }): string {
  return `${master.last_name} ${master.first_name}`;
}

// ─── Constants ────────────────────────────────────────────────────────────

export const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const;

export const DAYS_FULL = [
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье',
] as const;

export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

export const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

export const HOURS_START = 9;
export const HOURS_END = 21;
export const CELL_HEIGHT_MIN = 40;
export const CELL_HEIGHT_OPTIONS = [
  { value: 40, label: 'Мелкий' },
  { value: 50, label: 'Стандартный' },
  { value: 60, label: 'Крупный' },
] as const;
export const SLOT_COUNT = (HOURS_END - HOURS_START) * 2;
export const TIME_COL_WIDTH = 64;

// Grid frequency (minutes per slot)
export const GRID_FREQUENCY_OPTIONS = [
  { value: 5, label: '5 минут' },
  { value: 15, label: '15 минут' },
  { value: 30, label: '30 минут' },
] as const;
export const GRID_FREQUENCY_DEFAULT = 30;

// ─── Color Utilities ──────────────────────────────────────────────────────

/** Convert hex colour string to {r, g, b} object. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  // Support 3-digit hex
  const full = cleaned.length === 3
    ? cleaned.split('').map(c => c + c).join('')
    : cleaned;
  return {
    r: parseInt(full.substring(0, 2), 16),
    g: parseInt(full.substring(2, 4), 16),
    b: parseInt(full.substring(4, 6), 16),
  };
}

/** Mix an RGB colour with white. ratio=0 → original, ratio=1 → white. */
export function mixWithWhite(
  rgb: { r: number; g: number; b: number },
  ratio: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * ratio),
    g: Math.round(rgb.g + (255 - rgb.g) * ratio),
    b: Math.round(rgb.b + (255 - rgb.b) * ratio),
  };
}

// ─── Duration Utilities ──────────────────────────────────────────────────

/** Convert decimal hours (1.5) to HH:MM string ("01:30"). */
export function decimalToHHMM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Convert HH:MM string ("01:30") to decimal hours (1.5). */
export function hhmmToDecimal(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h + m / 60;
}

/** Format datetime for display: "Сб, 7 июня · 14:00". */
export function formatActivityContext(date: Date): string {
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const month = months[date.getMonth()];
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${dayName}, ${dayNum} ${month} · ${time}`;
}

/**
 * Human label for a record (records have no name — Addendum 13 / GH #139
 * T8-FE2a: used as the DeleteDialog entityName). Derived from the parent
 * activity's start: "15 мая · 14:00". Falls back to «запись» when the
 * activity start is not loaded.
 */
export function formatRecordLabel(activityStart: string | null | undefined): string {
  if (!activityStart) return 'запись';
  const d = new Date(activityStart);
  if (Number.isNaN(d.getTime())) return 'запись';
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} · ${time}`;
}

// ─── Time / Date Utilities ────────────────────────────────────────────────

/** Format hours to "HH:MM" string. 10 → "10:00", 10.5 → "10:30", 9.25 → "09:15". */
export function formatTime(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** Get the Monday of the week containing the given date. */
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

/** Format date as "13 мая" (day + genitive month). */
export function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}

/** Format week range: same month "8-14 июня", cross-month "29 июня - 5 июля". */
export function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const startDay = monday.getDate();
  const endDay = sunday.getDate();
  const startMonth = MONTHS_GENITIVE[monday.getMonth()];
  const endMonth = MONTHS_GENITIVE[sunday.getMonth()];
  if (monday.getMonth() === sunday.getMonth()) {
    return `${startDay}-${endDay} ${startMonth}`;
  }
  return `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
}

/** Format single day: "11 июня". */
export function formatDayLabel(date: Date): string {
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}

/** Format date as YYYY-MM-DD ISO string for API calls. */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Check if two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Generate time slots from start to end (exclusive) at given frequency (minutes). */
export function generateTimeSlots(frequencyMinutes: number = 30, start: number = HOURS_START, end: number = HOURS_END): number[] {
  const slots: number[] = [];
  const step = frequencyMinutes / 60; // convert to hours
  for (let t = start; t < end; t += step) {
    // Round to avoid floating point issues
    slots.push(Math.round(t * 100) / 100);
  }
  return slots;
}

/** Activity shape for adaptive grid calculation (subset of fields needed). */
interface GridActivity {
  startTime: number;
  duration: number; // in hours
}

/** Grid time range result. */
export interface GridTimeRange {
  start: number;
  end: number;
}

/**
 * Calculate adaptive grid time range based on actual activities.
 * Extends the working hours range to fit activities outside the default range.
 * Never shrinks below working hours range. Adds at least 1 hour padding.
 *
 * @param activities - visible activities for the period
 * @param workingHoursStart - default grid start hour (e.g. 9)
 * @param workingHoursEnd - default grid end hour (e.g. 21)
 * @returns { start, end } in decimal hours
 */
export function calculateGridTimeRange(
  activities: GridActivity[],
  workingHoursStart: number = HOURS_START,
  workingHoursEnd: number = HOURS_END,
): GridTimeRange {
  if (activities.length === 0) {
    return { start: workingHoursStart, end: workingHoursEnd };
  }

  let earliestStart = Infinity;
  let latestEnd = -Infinity;

  for (const a of activities) {
    if (a.startTime < earliestStart) earliestStart = a.startTime;
    const endTime = a.startTime + a.duration;
    if (endTime > latestEnd) latestEnd = endTime;
  }

  // Extend start only if activity starts before working hours (at least 1 hour padding)
  // Clamp to [0, 24] — hours represent a single day (0:00–24:00)
  const adaptiveStart = earliestStart < workingHoursStart
    ? Math.max(0, Math.floor(earliestStart) - 1)
    : workingHoursStart;

  // Extend end only if activity ends after working hours (at least 1 hour padding)
  const adaptiveEnd = Math.min(24, latestEnd > workingHoursEnd
    ? Math.ceil(latestEnd) + 1
    : workingHoursEnd);

  return { start: adaptiveStart, end: adaptiveEnd };
}
