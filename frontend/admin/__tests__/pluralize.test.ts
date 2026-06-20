import { describe, it, expect } from 'vitest';
import { pluraliseSeats, formatSeats } from '@/app/lib/pluralize';

describe('pluraliseSeats', () => {
  it.each([
    [1, 'место'],
    [2, 'места'],
    [3, 'места'],
    [4, 'места'],
    [5, 'мест'],
    [10, 'мест'],
    [11, 'мест'],  // 11-14 exception
    [12, 'мест'],
    [13, 'мест'],
    [14, 'мест'],
    [15, 'мест'],
    [20, 'мест'],
    [21, 'место'],
    [22, 'места'],
    [25, 'мест'],
    [100, 'мест'],
    [101, 'место'],
    [111, 'мест'],
    [121, 'место'],
  ])('pluraliseSeats(%i) === %s', (n, expected) => {
    expect(pluraliseSeats(n)).toBe(expected);
  });
});

describe('formatSeats', () => {
  it('formats 1 as "1 место"', () => {
    expect(formatSeats(1)).toBe('1 место');
  });
  it('formats 3 as "3 места"', () => {
    expect(formatSeats(3)).toBe('3 места');
  });
  it('formats 7 as "7 мест"', () => {
    expect(formatSeats(7)).toBe('7 мест');
  });
});
