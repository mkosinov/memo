'use client';

import React, { Suspense } from 'react';
import { RecordsProvider, useRecords } from '@/contexts/RecordsContext';
import { useRecordsUrlState } from './useRecordsUrlState';
import { RecordsFilters } from './components/RecordsFilters';
import { RecordsTable } from './components/RecordsTable';

function RecordsPageContent() {
  const { filters, setFilters, resetFilters } = useRecords();

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        Управление записями
      </h1>

      {/* Filters */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <RecordsFilters
          locationId={filters.locationId}
          serviceId={filters.serviceId}
          masterId={filters.masterId}
          status={filters.status}
          search={filters.search}
          onLocationChange={(v) => setFilters({ locationId: v })}
          onServiceChange={(v) => setFilters({ serviceId: v })}
          onMasterChange={(v) => setFilters({ masterId: v })}
          onStatusChange={(v) => setFilters({ status: v })}
          onSearchChange={(v) => setFilters({ search: v })}
          onReset={resetFilters}
        />
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <RecordsTable />
      </div>
    </div>
  );
}

/**
 * #349 Task 7 — the URL adapter is created INSIDE the Suspense boundary (its
 * useTableUrlState reads useSearchParams) and passed into RecordsProvider:
 * the ONE useTableUrlState instance on the /records URL (single writer).
 */
function RecordsUrlBoundary() {
  const urlState = useRecordsUrlState();
  return (
    <RecordsProvider urlState={urlState}>
      <RecordsPageContent />
    </RecordsProvider>
  );
}

export default function RecordsPage() {
  // The tree reads the URL via useSearchParams — the Suspense boundary is
  // MANDATORY for the Next 14 static build (same pattern as
  // app/(main)/schedule/page.tsx); the deep-link first paint
  // (?from=2024-01-01&status=waiting) must not fetch with the defaults.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <RecordsUrlBoundary />
    </Suspense>
  );
}
