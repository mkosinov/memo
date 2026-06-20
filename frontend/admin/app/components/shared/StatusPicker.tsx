'use client';

import { CustomSelect, type CustomSelectOption } from './CustomSelect';
import { VISIT_STATUS_CONFIG, VISIT_STATUS_ORDER } from './config/VISIT_STATUS_CONFIG';
import type { VisitStatus } from '@memo/domain';

export interface StatusPickerProps {
  value: VisitStatus | '';
  onChange: (status: VisitStatus | '') => void;
  /** 'icon-only' shows only the icon; 'full' shows icon + label */
  variant?: 'icon-only' | 'full';
  /** When set, prepends an "all" option with the given label and empty-string value */
  placeholder?: string;
  className?: string;
  testIdPrefix?: string;
}

export function StatusPicker({
  value,
  onChange,
  variant = 'icon-only',
  placeholder,
  className,
  testIdPrefix = 'status-picker',
}: StatusPickerProps) {
  const options: CustomSelectOption[] = [
    ...(placeholder ? [{ value: '', label: placeholder }] : []),
    ...VISIT_STATUS_ORDER.map((s) => ({
      value: s,
      label: VISIT_STATUS_CONFIG[s].label,
    })),
  ];

  return (
    <div data-testid={testIdPrefix}>
      <CustomSelect
        value={value}
        onChange={(v) => onChange(v as VisitStatus | '')}
        options={options}
        iconOnly={variant === 'icon-only' && !placeholder}
        className={className}
      />
    </div>
  );
}
