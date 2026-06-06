'use client';

import React, { useState } from 'react';
import { ServicesTable } from './components/ServicesTable';
import { MaterialsTable } from './components/MaterialsTable';

export default function ServicesPage() {
  const [view, setView] = useState<'services' | 'materials'>('services');

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          {view === 'services' ? 'Управление услугами' : 'Управление материалами'}
        </h1>
        <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--surface)' }}>
          <button
            onClick={() => setView('services')}
            className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            style={{
              backgroundColor: view === 'services' ? 'var(--brand)' : 'transparent',
              color: view === 'services' ? 'white' : 'var(--ink-light)',
            }}
          >
            Услуги
          </button>
          <button
            onClick={() => setView('materials')}
            className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            style={{
              backgroundColor: view === 'materials' ? 'var(--brand)' : 'transparent',
              color: view === 'materials' ? 'white' : 'var(--ink-light)',
            }}
          >
            Материалы
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        {view === 'services' ? <ServicesTable /> : <MaterialsTable />}
      </div>
    </div>
  );
}
