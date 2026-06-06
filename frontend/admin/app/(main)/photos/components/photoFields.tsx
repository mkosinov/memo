/** Local field types */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type PhotoFieldConfig = TextFieldConfig;

export const PHOTO_FIELDS: PhotoFieldConfig[] = [
  { type: 'text', key: 'filename', label: 'Имя файла', required: true, placeholder: 'photo-001.jpg' },
  { type: 'text', key: 'visitor_id', label: 'Visitor ID', placeholder: 'UUID посетителя' },
  { type: 'text', key: 'service_id', label: 'Service ID', placeholder: 'UUID услуги' },
  { type: 'text', key: 'activity_id', label: 'Activity ID', placeholder: 'UUID активности' },
];
