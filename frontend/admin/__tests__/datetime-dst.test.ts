/**
 * shiftDateKey — DST transition edge cases (GH #242 review fix 3).
 *
 * Epoch arithmetic (N × 24h from local midnights) drifts a calendar day
 * across DST transitions: from an EDT local midnight, +7×24h lands at
 * 23:00 EST of the PREVIOUS day (the transition repeats an hour into the
 * window); from an EDT midnight before spring-forward, −7×24h lands at
 * 23:00 EST of the day BEFORE the target.
 *
 * Cases were chosen to discriminate: with epoch math they return the wrong
 * date, with calendar `setDate` math they are correct.
 *
 * TZ=America/New_York (UTC−5/−4) — pool: 'forks' applies the env var in this
 * forked process before any Date usage (datetime.test.ts pattern).
 */

// Set timezone to a DST zone BEFORE any Date usage
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import { shiftDateKey } from '@/lib/datetime';

describe('shiftDateKey across DST transitions (America/New_York)', () => {
  it('crosses the fall-back transition forward by 7 days (Oct 26 EDT → Nov 2 EST)', () => {
    // 7×24h from Oct 26 EDT midnight = Nov 2 04:00Z = Nov 1 23:00 EST —
    // epoch math would return '2026-11-01'.
    expect(shiftDateKey('2026-10-26', 7)).toBe('2026-11-02');
  });

  it('crosses the fall-back transition forward by 7 days from the week edge (Oct 31 EDT → Nov 7 EST)', () => {
    // 7×24h from Oct 31 EDT midnight = Nov 7 04:00Z = Nov 6 23:00 EST —
    // epoch math would return '2026-11-06'.
    expect(shiftDateKey('2026-10-31', 7)).toBe('2026-11-07');
  });

  it('crosses the fall-back transition backward (Nov 1 EST → Oct 25 EDT)', () => {
    expect(shiftDateKey('2026-11-01', -7)).toBe('2026-10-25');
  });

  it('crosses the spring-forward transition forward (Mar 1 EST → Mar 8 EDT)', () => {
    expect(shiftDateKey('2026-03-01', 7)).toBe('2026-03-08');
  });

  it('crosses the spring-forward transition backward by 7 days (Mar 9 EDT → Mar 2 EST)', () => {
    // 7×24h from Mar 9 EDT midnight = Mar 2 04:00Z = Mar 1 23:00 EST —
    // epoch math would return '2026-03-01'.
    expect(shiftDateKey('2026-03-09', -7)).toBe('2026-03-02');
  });

  it('crosses the spring-forward transition backward by 1 day (Mar 9 EDT → Mar 8 EDT)', () => {
    // 1×24h from Mar 9 EDT midnight = Mar 8 04:00Z = Mar 7 23:00 EST —
    // epoch math would return '2026-03-07'.
    expect(shiftDateKey('2026-03-09', -1)).toBe('2026-03-08');
  });
});
