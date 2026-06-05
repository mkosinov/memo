export interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export interface NumberFieldConfig {
  type: 'number';
  key: string;
  label: string;
  min?: number;
  max?: number;
  required?: boolean;
  suffix?: string;
}

export interface TextareaFieldConfig {
  type: 'textarea';
  key: string;
  label: string;
  rows?: number;
  placeholder?: string;
}

export interface SelectFieldConfig {
  type: 'select';
  key: string;
  label: string;
  options: { value: string; label: string }[];
  required?: boolean;
}

export interface TagsFieldConfig {
  type: 'tags';
  key: string;
  label: string;
  fetchTags: () => Promise<{ id: string; name: string }[]>;
}

export interface NestedListFieldConfig {
  type: 'nested-list';
  key: string;
  label: string;
  itemLabel: string;
  itemFields: (TextFieldConfig | NumberFieldConfig | TextareaFieldConfig)[];
  addButtonText: string;
  emptyText: string;
}

export type FieldConfig =
  | TextFieldConfig
  | NumberFieldConfig
  | TextareaFieldConfig
  | SelectFieldConfig
  | TagsFieldConfig
  | NestedListFieldConfig;
