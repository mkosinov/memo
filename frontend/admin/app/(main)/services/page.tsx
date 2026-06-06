'use client';

import React from 'react';
import { ServicesTable } from './components/ServicesTable';

export default function ServicesPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          Управление услугами
        </h1>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <ServicesTable />
      </div>
    </div>
  );
}
