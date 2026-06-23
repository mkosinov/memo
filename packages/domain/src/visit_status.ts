/**
 * Single source of truth for record/visit status.
 * @see docs/domain-rules/records.md (commit c0c4a8d)
 */
export type VisitStatus = 'waiting' | 'visited' | 'missed' | 'cancelled';

export interface VisitItem {
  id: string;
  status: VisitStatus;
}

/**
 * Derives record status from its visits.
 * Priority: any visited > all missed > all cancelled > waiting
 * Edge case: 0 visits → 'waiting'
 */
export function computeRecordStatus(visits: VisitItem[]): VisitStatus {
  if (visits.length === 0) return 'waiting';
  if (visits.some((v) => v.status === 'visited')) return 'visited';
  if (visits.every((v) => v.status === 'missed')) return 'missed';
  if (visits.every((v) => v.status === 'cancelled')) return 'cancelled';
  return 'waiting';
}
