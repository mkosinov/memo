const MONTHS_GENITIVE: Record<number, string> = {
  0: 'января',
  1: 'февраля',
  2: 'марта',
  3: 'апреля',
  4: 'мая',
  5: 'июня',
  6: 'июля',
  7: 'августа',
  8: 'сентября',
  9: 'октября',
  10: 'ноября',
  11: 'декабря',
};

export function formatPrice(min: number, max?: number): string {
  const formatted = (n: number) => n.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  if (max !== undefined && max !== min) {
    return `${formatted(min)} – ${formatted(max)} ₽`;
  }
  return `${formatted(min)} ₽`;
}

export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const day = date.getDate();
  const month = MONTHS_GENITIVE[date.getMonth()];
  return `${day} ${month}`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} мин`;
  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
}
