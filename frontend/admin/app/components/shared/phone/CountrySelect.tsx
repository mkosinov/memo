'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  type PhoneCountryIso,
} from './countries';

// GH #414 (spec §Виджет PhoneField — селектор кода страны): the country
// selector of the phone module — trigger «+7 Россия ⌄» + listbox popover
// following the admin listbox pattern (StatusPicker): own popover on
// --z-popover, mouse-only, click-outside/ESC close, bound row marked.
// Shared by PhoneField (client card, staff, login) and the record-form
// typeahead prefix (PhoneInput) — one implementation, no fork. The module
// imports no admin specifics.

export interface PhoneCountrySelectProps {
  /** Bound list country; `null` — the «no country» state (the trigger keeps
   *  showing the last non-null country until a new one is picked). */
  country: PhoneCountryIso | null;
  /** Lifted on every list pick (including a re-pick of the bound country —
   *  idempotence is the owner's decision). */
  onSelect: (iso: PhoneCountryIso) => void;
  /** Inert trigger (read-only picked typeahead, disabled field). */
  disabled?: boolean;
}

/** Chevron (StatusPicker parity). */
function Chevron() {
  return (
    <svg
      className="w-3 h-3 shrink-0 opacity-60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function PhoneCountrySelect({
  country,
  onSelect,
  disabled = false,
}: PhoneCountrySelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // The trigger keeps showing the last non-null country even while the
  // binding is `null` («без страны»): the spec keeps the selector
  // unchanged — RU by default — and choosing a list country re-binds it.
  const [displayCountry, setDisplayCountry] = useState<PhoneCountryIso>(
    country ?? DEFAULT_PHONE_COUNTRY,
  );
  if (country !== null && country !== displayCountry) {
    setDisplayCountry(country);
  }

  const shown =
    PHONE_COUNTRIES.find((c) => c.iso === displayCountry) ?? PHONE_COUNTRIES[0];

  // Close on outside click / ESC (StatusPicker parity)
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = useCallback(
    (iso: PhoneCountryIso) => {
      setOpen(false);
      setDisplayCountry(iso);
      onSelect(iso);
    },
    [onSelect],
  );

  return (
    <span ref={rootRef} className="relative flex items-stretch">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-ink-mid hover:bg-[var(--surface)] transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed whitespace-nowrap"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="phone-country-select"
      >
        <span className="font-medium">+{shown.callingCode}</span>
        <span>{shown.name}</span>
        <Chevron />
      </button>

      <span
        className="self-stretch w-px my-1"
        style={{ backgroundColor: 'var(--line)' }}
        aria-hidden="true"
      />

      {open && (
        <div
          className="absolute z-[var(--z-popover)] mt-1 top-full left-0 bg-white border rounded-lg shadow-lg py-1 min-w-[176px]"
          style={{ borderColor: 'var(--line)' }}
          role="listbox"
          data-testid="phone-country-select-popover"
        >
          {PHONE_COUNTRIES.map((c) => {
            const isActive = c.iso === country;
            return (
              <button
                key={c.iso}
                type="button"
                onClick={() => handleSelect(c.iso)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--surface)] transition-colors ${
                  isActive ? 'bg-[var(--surface)] font-medium' : ''
                }`}
                role="option"
                aria-selected={isActive}
                data-testid={`phone-country-select-option-${c.iso}`}
              >
                <span className="font-medium min-w-[3rem]">+{c.callingCode}</span>
                {' '}
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
