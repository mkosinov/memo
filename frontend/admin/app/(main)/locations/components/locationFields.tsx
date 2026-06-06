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

export type LocationFieldConfig = TextFieldConfig | NumberFieldConfig | TextareaFieldConfig;

export const LOCATION_FIELDS: LocationFieldConfig[] = [
  { type: 'text', key: 'name', label: 'Название', required: true, placeholder: 'Студия на Тверской' },
  { type: 'text', key: 'address', label: 'Адрес', placeholder: 'ул. Тверская, д. 1' },
  { type: 'textarea', key: 'description', label: 'Описание', rows: 3, placeholder: 'Описание локации...' },
  { type: 'number', key: 'capacity', label: 'Вместимость', required: true, min: 1, max: 500, suffix: 'чел.' },
  { type: 'text', key: 'location_hint', label: 'Подсказка', placeholder: 'Как найти, проход и т.д.' },
  { type: 'text', key: 'record_info', label: 'Информация для записи', placeholder: 'Инструкция для клиента' },
  { type: 'text', key: 'yandex_map_url', label: 'Яндекс.Карты', placeholder: 'https://yandex.ru/maps/...' },
  { type: 'text', key: 'review_url', label: 'Ссылка на отзыв', placeholder: 'https://...' },
  { type: 'text', key: 'image_url', label: 'Картинка URL', placeholder: 'https://...' },
];
