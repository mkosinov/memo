'use client';

import React, { useState } from 'react';
import { BookingFilters } from '@/app/bookings/components/BookingFilters';
import { BookingTable } from '@/app/bookings/components/BookingTable';

export default function BookingsPage() {
  const [filters, setFilters] = useState({
    date: '',
    locationId: '',
    serviceId: '',
    status: '',
  });

  const handleReset = () => {
    setFilters({ date: '', locationId: '', serviceId: '', status: '' });
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
          date={filters.date}
          locationId={filters.locationId}
          serviceId={filters.serviceId}
          status={filters.status}
          onDateChange={(v) => setFilters((f) => ({ ...f, date: v }))}
          onLocationChange={(v) => setFilters((f) => ({ ...f, locationId: v }))}
          onServiceChange={(v) => setFilters((f) => ({ ...f, serviceId: v }))}
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
