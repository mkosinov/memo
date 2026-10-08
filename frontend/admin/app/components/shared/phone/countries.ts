// GH #414 (spec §Список стран): curated v1 country dictionary for the admin
// phone module. Order: RU first (default country), the rest Russian-
// alphabetical. Russia and Kazakhstan share the +7 calling code — the ISO
// code is the dictionary key, the calling code never is. Extending the list
// is a one-array edit (libphonenumber-js formats/validates any country by
// its ISO code; no migration needed).
//
// Placeholders are honest national-format templates for the remainder input,
// derived from libphonenumber-js's own grouping of a representative mobile
// number (AsYouType output where min metadata groups, international grouping
// sans calling code elsewhere). RU is pinned by the spec: «999 123-45-67».

/** ISO 3166-1 alpha-2 codes of the curated v1 list (libphonenumber-js CountryCode subset). */
export type PhoneCountryIso =
  | 'RU'
  | 'BY'
  | 'DE'
  | 'KZ'
  | 'LV'
  | 'LT'
  | 'PL'
  | 'UA'
  | 'EE';

/** One curated country of the phone-module selector. */
export interface PhoneCountry {
  /** Dictionary key — unique across the list (RU/KZ share a calling code, never an ISO). */
  iso: PhoneCountryIso;
  /** Calling code WITHOUT the leading '+' (e.g. '7', '375'). */
  callingCode: string;
  /** Russian display name — the selector shows code AND name («+7 Россия»). */
  name: string;
  /** National-format placeholder of the remainder input (e.g. «999 123-45-67»). */
  placeholder: string;
}

/** Curated v1 list (spec §Список стран): RU first, then Russian-alphabetical. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: 'RU', callingCode: '7', name: 'Россия', placeholder: '999 123-45-67' },
  { iso: 'BY', callingCode: '375', name: 'Беларусь', placeholder: '29 123 45 67' },
  { iso: 'DE', callingCode: '49', name: 'Германия', placeholder: '1512 3456789' },
  { iso: 'KZ', callingCode: '7', name: 'Казахстан', placeholder: '701 123 4567' },
  { iso: 'LV', callingCode: '371', name: 'Латвия', placeholder: '23 123 456' },
  { iso: 'LT', callingCode: '370', name: 'Литва', placeholder: '612 34567' },
  { iso: 'PL', callingCode: '48', name: 'Польша', placeholder: '512 345 678' },
  { iso: 'UA', callingCode: '380', name: 'Украина', placeholder: '67 123 4567' },
  { iso: 'EE', callingCode: '372', name: 'Эстония', placeholder: '5123 4567' },
];

/** Default selector country (spec §Виджет PhoneField): RU, always first in the list. */
export const DEFAULT_PHONE_COUNTRY: PhoneCountryIso = 'RU';
