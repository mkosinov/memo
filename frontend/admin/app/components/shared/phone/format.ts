// GH #414 (spec §Единая редукция цифр — rev3): single TS home of the phone
// digit domain shared by every admin phone entry point. The module imports
// nothing admin-specific (only libphonenumber-js/min) — a candidate for
// reuse by web later.

import { parsePhoneNumber } from 'libphonenumber-js/min';
import { PHONE_COUNTRIES, DEFAULT_PHONE_COUNTRY, type PhoneCountryIso } from './countries';

/** Digits-only view of a string — the shared noise-stripping primitive. */
function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * Spec #221 §3 / #414 §Единая редукция цифр — national-digit phone
 * reduction, TS mirror of the backend's `to_national_digits`
 * (backend/src/domain/phone_digits.py): strip non-digits; drop the leading
 * 7/8 of an 11-digit RU number. Tolerant by design — never parses, never
 * raises; NULL/empty/no-digits → empty string. Every "same client?" or
 * login-account comparison applies BOTH sides through this reduction
 * (`+79991234567`, `8 999 123-45-67`, `9991234567` — one key), so any
 * stored format matches the typed one. Non-RU codes («+375…», «+1…») never
 * lose digits: the 11-digit drop fires only on a leading 7/8. RU and KZ
 * share +7 — one key by design.
 */
export function toNationalDigits(value: string | null | undefined): string {
  if (!value) return '';
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Spec §Форматирование, хранение: the compact storage form of a CHANGED
 * number — «+<код вызова><национальные цифры>» (e.g. `+79996531803`). Only
 * defined for countries of the curated list; the «no country» state has no
 * compact by design. An empty remainder yields '' — compact exists only
 * once digits do. Non-digit noise in the remainder is stripped defensively.
 */
export function compact(country: PhoneCountryIso, national: string): string {
  const digits = digitsOnly(national ?? '');
  const entry = PHONE_COUNTRIES.find((c) => c.iso === country);
  if (!digits || !entry) return '';
  return `+${entry.callingCode}${digits}`;
}

/** ISO set of the curated list — the membership check for parsed countries. */
const LIST_ISOS = new Set<string>(PHONE_COUNTRIES.map((c) => c.iso));

/** Widget state produced by {@link parseStoredPhone}. */
export interface StoredPhone {
  /** ISO of the matched list country, or `null` for the «no country» state. */
  country: PhoneCountryIso | null;
  /** National remainder — always digits-only. */
  national: string;
}

/**
 * Spec §Инициализация существующих значений: parse a STORED phone string
 * into the widget state. A string that parses as a number of a list country
 * selects that country with the national digits as the remainder (compact,
 * legacy «+7 …»/«8 …», bare digits default to RU). Anything else — out-of-
 * list countries («+1 …»), garbage — is the «no country» state with the
 * string's digits as the remainder. Empty/NULL gives the default state
 * (RU, empty) — a field with no stored number starts on the RU selector.
 * The `pristine` flag (untouched values save verbatim) is widget state,
 * derived by the consumer — not parsed here.
 */
export function parseStoredPhone(value: string | null | undefined): StoredPhone {
  if (!value || !value.trim()) {
    return { country: DEFAULT_PHONE_COUNTRY, national: '' };
  }
  try {
    const parsed = parsePhoneNumber(value, DEFAULT_PHONE_COUNTRY);
    if (parsed?.country && LIST_ISOS.has(parsed.country)) {
      return {
        country: parsed.country as PhoneCountryIso,
        national: parsed.nationalNumber,
      };
    }
  } catch {
    // Not a number (e.g. «спам», «—») — fall through to «no country».
  }
  return { country: null, national: digitsOnly(value) };
}

/**
 * Spec §Форматирование, показ: the single display formatter for every place
 * a stored phone is shown (clients table, RecordHeader, ClientLabelById,
 * client card, ClientQuickCard). Parse (`parsePhoneNumber`, RU default),
 * then international grouping via `formatInternational()`; a value that
 * does not parse into a POSSIBLE number passes through verbatim (tolerance
 * to legacy garbage rows); empty/NULL → empty. Not restricted to the
 * curated list — any parseable number (e.g. «+1 …») groups for display.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const parsed = parsePhoneNumber(value, DEFAULT_PHONE_COUNTRY);
    if (parsed && parsed.isPossible()) {
      return parsed.formatInternational();
    }
  } catch {
    // Not a number — show the stored string as is.
  }
  return value;
}
