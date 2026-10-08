'use client';

import { useCallback, useRef, useState } from 'react';
import { AsYouType } from 'libphonenumber-js/min';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';
import { PhoneCountrySelect } from '@/app/components/shared/phone/CountrySelect';
import {
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  type PhoneCountryIso,
} from '@/app/components/shared/phone/countries';
import { phoneVisible, phoneCompact } from '@/app/components/shared/phone/PhoneField';
import { parseStoredPhone, formatPhoneDisplay } from '@/app/components/shared/phone/format';

// Upstream typing gap: `getNationalNumber()` exists at runtime (this is the
// documented digits source for search queries) but is missing from the
// shipped .d.ts. Augment here — this wrapper is the isolation seam (GH #221
// decision 8), so the augmentation stays local to the phone feature.
declare module 'libphonenumber-js/min' {
  interface AsYouType {
    getNationalNumber(): string | undefined;
  }
}

// Record-form phone typeahead on the country-selector engine (GH #414, spec
// §Поиск и привязка клиента): RemoteSearchSelect keeps the typeahead role,
// `prefix` hosts the shared country selector (PhoneCountrySelect — the same
// piece PhoneField uses), formatting/threshold/`?phone=` params key off the
// SELECTED country, and the lifted value is the compact «+<код><нац.>»
// (replaces #221's visible-string WYSIWYG). Read-only after pick shows
// «Имя · телефон» (display formatter) with ×; the selector is inert there.
//
// Division of labor with RemoteSearchSelect: the committed query is DIGITS
// (formatInput); grouping is a render-time derivation (displayQuery), so a
// country switch regroups the same digits on the spot without touching the
// typeahead state. Caret is NOT managed (inherited #221 v1 limitation).

export interface PickedClient {
  id: string;
  name: string | null;
  phone: string;
}

interface RemoteSearchItem {
  id: string;
  name?: string | null;
  phone?: string | null;
  [key: string]: unknown;
}

export interface PhoneInputProps {
  /** Client-list search — receives `{ phone: <national digits>, per_page: 10 }`. */
  onSearch: (params: { phone: string; per_page: number }) => Promise<RemoteSearchItem[]>;
  /** Called when a suggestion is picked. */
  onPick: (client: PickedClient) => void;
  /** Called when the pick is cleared via ×. */
  onClear?: () => void;
  /** The consumer's pick mirror — keeps the country selector inert in the
   *  read-only state even across re-renders. */
  picked?: PickedClient | null;
  /** Lifts the COMPACT «+<код><нац. цифры>» of the typed remainder per
   *  keystroke (GH #414 storage invariant); '' when empty or in the «no
   *  country» state (compact undefined by design). A pick lifts '' — no
   *  typed number remains. */
  onInputValueChange?: (value: string) => void;
  /** Lifts whether the field holds visible digits WITHOUT a bound list
   *  country — the «без страны» paste state (GH #414 fix). The compact lift
   *  is '' there BY DESIGN (indistinguishable from an empty field), so the
   *  consumer's save-time block («Выберите страну из списка» — client-card
   *  PhoneField parity) keys off this flag instead. Fired with the same
   *  events as the compact lift. */
  onNoCountryDigits?: (blocked: boolean) => void;
  label?: string;
  /** Ignored (GH #414): the honest national template of the selected
   *  country owns the placeholder. Kept for API compatibility. */
  placeholder?: string;
}

/** Threshold counts NATIONAL digits (via getNationalNumber), never mask
 *  characters (spec decision 4). */
const MIN_DIGITS = 4;

/**
 * National digits of the committed query under the SELECTED country — the
 * value sent as `?phone=`. Digits come from `AsYouType(country).
 * getNationalNumber()` — never scraped off the display — so a typed trunk
 * `8` cannot leak into the query and break tail-of-number search (GH #221
 * G1b invariant under the #414 engine). The «no country» state falls back
 * to the raw digits.
 */
export function getNationalDigits(
  input: string,
  country: PhoneCountryIso | null,
): string {
  const digits = input.replace(/\D+/g, '');
  if (country === null) return digits;
  const asyou = new AsYouType(country);
  asyou.input(digits);
  return asyou.getNationalNumber() ?? '';
}

function optionLabel(item: RemoteSearchItem): string {
  return `${item.name || 'Без имени'} · ${formatPhoneDisplay(item.phone ?? '')}`;
}

export default function PhoneInput({
  onSearch,
  onPick,
  onClear,
  picked,
  onInputValueChange,
  onNoCountryDigits,
  label = 'Телефон',
}: PhoneInputProps) {
  // Country binding of the typed remainder — PhoneField's model: `null` is
  // the «no country» state (out-of-list paste); the selector keeps showing
  // the last list country on its own.
  const [country, setCountry] = useState<PhoneCountryIso | null>(DEFAULT_PHONE_COUNTRY);
  // Ref twin: event-time callbacks (formatInput, search gates, lifts) run
  // where the state closure may be stale — a «+»-paste binds the country in
  // the same keystroke that must already lift the NEW compact.
  const countryRef = useRef<PhoneCountryIso | null>(DEFAULT_PHONE_COUNTRY);
  const nationalRef = useRef('');
  // Internal pick mirror — freezes the selector in the read-only state even
  // before the consumer's `picked` prop round-trips.
  const [pickedId, setPickedId] = useState<string | null>(null);

  const bindCountry = useCallback((next: PhoneCountryIso | null) => {
    countryRef.current = next;
    setCountry(next);
  }, []);

  // Single lift point (GH #414 fix): the compact and the «без страны with
  // digits» flag are two projections of the SAME {country, national} pair,
  // so they must fire together on every event — a split lift would let the
  // save-block flag go stale (the compact alone cannot carry the state:
  // '' means both «empty» and «no country» by design).
  const liftState = useCallback(
    (c: PhoneCountryIso | null, national: string) => {
      // phoneCompact: '' for the «no country» state (compact undefined by
      // design) and for an empty remainder — same derivation as PhoneField.
      onInputValueChange?.(phoneCompact({ country: c, national, pristine: false }));
      onNoCountryDigits?.(c === null && national !== '');
    },
    [onInputValueChange, onNoCountryDigits],
  );

  // Country pick (mid-entry switch keeps the digits — spec §Виджет): the
  // compact changes with the calling code, so an entered number re-lifts.
  const handleCountrySelect = useCallback(
    (iso: PhoneCountryIso) => {
      if (iso === countryRef.current) return;
      bindCountry(iso);
      if (nationalRef.current) liftState(iso, nationalRef.current);
    },
    [bindCountry, liftState],
  );

  // Keystroke loop: the committed query is DIGITS; grouping happens at
  // render (displayQuery). A «+»-leading value is a paste (or fill): parse
  // it, bind the parsed list country or enter «no country», keep the digits.
  // A «+» with no digits is a manual keystroke — ignored, the selector owns
  // the country code (spec §Виджет).
  const formatInput = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.startsWith('+')) {
        const plusDigits = trimmed.replace(/\D+/g, '');
        if (!plusDigits) return nationalRef.current;
        const parsed = parseStoredPhone(trimmed);
        bindCountry(parsed.country);
        nationalRef.current = parsed.national;
        return parsed.national;
      }
      const digits = trimmed.replace(/\D+/g, '');
      nationalRef.current = digits;
      return digits;
    },
    [bindCountry],
  );

  const canSearch = useCallback(
    (input: string) => getNationalDigits(input, countryRef.current).length >= MIN_DIGITS,
    [],
  );

  const buildParams = useCallback(
    (input: string): { phone: string; per_page: number } => ({
      phone: getNationalDigits(input, countryRef.current),
      per_page: 10,
    }),
    [],
  );

  // Render-time grouping under the (possibly just-switched) country — the
  // committed digits stay untouched.
  const displayQuery = useCallback(
    (q: string) => phoneVisible({ country, national: q, pristine: false }),
    [country],
  );

  // Lift interceptor: RemoteSearchSelect hands over the committed digits,
  // the pick's display label, or '' on ×. Digits → compact; the label means
  // a pick — no typed number remains.
  const handleLift = useCallback(
    (value: string) => {
      if (/^\d*$/.test(value)) {
        nationalRef.current = value;
        liftState(countryRef.current, value);
      } else {
        nationalRef.current = '';
        onInputValueChange?.('');
        onNoCountryDigits?.(false);
      }
    },
    [liftState, onInputValueChange, onNoCountryDigits],
  );

  const handlePick = useCallback(
    (item: RemoteSearchItem) => {
      setPickedId(item.id);
      onPick({
        id: item.id,
        name: item.name ?? null,
        phone: item.phone ?? '',
      });
    },
    [onPick],
  );

  // × on the frozen field: the pick dissolves; the country selection stays
  // (the admin's context), the digits are gone with the RemoteSearchSelect
  // query reset.
  const handleChange = useCallback(
    (id: string | null) => {
      if (id === null) {
        setPickedId(null);
        onClear?.();
      }
    },
    [onClear],
  );

  const placeholder = country === null
    ? ''
    : PHONE_COUNTRIES.find((c) => c.iso === country)?.placeholder ?? '';

  return (
    <RemoteSearchSelect<{ phone: string; per_page: number }>
      onChange={handleChange}
      onSelectItem={handlePick}
      onSearch={onSearch}
      label={label}
      placeholder={placeholder}
      displayField="phone"
      canSearch={canSearch}
      buildParams={buildParams}
      formatInput={formatInput}
      displayQuery={displayQuery}
      getDisplayLabel={optionLabel}
      inputTestId="input-phone"
      onInputValueChange={handleLift}
      prefix={(
        <PhoneCountrySelect
          country={country}
          onSelect={handleCountrySelect}
          disabled={pickedId !== null || picked != null}
        />
      )}
    />
  );
}
