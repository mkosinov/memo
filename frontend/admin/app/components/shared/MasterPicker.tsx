'use client';

import { CustomSelect, type CustomSelectOption } from './CustomSelect';

interface Master {
  id: string;
  first_name: string;
  last_name: string;
  color: string;
}

interface MasterPickerProps {
  masters: Master[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function MasterPicker({ masters, value, onChange, className }: MasterPickerProps) {
  const options: CustomSelectOption[] = [
    { value: '', label: 'Не выбран' },
    ...(Array.isArray(masters) ? masters.map(m => ({
      value: m.id,
      label: `${m.first_name} ${m.last_name}`,
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
