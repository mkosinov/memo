'use client';

import React, { Suspense } from 'react';
import { StaffTable } from './components/StaffTable';
import { StaffProvider } from '@/contexts/StaffContext';
import { useStaffUrlState } from './useStaffUrlState';

/**
 * «Сотрудники» — the staff directory screen (GH #266). Entered from the
 * «Справочники» collapsible in the sidebar (DIRECTORY_ITEMS). Replaces the
 * former /masters screen (management moved here; /masters is now a read-only
 * view consumed by the schedule filters — NOT touched by #349).
 */
function StaffPageContent() {
  // #349 Task 8 — the URL adapter is created EXACTLY ONCE, here — inside
  // the Suspense boundary (useSearchParams) — and flows DOWN to the
  // provider as its urlState integration (managed mode, spec §3). The
  // table consumes the context as before; every setter becomes a URL write.
  const urlState = useStaffUrlState();

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
        <StaffProvider urlState={urlState}>
          <StaffTable />
        </StaffProvider>
      </div>
    </div>
  );
}

export default function StaffPage() {
  // #349 Task 8: the Suspense boundary stays at the very top — the provider
  // mounts inside it, so useSearchParams suspends the page shell only once
  // (without the boundary the static build bails out to client rendering).
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <StaffPageContent />
    </Suspense>
  );
}
