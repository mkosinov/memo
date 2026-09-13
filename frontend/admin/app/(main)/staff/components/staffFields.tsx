/**
 * Local field types for the staff card (GH #266) — no shared modal imports.
 * The person fields only; the master section, position checkboxes and the
 * create-only account section are composed directly in StaffModal (they are
 * structured sections, not flat fields).
 */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type StaffFieldConfig = TextFieldConfig;

/** Basic person fields (staff table). */
export const STAFF_FIELDS: StaffFieldConfig[] = [
  { type: 'text', key: 'first_name', label: 'Имя', required: true, placeholder: 'Иван' },
  { type: 'text', key: 'last_name', label: 'Фамилия', required: true, placeholder: 'Иванов' },
  { type: 'text', key: 'avatar_url', label: 'Аватар URL', placeholder: 'https://...' },
];
