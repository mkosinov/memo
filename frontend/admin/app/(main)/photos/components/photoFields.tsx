/** Local field types */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

interface SearchableFieldConfig {
  type: 'searchable';
  key: string;
  label: string;
  displayField: string;
  placeholder?: string;
  required?: boolean;
}

/**
 * Plain <select> field (GH #211 Task 9). Options are supplied by the
 * FieldRenderer (dictionary-backed), NOT stored here — the field config stays
 * a pure description of the form shape.
 */
interface SelectFieldConfig {
  type: 'select';
  key: string;
  label: string;
  /** Empty-value option text (e.g. «Без локации»). */
  emptyLabel: string;
  required?: boolean;
}

interface TagsFieldConfig {
  type: 'tags';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type PhotoFieldConfig =
  | TextFieldConfig
  | SearchableFieldConfig
  | SelectFieldConfig
  | TagsFieldConfig;

export const PHOTO_FIELDS: PhotoFieldConfig[] = [
  { type: 'text', key: 'filename', label: 'Имя файла', required: true, placeholder: 'photo-001.jpg' },
  {
    type: 'searchable',
    key: 'client_id',
    label: 'Клиент',
    displayField: 'name',
    placeholder: 'Введите имя клиента...',
  },
  {
    type: 'searchable',
    key: 'service_id',
    label: 'Услуга',
    displayField: 'title',
    placeholder: 'Введите название...',
  },
  {
    // Canonical activity label (spec §7.7) — options AND the selected value
    // render the pre-formatted `label` field («dd.mm.yyyy HH:mm — Локация —
    // Услуга»); no subtitle, no datetime-only special case.
    type: 'searchable',
    key: 'activity_id',
    label: 'Активность',
    displayField: 'label',
    placeholder: 'Введите для поиска...',
  },
  {
    type: 'select',
    key: 'location_id',
    label: 'Локация',
    emptyLabel: 'Без локации',
  },
  {
    type: 'tags',
    key: 'tag_ids',
    label: 'Теги',
    placeholder: 'Введите название тега...',
  },
];
