'use client';

import React from 'react';
import { MastersTable } from './components/MastersTable';
import { MastersProvider } from '@/contexts/MastersContext';

export default function MastersPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          Управление мастерами
        </h1>
      </div>

      {/* Table card */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <MastersProvider>
          <MastersTable />
        </MastersProvider>
      </div>
    </div>
  );
}
