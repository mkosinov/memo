'use client';

import { CustomSelect, type CustomSelectOption } from './CustomSelect';

/** Accepts both raw API MasterResponse ({ first_name, last_name }) and domain Artist ({ name }). */
interface MasterBase {
  id: string;
  color: string;
  name?: string;
  first_name?: string;
  last_name?: string;
}

interface MasterPickerProps {
  masters: MasterBase[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

function getMasterLabel(m: MasterBase): string {
  if (m.first_name != null || m.last_name != null) {
    return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
  }
  return m.name ?? '';
}

export function MasterPicker({ masters, value, onChange, className }: MasterPickerProps) {
  const options: CustomSelectOption[] = [
    { value: '', label: 'Не выбран' },
    ...(Array.isArray(masters) ? masters.map(m => ({
      value: m.id,
      label: getMasterLabel(m),
      color: m.color,
    })) : []),
  ];

  return (
    <CustomSelect
      value={value}
      options={options}
      onChange={onChange}
      className={className}
    />
  );
}
