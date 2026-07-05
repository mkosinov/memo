'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// ── Inline-edit cell ──────────────────────────────────────────────────────────

export interface InlineEditCellProps {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  type?: string;
  title?: string;
  placeholder?: string;
  autoFocus?: boolean;
  'data-testid'?: string;
}

export function InlineEditCell({ value, onCommit, className = '', type = 'text', title = '', placeholder = '', autoFocus = false, 'data-testid': dataTestId }: InlineEditCellProps) {
  const [draft, setDraft] = useState(value);
  const originalRef = useRef(value);

  // Sync with prop when it changes (e.g. async visitor data loads after first render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDraft(value);
    originalRef.current = value;
  }, [value]);

  const commitIfChanged = useCallback(() => {
    if (draft !== originalRef.current) {
      onCommit(draft);
      originalRef.current = draft;
    }
  }, [draft, onCommit]);

  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitIfChanged}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(originalRef.current);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      className={`w-full rounded border px-2 py-0.5 text-sm ${className}`}
      style={{ borderColor: 'var(--line)' }}
      title={title}
      autoFocus={autoFocus}
      data-testid={dataTestId}
    />
  );
}
