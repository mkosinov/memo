'use client';

import React, { useState } from 'react';
import { ServicesTable } from './components/ServicesTable';
import { MaterialsTable } from './components/MaterialsTable';
import { ServicesProvider } from '@/contexts/ServicesContext';
import { MaterialsProvider } from '@/contexts/MaterialsContext';
import { useAuth } from '@/contexts/AuthContext';

export default function ServicesPage() {
  const [view, setView] = useState<'services' | 'materials'>('services');
  // GH #263 T9: the «Материалы» block is the materials surface on this page —
  // without materials:read (master) the toggle must not render; switching to
  // it would fire a 403 fetch. Admin keeps both tabs (no regression).
  const { can } = useAuth();
  const canReadMaterials = can('materials:read');

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
          {canReadMaterials && (
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
          )}
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        {/* Each table sits inside its own server-pagination provider (#205):
            ServicesProvider (Task 9), MaterialsProvider (Task 10) — the two
            branches render independently, so there's no nesting conflict. */}
        {view === 'services' ? (
          <ServicesProvider>
            <ServicesTable />
          </ServicesProvider>
        ) : (
          <MaterialsProvider>
            <MaterialsTable />
          </MaterialsProvider>
        )}
      </div>
    </div>
  );
}
