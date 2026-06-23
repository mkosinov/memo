import type { VisitStatus } from '@memo/domain';

const VALID_STATUSES = new Set<string>(['waiting', 'visited', 'missed', 'cancelled']);

/**
 * Defensive type guard: returns the value if it's a valid VisitStatus,
 * otherwise falls back to 'waiting' (safe default).
 */
export function safeStatus(value: unknown): VisitStatus {
  if (typeof value === 'string' && VALID_STATUSES.has(value)) {
    return value as VisitStatus;
  }
  return 'waiting';
}
