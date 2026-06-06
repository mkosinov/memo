'use client';

import React from 'react';
import { LocationsTable } from './components/LocationsTable';

export default function LocationsPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          Управление локациями
        </h1>
      </div>

      {/* Table card */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <LocationsTable />
      </div>
    </div>
  );
}
