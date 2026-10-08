import { describe, it, expect } from 'vitest';
import { toNationalDigits, compact, parseStoredPhone, formatPhoneDisplay } from '../format';
import { PHONE_COUNTRIES } from '../countries';

// GH #414 Task 1: the single TS home of the national-digit reduction
// (spec §Единая редукция цифр), moved verbatim from hooks/useRecordMutations.ts
// (#221 spec §3, mirror of backend/src/domain/phone_digits.py).
// Reduction cases moved from __tests__/useRecordMutations.test.ts and extended
// with the #414 list: «+7…», «8…», «999…», «+375…», «+1…», 11-digit with
// leading 7/8 and without, RU/KZ shared +7 — one key.

describe('toNationalDigits (spec §Единая редукция цифр)', () => {
  it('strips non-digits from a formatted string', () => {
    expect(toNationalDigits('+7 (999) 123-45-67')).toBe('9991234567');
  });

  it('drops the leading 7/8 of an 11-digit RU number', () => {
    expect(toNationalDigits('89991234567')).toBe('9991234567');
    expect(toNationalDigits('79991234567')).toBe('9991234567');
    expect(toNationalDigits('+7 999 123 45 67')).toBe('9991234567');
  });

  it('keeps 10-digit strings as-is', () => {
    expect(toNationalDigits('9991234567')).toBe('9991234567');
  });

  it('does NOT drop leading 7/8 of a shorter-than-11 digit string', () => {
    // 7 digits starting with 8 — not an 11-digit RU number, keep as-is
    expect(toNationalDigits('8123456')).toBe('8123456');
  });

  it('keeps 11-digit strings NOT starting with 7/8 intact (non-RU keys never lose digits)', () => {
    // «+375…» — Belarus: the 11-digit drop applies only to a leading 7/8
    expect(toNationalDigits('+375291234567')).toBe('375291234567');
    expect(toNationalDigits('37529123456')).toBe('37529123456');
    // «+1…» — 11 digits with leading 1: kept
    expect(toNationalDigits('+15551234567')).toBe('15551234567');
  });

  it('RU and KZ share +7 — one reduction key (spec §Единая редукция цифр)', () => {
    expect(toNationalDigits('+77011234567')).toBe('7011234567');
    expect(toNationalDigits('87011234567')).toBe('7011234567');
    expect(toNationalDigits('+7 701 123 4567')).toBe(toNationalDigits('87011234567'));
  });

  it('tolerates NULL/empty/no-digits → empty string', () => {
    expect(toNationalDigits(null)).toBe('');
    expect(toNationalDigits(undefined)).toBe('');
    expect(toNationalDigits('')).toBe('');
    expect(toNationalDigits('—')).toBe('');
  });
});

describe('compact (spec §Форматирование — «+<код><нац. цифры>»)', () => {
  it('joins the calling code and national digits of a list country', () => {
    expect(compact('RU', '9991234567')).toBe('+79991234567');
    expect(compact('BY', '291234567')).toBe('+375291234567');
  });

  it('KZ compact carries the shared +7 code (distinct from RU by national digits only)', () => {
    expect(compact('KZ', '7011234567')).toBe('+77011234567');
  });

  it('builds a well-formed compact for every country of the dictionary', () => {
    for (const c of PHONE_COUNTRIES) {
      expect(compact(c.iso, '12345')).toBe(`+${c.callingCode}12345`);
    }
  });

  it('strips non-digit noise from the national remainder (defensive)', () => {
    expect(compact('RU', '999 653-18-03')).toBe('+79996531803');
  });

  it('empty remainder → empty string (compact is undefined until digits exist)', () => {
    expect(compact('RU', '')).toBe('');
    expect(compact('RU', null as unknown as string)).toBe('');
  });
});

// Spec §Инициализация существующих значений: a stored string initializes the
// widget state — a list-country parse selects that country with the national
// remainder; anything else (garbage, out-of-list «+1 …») is the «no country»
// state with digits-only remainder.
describe('parseStoredPhone (spec §Инициализация существующих значений)', () => {
  it('compact storage form → its list country + national digits', () => {
    expect(parseStoredPhone('+79996531803')).toEqual({ country: 'RU', national: '9996531803' });
    expect(parseStoredPhone('+375291234567')).toEqual({ country: 'BY', national: '291234567' });
    expect(parseStoredPhone('+37123123456')).toEqual({ country: 'LV', national: '23123456' });
  });

  it('legacy «+7 …» spaced/hyphenated writing → RU + national digits', () => {
    expect(parseStoredPhone('+7 999 653-18-03')).toEqual({ country: 'RU', national: '9996531803' });
  });

  it('legacy «8 …» trunk-prefixed writing → RU + national digits', () => {
    expect(parseStoredPhone('8 999 653-18-03')).toEqual({ country: 'RU', national: '9996531803' });
    expect(parseStoredPhone('89991234567')).toEqual({ country: 'RU', national: '9991234567' });
  });

  it('bare national digits default to RU (legacy free-typed entries)', () => {
    expect(parseStoredPhone('9996531803')).toEqual({ country: 'RU', national: '9996531803' });
  });

  it('out-of-list country («+1 …») → «no country», digits-only remainder', () => {
    expect(parseStoredPhone('+1 555 123 4567')).toEqual({ country: null, national: '15551234567' });
  });

  it('non-numeric garbage → «no country», empty remainder', () => {
    expect(parseStoredPhone('спам')).toEqual({ country: null, national: '' });
    expect(parseStoredPhone('—')).toEqual({ country: null, national: '' });
  });

  it('empty / NULL → the default widget state (RU, empty remainder)', () => {
    expect(parseStoredPhone('')).toEqual({ country: 'RU', national: '' });
    expect(parseStoredPhone(null)).toEqual({ country: 'RU', national: '' });
    expect(parseStoredPhone(undefined)).toEqual({ country: 'RU', national: '' });
  });
});

// Spec §Форматирование, показ: the single display formatter — parse, then
// international grouping via libphonenumber-js; unparseable values pass
// through verbatim (garbage tolerance for legacy rows); empty → empty.
describe('formatPhoneDisplay (spec §Форматирование, показ)', () => {
  it('compact storage form → international grouping', () => {
    expect(formatPhoneDisplay('+79996531803')).toBe('+7 999 653 18 03');
    expect(formatPhoneDisplay('+375291234567')).toBe('+375 29 123 45 67');
  });

  it('legacy writings group the same as compacts', () => {
    expect(formatPhoneDisplay('+7 999 653-18-03')).toBe('+7 999 653 18 03');
    expect(formatPhoneDisplay('8 999 653-18-03')).toBe('+7 999 653 18 03');
    expect(formatPhoneDisplay('9996531803')).toBe('+7 999 653 18 03');
  });

  it('formats out-of-list but parseable numbers too (display is not list-bound)', () => {
    expect(formatPhoneDisplay('+1 555 123 4567')).toBe('+1 555 123 4567');
    expect(formatPhoneDisplay('+15551234567')).toBe('+1 555 123 4567');
  });

  it('unparseable / incomplete garbage → verbatim (tolerance to legacy rows)', () => {
    expect(formatPhoneDisplay('спам')).toBe('спам');
    expect(formatPhoneDisplay('12345')).toBe('12345');
    expect(formatPhoneDisplay('999')).toBe('999');
    expect(formatPhoneDisplay('—')).toBe('—');
  });

  it('empty / NULL → empty string', () => {
    expect(formatPhoneDisplay('')).toBe('');
    expect(formatPhoneDisplay(null)).toBe('');
    expect(formatPhoneDisplay(undefined)).toBe('');
  });
});
