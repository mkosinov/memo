'use client';

import React, { useRef, useCallback } from 'react';
import { AsYouType, isPossiblePhoneNumber } from 'libphonenumber-js/min';
import {
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  type PhoneCountryIso,
} from './countries';
import { PhoneCountrySelect } from './CountrySelect';
import { compact, parseStoredPhone } from './format';

// GH #414 (spec §Виджет PhoneField): composite phone field —
// `[«+7 Россия ⌄»] │ [remainder input] [×]` in a single frame. The selector
// is the shared PhoneCountrySelect (admin listbox pattern: own popover on
// --z-popover, mouse-only, click-outside/ESC close, selected row marked).
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Country pick: a list country re-binds the field keeping the typed digits
  // (spec §Виджет — country switch mid-entry); re-picking the bound country
  // changes nothing. Also the exit from the «no country» state.
  const handleSelect = useCallback(
    (iso: PhoneCountryIso) => {
      if (iso === value.country) return;
      onChange({ country: iso, national: value.national, pristine: false });
    },
    [onChange, value.country, value.national],
  );

  const visible = phoneVisible(value);

  // Honest national template of the bound country — none while unbound.
  const placeholder = value.country === null
    ? ''
    : PHONE_COUNTRIES.find((c) => c.iso === value.country)?.placeholder ?? '';

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
      if (parsed.country === value.country && parsed.national === value.national) return;
      onChange({ country: parsed.country, national: parsed.national, pristine: false });
    },
    [onChange, value.country, value.national],
  );

  return (
    <div
      className={`relative flex items-stretch rounded-lg border bg-white ${className ?? ''}`}
      style={{ borderColor: 'var(--line)' }}
      data-testid="phone-field"
    >
      <PhoneCountrySelect
        country={value.country}
        onSelect={handleSelect}
        disabled={disabled || readOnly}
      />

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
        placeholder={placeholder}
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
    </div>
  );
}
