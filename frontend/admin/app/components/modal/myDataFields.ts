'use client';

// GH #262 T7 — «Мои данные» field configuration (spec §5.2, D2/D4/D7/D12).
//
// Mirrors the PhotoModal field-config pattern: a declarative list of the
// editable private fields, grouped by form section. The bespoke blocks
// (portrait, read-only Роль, conditional Имя/Фамилия, read-only
// Специализация, the passport-photo placeholder) are rendered explicitly by
// the modal because their visibility/interactivity rules don't fit a plain
// text config row.
//
// Visibility follows the public/private boundary:
//  - first_name/last_name (the STAFF CARD half) render only when has_staff;
//  - specialties (read-only) render only when has_master;
//  - everything else is the owner-only private half, always editable.

export type MyDataFieldType = 'text' | 'date' | 'calendar';

export interface MyDataFieldConfig {
  /** Profile key — also the PUT payload key and the `mydata-<key>` test id. */
  key: string;
  label: string;
  type: MyDataFieldType;
  required?: boolean;
  /** Form section the row belongs to. */
  section: 'main' | 'passport';
}

/** Private + card text/date fields in spec order. Names are appended by the
 *  modal only when has_staff (they are required + conditionally visible). */
export const MYDATA_MAIN_FIELDS: MyDataFieldConfig[] = [
  { key: 'patronymic', label: 'Отчество', type: 'text', section: 'main' },
  { key: 'birth_date', label: 'Дата рождения', type: 'calendar', section: 'main' },
  { key: 'residence_address', label: 'Адрес проживания', type: 'text', section: 'main' },
];

export const MYDATA_PASSPORT_FIELDS: MyDataFieldConfig[] = [
  { key: 'birth_place', label: 'Место рождения', type: 'text', section: 'passport' },
  { key: 'passport_series_number', label: 'Серия и номер', type: 'text', section: 'passport' },
  { key: 'passport_issued_date', label: 'Когда выдан', type: 'date', section: 'passport' },
  { key: 'passport_issued_by', label: 'Кем выдан', type: 'text', section: 'passport' },
  { key: 'registration_address', label: 'Адрес регистрации', type: 'text', section: 'passport' },
];

/** The disabled passport-photo placeholder row (domain-rules/profile.md: no
 *  upload, no private file storage in v1). EXACT string, no interactivity. */
export const PASSPORT_PHOTO_PLACEHOLDER = 'Фото первой страницы паспорта — появится позже';

/** Required-when-present card fields (non-nullable server-side). */
export const NAME_KEYS = ['first_name', 'last_name'] as const;
