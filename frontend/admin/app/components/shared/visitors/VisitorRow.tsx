'use client';

import type { TariffResponse } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';
import { StatusPicker } from '../StatusPicker';

export interface VisitorRowVisit {
  id: string;
  name: string;
  age: number | null;
  tariff_id: string | null;
  status: VisitStatus;
}

export interface VisitorRowProps {
  visit: VisitorRowVisit;
  tariffs: TariffResponse[];
  /** When true, StatusPicker is disabled (used for preview) */
  isPreview?: boolean;
}

export function VisitorRow({ visit, tariffs, isPreview }: VisitorRowProps) {
  const tariff = tariffs.find((t) => t.id === visit.tariff_id);

  return (
    <div
      className="flex items-center justify-between gap-2 text-sm py-1"
      data-testid={`visitor-row-${visit.id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium truncate">{visit.name}</span>
        {visit.age != null && (
          <span className="text-xs text-gray-500">{visit.age} лет</span>
        )}
        {tariff && (
          <span className="text-xs text-gray-500">
            {tariff.title} {tariff.price.toLocaleString('ru-RU')}₽
          </span>
        )}
      </div>
      <StatusPicker
        value={visit.status}
        onChange={() => {}}
        variant="icon-only"
        testIdPrefix={`visitor-status-${visit.id}`}
      />
    </div>
  );
}
