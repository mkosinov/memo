'use client';

import React from 'react';
import { StaffTable } from './components/StaffTable';
import { StaffProvider } from '@/contexts/StaffContext';

/**
 * «Сотрудники» — the staff directory screen (GH #266). Entered from the
 * «Справочники» collapsible in the sidebar (DIRECTORY_ITEMS). Replaces the
 * former /masters screen (management moved here; /masters is now a read-only
 * view consumed by the schedule filters).
 */
export default function StaffPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Управление сотрудниками
        </h1>
      </div>

      {/* Table card */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <StaffProvider>
          <StaffTable />
        </StaffProvider>
      </div>
    </div>
  );
}
