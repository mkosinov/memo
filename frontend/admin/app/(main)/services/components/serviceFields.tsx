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

interface NestedListFieldConfig {
  type: 'nested-list';
  key: string;
  label: string;
  itemLabel: string;
  itemFields: (TextFieldConfig | NumberFieldConfig | TextareaFieldConfig)[];
  addButtonText: string;
  emptyText: string;
}

/**
 * Materials checkbox multi-list with per-item notes (GH #223 spec §8).
 * Options are supplied by the modal (dictionary-backed — ACTIVE materials
 * from `/all?status=active`), NOT stored here: the config stays a pure
 * description of the form shape (photoFields 'select' precedent).
 */
interface MaterialsFieldConfig {
  type: 'materials';
  key: string;
  label: string;
  notePlaceholder: string;
  emptyText: string;
}

export type ServiceFieldConfig =
  | TextFieldConfig
  | NumberFieldConfig
  | TextareaFieldConfig
  | NestedListFieldConfig
  | MaterialsFieldConfig;

export const SERVICE_FIELDS: ServiceFieldConfig[] = [
  {
    type: 'text',
    key: 'title',
    label: 'Название',
    required: true,
    placeholder: 'Мастер-класс по рисованию',
  },
  {
    type: 'textarea',
    key: 'description',
    label: 'Описание',
    rows: 3,
    placeholder: 'Описание услуги...',
  },
  {
    type: 'text',
    key: 'specialty',
    label: 'Специализация',
    placeholder: 'Живопись, Графика...',
  },
  {
    type: 'number',
    key: 'duration',
    label: 'Длительность',
    required: true,
    min: 15,
    max: 480,
    suffix: 'мин',
  },
  {
    type: 'number',
    key: 'min_age',
    label: 'Возраст от',
    min: 0,
    max: 18,
    suffix: 'лет',
  },
  {
    type: 'number',
    key: 'max_age',
    label: 'Возраст до',
    min: 0,
    max: 18,
    suffix: 'лет',
  },
  {
    // GH #223 spec §8: replaces the retired `material_hint` text field —
    // checkbox multi-list of ACTIVE materials + one-line note per checked
    // item. Form state: {material_id, note?}[] (ServiceMaterialLink).
    type: 'materials',
    key: 'materials',
    label: 'Материалы',
    notePlaceholder: 'Заметка (что взять, сколько)...',
    emptyText: 'Нет активных материалов',
  },
  {
    type: 'text',
    key: 'record_info',
    label: 'Информация для записи',
    placeholder: 'Инструкция для клиента',
  },
  {
    type: 'text',
    key: 'image_url',
    label: 'Картинка URL',
    placeholder: 'https://...',
  },
  {
    type: 'nested-list',
    key: 'tariffs',
    label: 'Тарифы',
    itemLabel: 'Тариф',
    addButtonText: '+ Добавить тариф',
    emptyText: 'Нет тарифов',
    itemFields: [
      {
        type: 'text',
        key: 'title',
        label: 'Название',
        required: true,
        placeholder: 'Взрослый',
      },
      {
        type: 'number',
        key: 'price',
        label: 'Цена',
        required: true,
        min: 0,
        suffix: '₽',
      },
      {
        type: 'text',
        key: 'description',
        label: 'Описание',
        placeholder: 'Описание тарифа',
      },
    ],
  },
];
