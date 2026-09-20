/**
 * Single source for age group boundaries (GH #284).
 *
 * The «Дети» range (3–11) is defined ONCE here. Both the AgeSelect option
 * lists («Дети» / «Подростки») and the default-tariff classifier
 * (resolveDefaultTariff) derive from these constants, so the UI split and
 * the resolver can never drift apart.
 *
 * The «Взрослый» sentinel is the STRING 'adult' (AgeSelect option value) —
 * it is deliberately not a number and must never be mixed with ages 3–17.
 */

/** Inclusive lower bound of the «Дети» age group. */
export const KIDS_AGE_MIN = 3;

/** Inclusive upper bound of the «Дети» age group (12+ = «Подростки»). */
export const KIDS_AGE_MAX = 11;

/** AgeSelect sentinel for «Взрослый» — a string, not an age. */
export const ADULT_AGE_SENTINEL = 'adult';

/** All ages of the «Дети» group, ascending: 3..11. */
export const KIDS_AGES: number[] = range(KIDS_AGE_MIN, KIDS_AGE_MAX);

/** All ages of the «Подростки» group, ascending: 12..17. */
export const TEEN_AGES: number[] = range(KIDS_AGE_MAX + 1, 17);

/** True when `age` falls inside the «Дети» range (3–11 inclusive). */
export function isKidsAge(age: number): boolean {
  return age >= KIDS_AGE_MIN && age <= KIDS_AGE_MAX;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
