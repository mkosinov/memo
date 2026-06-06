/** Local field types — no shared modal imports */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type TagFieldConfig = TextFieldConfig;

export const TAG_FIELDS: TagFieldConfig[] = [
  { type: 'text', key: 'tag', label: 'Тег', required: true, placeholder: 'VIP, Постоянный клиент...' },
];
