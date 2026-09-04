'use client';

import { Combobox, type ComboboxOption } from './Combobox';
import { displayMasterName } from '@/lib/utils';

/** Accepts both raw API MasterResponse ({ first_name, last_name }) and domain Master ({ name, shortName }). */
interface MasterBase {
  id: string;
  color: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  shortName?: string;
}

interface MasterPickerProps {
  masters: MasterBase[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

function getMasterLabel(m: MasterBase): string {
  if (m.first_name != null || m.last_name != null) {
    return displayMasterName({ first_name: m.first_name ?? '', last_name: m.last_name ?? '' });
  }
  return m.name ?? '';
}

export function MasterPicker({ masters, value, onChange, className, ariaLabel }: MasterPickerProps) {
  const options: ComboboxOption[] = (Array.isArray(masters) ? masters : []).map((m) => ({
    value: m.id,
    label: getMasterLabel(m),
    color: m.color,
    searchText: m.shortName ? `${getMasterLabel(m)} ${m.shortName}` : undefined,
  }));

  return (
    <Combobox
      value={value}
      options={options}
      onChange={onChange}
      clearLabel="Не выбран"
      className={className}
      ariaLabel={ariaLabel}
    />
  );
}
