'use client';

import React from 'react';
import { RecordsProvider, useRecords } from '@/contexts/RecordsContext';
import { BookingFilters } from './components/BookingFilters';
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
        <BookingFilters
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
  return (
    <RecordsProvider>
      <RecordsPageContent />
    </RecordsProvider>
  );
}
