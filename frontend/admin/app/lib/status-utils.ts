import { VisitStatusSchema } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';

// #480 §3.4: the value domain derives from the contract schema (declaration
// order); the explicit Set<string> keeps accepting untrusted strings.
const VALID_STATUSES = new Set<string>(VisitStatusSchema.options);

/** Type predicate over the contract's VisitStatus union (#480 §3.4). */
function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

/**
 * Defensive type guard: returns the value if it's a valid VisitStatus,
 * otherwise falls back to 'waiting' (safe default).
 */
export function safeStatus(value: unknown): VisitStatus {
  return isVisitStatus(value) ? value : 'waiting';
}
