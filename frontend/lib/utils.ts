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

/** Mix an RGB colour with white. ratio=0 → white, ratio=1 → original. */
export function mixWithWhite(
  rgb: { r: number; g: number; b: number },
  ratio: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * (1 - ratio)),
    g: Math.round(rgb.g + (255 - rgb.g) * (1 - ratio)),
    b: Math.round(rgb.b + (255 - rgb.b) * (1 - ratio)),
  };
}

/**
 * Calculate fill opacity for event card background.
 * Empty → 0.85, Full → 0.30.
 * Formula: 0.85 - pct * 0.55
 */
export function getFillOpacity(occupied: number, capacity: number): number {
  const pct = Math.min(occupied / capacity, 1);
  return 0.85 - pct * 0.55;
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

/** Format date as "13 мая" (day + genitive month). */
export function formatDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}
