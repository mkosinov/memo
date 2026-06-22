'use client';

import React, { useState, useRef, useEffect } from 'react';
import { VISIT_STATUS_CONFIG, VISIT_STATUS_ORDER } from './config/VISIT_STATUS_CONFIG';
import { WaitingIcon, VisitedIcon, MissedIcon, CancelledIcon } from './icons/StatusIcons';
import type { VisitStatus } from '@memo/domain';

const ICONS: Record<VisitStatus, React.ComponentType<{ className?: string }>> = {
  waiting: WaitingIcon,
  visited: VisitedIcon,
  cancelled: CancelledIcon,
  missed: MissedIcon,
};

export interface StatusFiltersPickerProps {
  /** Current filter value. `null` = "Все статусы" (no filter). */
  value: VisitStatus | null;
  onChange: (value: VisitStatus | null) => void;
  size?: 'sm' | 'md';
  testIdPrefix?: string;
}

/**
 * Wrapper for filter contexts that need a "Все статусы" (all statuses) option.
 * Adds a null-valued "all" option above the 4 status options.
 * In closed state: shows "Все статусы" when value is null, otherwise the selected status.
 */
export function StatusFiltersPicker({
  value,
  onChange,
  size = 'md',
  testIdPrefix = 'status-filter',
}: StatusFiltersPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const iconSizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const buttonPadding = size === 'sm' ? 'px-2 py-1' : 'px-3 py-2';
  const isAll = value === null;
  const current = isAll ? null : VISIT_STATUS_CONFIG[value];
  const CurrentIcon = isAll ? null : ICONS[value!];

  return (
    <div className={`relative inline-block`} ref={containerRef} data-testid={testIdPrefix}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 ${buttonPadding} rounded-lg border text-sm bg-white hover:bg-[var(--surface)] transition-colors`}
        style={{ borderColor: 'var(--line)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`${testIdPrefix}-trigger`}
      >
        {isAll ? (
          <span className="text-ink-mid">Все статусы</span>
        ) : (
          CurrentIcon && (
            <>
              <CurrentIcon className={iconSizeClass} />
              <span>{current!.label}</span>
            </>
          )
        )}
        <svg className="w-3 h-3 shrink-0 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 right-0 bg-white border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ borderColor: 'var(--line)' }}
          role="listbox"
          data-testid={`${testIdPrefix}-popover`}
        >
          {/* "All" option */}
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--surface)] transition-colors ${isAll ? 'bg-[var(--surface)] font-medium' : ''}`}
            role="option"
            aria-selected={isAll}
            data-testid={`${testIdPrefix}-option-all`}
          >
            <span className="text-ink-mid">Все статусы</span>
          </button>

          {/* Status options */}
          {VISIT_STATUS_ORDER.map((status) => {
            const cfg = VISIT_STATUS_CONFIG[status];
            const Icon = ICONS[status];
            const isActive = status === value;
            return (
              <button
                key={status}
                type="button"
                onClick={() => { onChange(status); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--surface)] transition-colors ${isActive ? 'bg-[var(--surface)] font-medium' : ''}`}
                role="option"
                aria-selected={isActive}
                data-testid={`${testIdPrefix}-option-${status}`}
              >
                <Icon className={iconSizeClass} />
                <span>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
