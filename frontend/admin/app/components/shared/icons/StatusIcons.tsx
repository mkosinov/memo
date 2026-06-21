/**
 * Shared status icon atoms — 4 React components for VisitStatus icons.
 * SVGs copied 1-1 from Wave 5 renderStatusIcon (aa58a87).
 * All accept `className` prop; default to `w-3.5 h-3.5`.
 */

import type { VisitStatus } from '@memo/domain';

interface StatusIconProps {
  className?: string;
}

export function WaitingIcon({ className = 'w-3.5 h-3.5' }: StatusIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="icon-waiting"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function VisitedIcon({ className = 'w-3.5 h-3.5' }: StatusIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="icon-visited"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export function MissedIcon({ className = 'w-3.5 h-3.5' }: StatusIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="icon-missed"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function CancelledIcon({ className = 'w-3.5 h-3.5' }: StatusIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="icon-cancelled"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

/** Lookup: VisitStatus → icon component. Use `<IconForStatus status="waiting" />`. */
export function IconForStatus({ status, className }: { status: VisitStatus; className?: string }) {
  switch (status) {
    case 'waiting': return <WaitingIcon className={className} />;
    case 'visited': return <VisitedIcon className={className} />;
    case 'missed': return <MissedIcon className={className} />;
    case 'cancelled': return <CancelledIcon className={className} />;
  }
}
