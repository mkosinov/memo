/**
 * Russian pluralisation for "место" (seat).
 * Rules:
 *   1, 21, 31, ... → "место"  (last digit 1, except 11)
 *   2-4, 22-24, ... → "места"  (last digit 2-4, except 12-14)
 *   0, 5-20, 25-30, ... → "мест"
 */
export function pluraliseSeats(n: number): string {
  const abs = Math.abs(n) | 0;
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'мест';
  const last = abs % 10;
  if (last === 1) return 'место';
  if (last >= 2 && last <= 4) return 'места';
  return 'мест';
}

/** Returns "N мест/места/место" formatted string. */
export function formatSeats(n: number): string {
  return `${n} ${pluraliseSeats(n)}`;
}
