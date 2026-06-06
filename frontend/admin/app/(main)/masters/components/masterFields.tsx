/** Local field types — no shared modal imports */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

interface NumberFieldConfig {
  type: 'number';
  key: string;
  label: string;
  min?: number;
  max?: number;
  required?: boolean;
  suffix?: string;
}

export type MasterFieldConfig = TextFieldConfig | NumberFieldConfig;

export const MASTER_FIELDS: MasterFieldConfig[] = [
  { type: 'text', key: 'first_name', label: 'Имя', required: true, placeholder: 'Иван' },
  { type: 'text', key: 'last_name', label: 'Фамилия', required: true, placeholder: 'Иванов' },
  { type: 'text', key: 'color', label: 'Цвет', required: true, placeholder: '#5B8C7A' },
  { type: 'text', key: 'position', label: 'Должность', required: true, placeholder: 'мастер' },
  { type: 'text', key: 'specialty', label: 'Специальность', required: true, placeholder: 'живопись' },
  { type: 'text', key: 'avatar_url', label: 'Аватар URL', placeholder: 'https://...' },
];
