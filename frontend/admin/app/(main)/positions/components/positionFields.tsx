/** Local field types — no shared modal imports (TagModal precedent) */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type PositionFieldConfig = TextFieldConfig;

/**
 * The dictionary row carries exactly one editable field: `title` (D4 —
 * `is_system` is owned by the dictionary, never by the client; the fixed
 * `id` of a built-in is the code anchor and never moves).
 */
export const POSITION_FIELDS: PositionFieldConfig[] = [
  { type: 'text', key: 'title', label: 'Должность', required: true, placeholder: 'СММ-менеджер, Бухгалтер...' },
];
