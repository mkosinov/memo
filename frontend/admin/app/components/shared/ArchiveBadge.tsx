export type ArchivePart = 'мастер' | 'локация' | 'услуга';

export interface ArchiveBadgeProps {
  /** Which related entities are archived, in display order. */
  parts: Array<ArchivePart>;
  className?: string;
}

/**
 * Pill badge marking cards whose master/service/location is archived (GH #267).
 * Sizing matches StatusBadge; neutral muted palette to read as "inactive".
 */
export function ArchiveBadge({ parts, className = '' }: ArchiveBadgeProps) {
  const label = `Архив: ${parts.join(', ')}`;
  return (
    <span
      data-testid="archived-badge"
      aria-label={label}
      title={label}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-stone-200 text-stone-600 border border-stone-300 ${className}`}
    >
      Архив
    </span>
  );
}
