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
  subtitleField?: string;
  placeholder?: string;
  required?: boolean;
}

interface TagsFieldConfig {
  type: 'tags';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type PhotoFieldConfig = TextFieldConfig | SearchableFieldConfig | TagsFieldConfig;

export const PHOTO_FIELDS: PhotoFieldConfig[] = [
  { type: 'text', key: 'filename', label: 'Имя файла', required: true, placeholder: 'photo-001.jpg' },
  {
    type: 'searchable',
    key: 'visitor_id',
    label: 'Посетитель',
    displayField: 'name',
    subtitleField: 'age',
    placeholder: 'Введите имя...',
  },
  {
    type: 'searchable',
    key: 'service_id',
    label: 'Услуга',
    displayField: 'title',
    placeholder: 'Введите название...',
  },
  {
    type: 'searchable',
    key: 'activity_id',
    label: 'Активность',
    displayField: 'service_title',
    subtitleField: 'start',
    placeholder: 'Введите услугу или дату...',
  },
  {
    type: 'tags',
    key: 'tag_ids',
    label: 'Теги',
    placeholder: 'Введите название тега...',
  },
];
