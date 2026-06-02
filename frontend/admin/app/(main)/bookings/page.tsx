'use client';

import React, { useState } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { BookingFilters } from './components/BookingFilters';
import { BookingTable } from './components/BookingTable';

export default function BookingsPage() {
  const { dateFrom, dateTo } = useNavigation();
  const [filters, setFilters] = useState({
    locationId: '',
    serviceId: '',
    masterId: '',
    status: '',
  });

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
          onLocationChange={(v) => setFilters((f) => ({ ...f, locationId: v }))}
          onServiceChange={(v) => setFilters((f) => ({ ...f, serviceId: v }))}
          onMasterChange={(v) => setFilters((f) => ({ ...f, masterId: v }))}
          onStatusChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          onReset={() => setFilters({ locationId: '', serviceId: '', masterId: '', status: '' })}
        />
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <BookingTable
          filters={{
            dateFrom,
            dateTo,
            locationId: filters.locationId,
            serviceId: filters.serviceId,
            masterId: filters.masterId,
            status: filters.status,
          }}
        />
      </div>
    </div>
  );
}
