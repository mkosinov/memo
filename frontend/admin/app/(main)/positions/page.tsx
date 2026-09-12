'use client';

import React from 'react';
import { PositionsTable } from './components/PositionsTable';
import { PositionsProvider } from '@/contexts/PositionsContext';

/**
 * «Должности» — the positions dictionary screen (GH #266 T9). Flat page by the
 * tags/locations pattern (there is no `dictionaries` catalog in the project);
 * entered from the «Справочники» collapsible in the sidebar (DIRECTORY_ITEMS).
 */
export default function PositionsPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Управление должностями
        </h1>
      </div>

      {/* Table card */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <PositionsProvider>
          <PositionsTable />
        </PositionsProvider>
      </div>
    </div>
  );
}
