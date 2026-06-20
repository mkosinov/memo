import type { VisitStatus } from '@memo/domain';
import { VISIT_STATUS_CONFIG } from './config/VISIT_STATUS_CONFIG';

export interface StatusBadgeProps {
  status: VisitStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = VISIT_STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.bgClass} ${config.textClass} ${className}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
