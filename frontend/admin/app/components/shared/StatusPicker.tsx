'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VISIT_STATUS_CONFIG, VISIT_STATUS_ORDER } from './config/VISIT_STATUS_CONFIG';
import type { VisitStatus } from '@memo/domain';

export interface StatusPickerProps {
  value: VisitStatus | '';
  onChange: (status: VisitStatus) => void;
  /** 'icon' = icon-only button (default, for inline edit).
   *  'icon-with-label' = icon + colored label + chevron (for filters/view-mode). */
  variant?: 'icon' | 'icon-with-label';
  /** 'sm' = 24-32px button (for table rows).
   *  'md' = 32-40px button (for summary, filters). */
  size?: 'sm' | 'md';
  /** Placeholder text shown when value is empty string (for filter use cases). */
  placeholder?: string;
  className?: string;
  testIdPrefix?: string;
}

const ICONS: Record<VisitStatus, React.ComponentType<{ className?: string }>> = {
  waiting: VISIT_STATUS_CONFIG.waiting.Icon,
  visited: VISIT_STATUS_CONFIG.visited.Icon,
  cancelled: VISIT_STATUS_CONFIG.cancelled.Icon,
  missed: VISIT_STATUS_CONFIG.missed.Icon,
};

export function StatusPicker({
  value,
  onChange,
  variant = 'icon',
  size = 'sm',
  placeholder,
  className,
  testIdPrefix = 'status-picker',
}: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPlaceholder = placeholder !== undefined && value === '';
  const current = isPlaceholder ? null : (VISIT_STATUS_CONFIG[value as VisitStatus] ?? null);
  const CurrentIcon = isPlaceholder ? null : (ICONS[value as VisitStatus] ?? null);

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

  const handleSelect = useCallback((status: VisitStatus) => {
    onChange(status);
    setOpen(false);
  }, [onChange]);

  const iconSizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  // Button sizing
  const buttonPadding = variant === 'icon'
    ? (size === 'sm' ? 'w-7 h-7' : 'w-9 h-9')
    : (size === 'sm' ? 'px-2 py-1' : 'px-3 py-2');
  const buttonGap = variant === 'icon' ? '' : 'gap-1.5';
  const buttonJustify = variant === 'icon' ? 'items-center justify-center' : 'items-center';

  return (
    <div className={`relative inline-block ${className ?? ''}`} ref={containerRef} data-testid={testIdPrefix}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex ${buttonGap} ${buttonPadding} rounded-lg border text-sm bg-white hover:bg-[var(--surface)] transition-colors ${buttonJustify}`}
        style={{ borderColor: 'var(--line)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`${testIdPrefix}-trigger`}
      >
        {isPlaceholder ? (
          <span className="text-ink-mid">{placeholder}</span>
        ) : CurrentIcon && (
          <CurrentIcon className={iconSizeClass} />
        )}
        {(variant === 'icon-with-label' || isPlaceholder) && (
          <>
            {!isPlaceholder && current && (
              <span style={{ color: current.color }}>{current.label}</span>
            )}
            <svg className="w-3 h-3 shrink-0 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 right-0 bg-white border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ borderColor: 'var(--line)' }}
          role="listbox"
          data-testid={`${testIdPrefix}-popover`}
        >
          {VISIT_STATUS_ORDER.map((status) => {
            const cfg = VISIT_STATUS_CONFIG[status];
            const Icon = ICONS[status];
            const isActive = status === value;
            return (
              <button
                key={status}
                type="button"
                onClick={() => handleSelect(status)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--surface)] transition-colors ${isActive ? 'bg-[var(--surface)] font-medium' : ''}`}
                role="option"
                aria-selected={isActive}
                data-testid={`${testIdPrefix}-option-${status}`}
              >
                <Icon className={iconSizeClass} />
                <span style={{ color: cfg.color }}>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
