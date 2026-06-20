'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { VisitStatus } from '@memo/domain';

interface StatusPickerProps {
  value: VisitStatus;
  onChange: (status: VisitStatus) => void;
  /** Map from status to display label and color */
  statusConfig: Record<VisitStatus, { label: string; color: string }>;
  /** SVG path for each status (reused from ClientTab) */
  iconFor: (status: VisitStatus) => React.ReactNode;
  testIdPrefix?: string;
}

const STATUS_ORDER: VisitStatus[] = ['waiting', 'visited', 'missed', 'cancelled'];

export function StatusPicker({ value, onChange, statusConfig, iconFor, testIdPrefix = 'status-picker' }: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleSelect = useCallback((status: VisitStatus) => {
    onChange(status);
    setOpen(false);
  }, [onChange]);

  const current = statusConfig[value];

  return (
    <div className="relative" ref={containerRef} data-testid={testIdPrefix}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm bg-white hover:bg-surface"
        style={{ borderColor: 'var(--line)', color: current.color }}
        aria-label={`Статус: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`${testIdPrefix}-trigger`}
      >
        {iconFor(value)}
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 right-0 bg-white border rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ borderColor: 'var(--line)' }}
          role="listbox"
          data-testid={`${testIdPrefix}-popover`}
        >
          {STATUS_ORDER.map((status) => {
            const cfg = statusConfig[status];
            const isActive = status === value;
            return (
              <button
                key={status}
                type="button"
                onClick={() => handleSelect(status)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-surface ${isActive ? 'bg-surface' : ''}`}
                style={{ color: cfg.color }}
                role="option"
                aria-selected={isActive}
                data-testid={`${testIdPrefix}-option-${status}`}
              >
                {iconFor(status)}
                <span>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
