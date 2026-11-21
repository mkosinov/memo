/** Local field types — no shared modal imports */

import { TariffAudienceSchema } from '@memo/api-client';
import type { TariffAudience } from '@memo/api-client';

/** Audience labels — values derive from TariffAudienceSchema.options (#480 §3.4). */
const AUDIENCE_LABELS: Record<TariffAudience, string> = {
  kid: 'детский',
  adult: 'взрослый',
  all: 'единый',
};

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
  /** GH #203: optional numbers read their empty state («без ограничения»). */
  placeholder?: string;
}

interface TextareaFieldConfig {
  type: 'textarea';
  key: string;
  label: string;
  rows?: number;
  placeholder?: string;
}

/** Static-option select (GH #284). Options are fixed at config level (no dictionary). */
export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldConfig {
  type: 'select';
  key: string;
  label: string;
  options: SelectFieldOption[];
  /** Init value for NEW rows (GH #284: audience defaults to "all"). */
  defaultValue?: string;
}

interface NestedListFieldConfig {
  type: 'nested-list';
  key: string;
  label: string;
  itemLabel: string;
  itemFields: (TextFieldConfig | NumberFieldConfig | TextareaFieldConfig | SelectFieldConfig)[];
  addButtonText: string;
  emptyText: string;
}

/**
 * GH #606 (mirror of the #601 locationFields BooleanFieldConfig): boolean
 * fields render as a `role="switch"` button (donor: ActivityForm
 * `toggle-private`). Direct binding — checked = value, no inversion.
 * Initialization defaults to `true` (NOT the non-number empty string —
 * a '' would 422 the strict payload as a non-boolean).
 */
interface BooleanFieldConfig {
  type: 'boolean';
  key: string;
  label: string;
  /** Switch button testid — mirrors the #601 pin `toggle-is-public`. */
  testId?: string;
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

interface TagsFieldConfig {
  type: 'tags';
  key: 'tag_ids';
  label: string;
  placeholder?: string;
}

/**
 * GH #599: the service direction — a single-choice dictionary SELECT from
 * /specialties/all (manual input impossible). Options are supplied by the
 * modal (dictionary-backed via useSpecialtiesRaw), NOT stored here — the
 * config stays a pure description of the form shape (materials precedent).
 * Form state key is `specialty_id` (the wire reference); the display title
 * string is read-only on the response.
 */
export interface SpecialtyFieldConfig {
  type: 'specialty';
  key: 'specialty_id';
  label: string;
  /** The direction is NOT NULL server-side — always required. */
  required: true;
  /** Placeholder option of the empty state (value ''). */
  emptyOptionLabel: string;
}

export type ServiceFieldConfig =
  | TextFieldConfig
  | NumberFieldConfig
  | TextareaFieldConfig
  | NestedListFieldConfig
  | MaterialsFieldConfig
  | SelectFieldConfig
  | TagsFieldConfig
  | SpecialtyFieldConfig
  | BooleanFieldConfig;

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
    // GH #599: dictionary select from /specialties/all — replaces the free
    // -text «Специализация» input. Required: a service always references
    // exactly one direction (NOT NULL FK server-side).
    type: 'specialty',
    key: 'specialty_id',
    label: 'Направление',
    required: true,
    emptyOptionLabel: 'Выберите направление...',
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
    // GH #203: max_age is optional (null = «без ограничения») — the empty
    // state must read as intentional.
    placeholder: 'без ограничения',
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
    type: 'tags',
    key: 'tag_ids',
    label: 'Теги',
    placeholder: 'Введите название тега...',
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
  // GH #606: «Видно клиентам» — checked = is_public (visible on the site).
  // Available at create AND edit; hidden ≠ archived (mirror of the #601
  // location toggle, spec §3.6).
  { type: 'boolean', key: 'is_public', label: 'Видно клиентам', testId: 'toggle-is-public' },
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
      {
        // GH #284: возрастная группа тарифа. Canonical values derive from
        // TariffAudienceSchema.options (#480 §3.4); Russian lowercase labels
        // are display only (owner decision); new rows default to «единый»
        // (all). NO duplicate-group validation (canvas case — spec §2 п.2).
        type: 'select',
        key: 'audience',
        label: 'Возрастная группа',
        defaultValue: 'all',
        options: TariffAudienceSchema.options.map((value) => ({
          value,
          label: AUDIENCE_LABELS[value],
        })),
      },
    ],
  },
];
