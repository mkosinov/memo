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

interface TextareaFieldConfig {
  type: 'textarea';
  key: string;
  label: string;
  rows?: number;
  placeholder?: string;
}

/**
 * GH #601 §2.6: boolean fields render as a `role="switch"` button (donor:
 * ActivityForm `toggle-private`). Direct binding — checked = value, no
 * inversion. Initialization defaults to `true` (NOT the non-number empty
 * string — a '' would 422 the strict payload as a non-boolean).
 */
interface BooleanFieldConfig {
  type: 'boolean';
  key: string;
  label: string;
  /** Switch button testid — spec §2.6 pins `toggle-is-public`. */
  testId?: string;
}

export type LocationFieldConfig =
  | TextFieldConfig
  | NumberFieldConfig
  | TextareaFieldConfig
  | BooleanFieldConfig;

export const LOCATION_FIELDS: LocationFieldConfig[] = [
  { type: 'text', key: 'title', label: 'Название', required: true, placeholder: 'Студия на Тверской' },
  { type: 'text', key: 'short_title', label: 'Короткое название', placeholder: 'Например: Гранд' },
  { type: 'text', key: 'address', label: 'Адрес', placeholder: 'ул. Тверская, д. 1' },
  { type: 'textarea', key: 'description', label: 'Описание', rows: 3, placeholder: 'Описание локации...' },
  { type: 'number', key: 'capacity', label: 'Вместимость', required: true, min: 1, max: 500, suffix: 'чел.' },
  { type: 'text', key: 'location_hint', label: 'Подсказка', placeholder: 'Как найти, проход и т.д.' },
  { type: 'text', key: 'record_info', label: 'Информация для записи', placeholder: 'Инструкция для клиента' },
  { type: 'text', key: 'yandex_map_url', label: 'Яндекс.Карты', placeholder: 'https://yandex.ru/maps/...' },
  { type: 'text', key: 'review_url', label: 'Ссылка на отзыв', placeholder: 'https://...' },
  { type: 'text', key: 'image_url', label: 'Картинка URL', placeholder: 'https://...' },
  // GH #601: «Видно клиентам» — checked = is_public (visible on the site).
  // Available at create AND edit; hidden ≠ archived (spec §2.1/§2.8).
  { type: 'boolean', key: 'is_public', label: 'Видно клиентам', testId: 'toggle-is-public' },
];
