'use client';

import React, { Suspense } from 'react';
import { RecordsProvider, useRecords } from '@/contexts/RecordsContext';
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

export default function RecordsPage() {
  // #138 Task 5 (spec §2.2): the tree reads ?from=&to= via useSearchParams —
  // the Suspense boundary is MANDATORY for the Next 14 static build (same
  // pattern as app/(main)/schedule/page.tsx); the deep-link first paint
  // (?from=2024-01-01) must not fetch with the default range.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <RecordsProvider>
        <RecordsPageContent />
      </RecordsProvider>
    </Suspense>
  );
}
