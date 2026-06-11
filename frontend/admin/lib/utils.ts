// ─── Display Utilities ────────────────────────────────────────────────────

/** Format master name as "Фамилия Имя" (Last Name + First Name). */
export function displayMasterName(master: { first_name: string; last_name: string }): string {
  return `${master.last_name} ${master.first_name}`;
}

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
export const CELL_HEIGHT_MIN = 40;
export const CELL_HEIGHT_MAX = 120;
export const CELL_HEIGHT_STEP = 10;
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

/** Generate half-hour time slots from HOURS_START to HOURS_END (exclusive). */
export function generateTimeSlots(): number[] {
  const slots: number[] = [];
  for (let h = HOURS_START; h < HOURS_END; h++) {
    slots.push(h, h + 0.5);
  }
  return slots;
}
