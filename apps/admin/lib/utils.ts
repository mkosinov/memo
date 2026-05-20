// ─── Constants ────────────────────────────────────────────────────────────

export const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const;

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
export const CELL_HEIGHT = 60;
export const SLOT_COUNT = (HOURS_END - HOURS_START) * 2;
export const TIME_COL_WIDTH = 64;

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

// ─── Time / Date Utilities ────────────────────────────────────────────────

/** Format hours to "HH:MM" string. 10 → "10:00", 10.5 → "10:30". */
export function formatTime(hours: number): string {
  const h = Math.floor(hours);
  const m = hours % 1 >= 0.5 ? '30' : '00';
  return `${h.toString().padStart(2, '0')}:${m}`;
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

/** Get the Monday of the week containing the given date, as ISO string (YYYY-MM-DD). */
export function getMondayStr(date: Date): string {
  return getMonday(date).toISOString().split('T')[0];
}

/** Format date as "13 мая" (day + genitive month). */
export function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}

/** Check if two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Add/subtract days from a date. Input can be Date or ISO string. Returns ISO string. */
export function addDays(date: Date | string, days: number): string {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Add minutes to a time string ("HH:MM"), returns "HH:MM". */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/** Generate half-hour time slots from HOURS_START to HOURS_END (exclusive). */
export function generateTimeSlots(): number[] {
  const slots: number[] = [];
  for (let h = HOURS_START; h < HOURS_END; h++) {
    slots.push(h, h + 0.5);
  }
  return slots;
}
