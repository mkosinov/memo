'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AsYouType, isPossiblePhoneNumber } from 'libphonenumber-js/min';
import {
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  type PhoneCountryIso,
} from './countries';
import { compact, parseStoredPhone } from './format';

// GH #414 (spec §Виджет PhoneField): composite phone field —
// `[«+7 Россия ⌄»] │ [remainder input] [×]` in a single frame. The selector
// follows the admin listbox pattern (StatusPicker): own popover on
// --z-popover, mouse-only, click-outside/ESC close, selected row marked.
// Controlled value { country, national, pristine }; derived visible/compact/
// isComplete live beside the component as pure functions.
//
// The module imports no admin specifics (React, libphonenumber-js/min,
// design variables only) — a candidate for reuse by web later.

/** Controlled state of the field (spec §Виджет PhoneField). */
export interface PhoneFieldValue {
  /** ISO of the bound list country; `null` — the «no country» state. */
  country: PhoneCountryIso | null;
  /** National remainder — digits only, no grouping. */
  national: string;
  /** `true` until the user modifies the number (untouched saves verbatim). */
  pristine: boolean;
}

/** Grouped remainder as shown in the input (`AsYouType(страна)`); raw digits
 *  while unbound — no country, no honest national template. */
export function phoneVisible(value: PhoneFieldValue): string {
  if (!value.national) return '';
  if (value.country === null) return value.national;
  const asyou = new AsYouType(value.country);
  return asyou.input(value.national) || value.national;
}

/** Compact storage form «+79996531803»; '' when unbound or empty (compact is
 *  undefined for the «no country» state by design). */
export function phoneCompact(value: PhoneFieldValue): string {
  if (value.country === null) return '';
  return compact(value.country, value.national);
}

/** Completeness — the one fullness validator: bound country and
 *  `isPossiblePhoneNumber` (length/fullness for the country). */
export function phoneIsComplete(value: PhoneFieldValue): boolean {
  return value.country !== null && isPossiblePhoneNumber(value.national, value.country);
}

export interface PhoneFieldProps {
  /** Controlled value `{ country, national, pristine }`. */
  value: PhoneFieldValue;
  /** Lifted on every user edit (digits typed/pasted, country picked, ×). */
  onChange: (value: PhoneFieldValue) => void;
  /** Standard input props forwarded to the remainder input (Tasks 4/6/7/8). */
  id?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  /** Extra classes for the outer frame. */
  className?: string;
  /** Test anchor of the remainder input (E2E/typeahead wiring). */
  inputTestId?: string;
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

export function PhoneField({
  value,
  onChange,
  id,
  name,
  autoComplete,
  required,
  disabled = false,
  readOnly = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  onFocus,
  onBlur,
  className,
  inputTestId = 'phone-input',
}: PhoneFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The selector BUTTON keeps showing the last non-null country even while
  // the binding is `null` («без страны»): the spec keeps the selector
  // unchanged — RU by default — and choosing a list country re-binds it.
  const [displayCountry, setDisplayCountry] = useState<PhoneCountryIso>(
    value.country ?? DEFAULT_PHONE_COUNTRY,
  );
  if (value.country !== null && value.country !== displayCountry) {
    setDisplayCountry(value.country);
  }

  const shown = PHONE_COUNTRIES.find((c) => c.iso === displayCountry) ?? PHONE_COUNTRIES[0];

  // Close on outside click / ESC (StatusPicker parity)
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
      // Re-picking the bound country changes nothing (also exits «без страны»
      // only when the binding actually differs).
      if (iso === value.country) return;
      // Country switch mid-entry keeps the typed digits (spec §Виджет).
      onChange({ country: iso, national: value.national, pristine: false });
    },
    [onChange, value.country, value.national],
  );

  const visible = phoneVisible(value);

  // Keystroke loop: non-digits are ignored (a typed «+» is never entered —
  // the selector owns the country code). When the digits did not change the
  // controlled value cannot re-render, so the display is reset imperatively
  // to strip the rejected noise.
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = e.target.value.replace(/\D+/g, '');
      if (digits === value.national) {
        if (inputRef.current) inputRef.current.value = visible;
        return;
      }
      onChange({ ...value, national: digits, pristine: false });
    },
    [onChange, value, visible],
  );

  // × — clears the remainder, returns to RU and lifts the «no country»
  // state (spec §Виджет). An already fresh field lifts nothing.
  const handleClear = useCallback(() => {
    setDisplayCountry(DEFAULT_PHONE_COUNTRY);
    if (value.country === DEFAULT_PHONE_COUNTRY && value.national === '') return;
    onChange({ country: DEFAULT_PHONE_COUNTRY, national: '', pristine: false });
  }, [onChange, value.country, value.national]);

  // «+»-leading PASTE parses as an international number (a typed «+» is
  // rejected above): a list country re-binds the selector, anything else
  // (out-of-list country, unparseable) enters the «no country» state with
  // the pasted digits as the remainder and the selector unchanged.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text');
      if (!text.trim().startsWith('+')) return; // ordinary paste → change path
      e.preventDefault();
      const parsed = parseStoredPhone(text);
      if (parsed.country !== null) setDisplayCountry(parsed.country);
      if (parsed.country === value.country && parsed.national === value.national) return;
      onChange({ country: parsed.country, national: parsed.national, pristine: false });
    },
    [onChange, value.country, value.national],
  );

  return (
    <div
      ref={containerRef}
      className={`relative flex items-stretch rounded-lg border bg-white ${className ?? ''}`}
      style={{ borderColor: 'var(--line)' }}
      data-testid="phone-field"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || readOnly}
        className="flex items-center gap-1.5 rounded-l-lg px-2 py-1.5 text-sm text-ink-mid bg-white hover:bg-[var(--surface)] transition-colors disabled:opacity-50 disabled:hover:bg-white whitespace-nowrap"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="phone-country-select"
      >
        <span className="font-medium">+{shown.callingCode}</span>
        <span>{shown.name}</span>
        <Chevron />
      </button>

      <div className="self-stretch w-px my-1" style={{ backgroundColor: 'var(--line)' }} aria-hidden="true" />

      <input
        ref={inputRef}
        id={id}
        name={name}
        type="tel"
        dir="ltr"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        onFocus={onFocus}
        onBlur={onBlur}
        value={visible}
        onChange={handleInputChange}
        onPaste={handlePaste}
        placeholder={value.country === null ? '' : shown.placeholder}
        className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-transparent outline-none rounded-r-lg disabled:opacity-50"
        data-testid={inputTestId}
      />

      <button
        type="button"
        onClick={handleClear}
        disabled={disabled || readOnly}
        aria-label="clear"
        data-testid="phone-clear"
        className="flex items-center px-2 text-ink-mid hover:text-ink transition-colors disabled:opacity-50"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-[var(--z-popover)] mt-1 top-full left-0 bg-white border rounded-lg shadow-lg py-1 min-w-[176px]"
          style={{ borderColor: 'var(--line)' }}
          role="listbox"
          data-testid="phone-country-select-popover"
        >
          {PHONE_COUNTRIES.map((c) => {
            const isActive = c.iso === value.country;
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
    </div>
  );
}
