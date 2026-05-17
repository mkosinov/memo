'use client';

import React, { useState } from 'react';
import { BookingFilters } from './components/BookingFilters';
import { BookingTable } from './components/BookingTable';

export default function BookingsPage() {
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    locationId: '',
    serviceId: '',
    masterId: '',
    status: '',
  });

  const handleReset = () => {
    setFilters({
      dateFrom: '',
      dateTo: '',
      locationId: '',
      serviceId: '',
      masterId: '',
      status: '',
    });
  };

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
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          locationId={filters.locationId}
          serviceId={filters.serviceId}
          masterId={filters.masterId}
          status={filters.status}
          onDateFromChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))}
          onDateToChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))}
          onLocationChange={(v) => setFilters((f) => ({ ...f, locationId: v }))}
          onServiceChange={(v) => setFilters((f) => ({ ...f, serviceId: v }))}
          onMasterChange={(v) => setFilters((f) => ({ ...f, masterId: v }))}
          onStatusChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          onReset={handleReset}
        />
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <BookingTable filters={filters} />
      </div>
    </div>
  );
}
