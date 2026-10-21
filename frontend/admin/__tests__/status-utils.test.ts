/**
 * safeStatus (#480 §3.4) — the defensive guard's contract is preserved when
 * VALID_STATUSES derives from VisitStatusSchema.options instead of a local
 * literal list: valid statuses pass through, everything else (unknown
 * string, non-string, null/undefined) falls back to 'waiting'.
 */
import { describe, it, expect } from 'vitest';
import { safeStatus } from '../app/lib/status-utils';

describe('safeStatus', () => {
  it.each(['waiting', 'visited', 'missed', 'cancelled'] as const)(
    'passes the valid status %s through',
    (status) => {
      expect(safeStatus(status)).toBe(status);
    },
  );

  it.each(['online', '', 'WAITING', 'bogus'])(
    'falls back to waiting for the unknown string %j',
    (value) => {
      expect(safeStatus(value)).toBe('waiting');
    },
  );

  it('falls back to waiting for non-strings', () => {
    expect(safeStatus(null)).toBe('waiting');
    expect(safeStatus(undefined)).toBe('waiting');
    expect(safeStatus(42)).toBe('waiting');
    expect(safeStatus({ status: 'waiting' })).toBe('waiting');
  });
});
