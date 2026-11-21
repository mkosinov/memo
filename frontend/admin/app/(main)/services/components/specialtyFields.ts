/** Local field types — no shared modal imports (TagModal/PositionModal precedent) */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type SpecialtyFieldConfig = TextFieldConfig;

/**
 * The dictionary row carries exactly one editable field: `title` («Название»,
 * GH #599 Task 8.1 — the positional modal precedent). The backend normalizes
 * on write (trim/whitespace collapse/NFC) and enforces the case-insensitive
 * uniqueness (409 SPECIALTY_TITLE_TAKEN); the client-side check is the
 * plain required-field validation only.
 */
export const SPECIALTY_FIELDS: SpecialtyFieldConfig[] = [
  { type: 'text', key: 'title', label: 'Название', required: true, placeholder: 'Живопись, Керамика...' },
];
