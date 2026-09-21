import { describe, it, expect } from 'vitest';
import {
  KIDS_AGE_MIN,
  KIDS_AGE_MAX,
  KIDS_AGES,
  TEEN_AGES,
  ADULT_AGE_SENTINEL,
  isKidsAge,
} from '@/lib/age-groups';

describe('age-groups (GH #284 single source)', () => {
  it('defines the «Дети» range as 3–11 inclusive', () => {
    expect(KIDS_AGE_MIN).toBe(3);
    expect(KIDS_AGE_MAX).toBe(11);
  });

  it('builds the AgeSelect «Дети» option list 3..11 from the bounds', () => {
    expect(KIDS_AGES).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('builds the AgeSelect «Подростки» option list 12..17, adjacent to «Дети»', () => {
    expect(TEEN_AGES).toEqual([12, 13, 14, 15, 16, 17]);
    expect(TEEN_AGES[0]).toBe(KIDS_AGE_MAX + 1);
  });

  it('keeps the «Взрослый» sentinel a string, distinct from any age', () => {
    expect(ADULT_AGE_SENTINEL).toBe('adult');
    expect(typeof ADULT_AGE_SENTINEL).toBe('string');
    expect(KIDS_AGES).not.toContain(ADULT_AGE_SENTINEL as never);
  });

  it.each([
    [3, true],
    [7, true],
    [11, true],
    [2, false],
    [12, false],
    [17, false],
  ])('isKidsAge(%i) → %s', (age, expected) => {
    expect(isKidsAge(age as number)).toBe(expected as boolean);
  });
});
