'use client';

import React, { Suspense, useState } from 'react';
import { ServicesTable } from './components/ServicesTable';
import { MaterialsTable } from './components/MaterialsTable';
import { ServicesProvider } from '@/contexts/ServicesContext';
import { MaterialsProvider } from '@/contexts/MaterialsContext';
import { useServicesUrlState, useMaterialsUrlState } from './useServicesUrlState';
import { useAuth } from '@/contexts/AuthContext';

// #349 Task 6 — managed mode (spec §3): BOTH page-scoped URL adapters are
// instantiated EXACTLY ONCE, here — inside the Suspense boundary
// (useSearchParams) — and flow DOWN to their providers as the urlState
// integration. The services table owns the canonical param names; the
// materials table owns the mat_-prefixed set (spec §2) — see the two-
// instances-safety note in useServicesUrlState.ts (disjoint configs +
// mutually exclusive table branches = no clobbering).
function ServicesPageInner() {
  const servicesUrlState = useServicesUrlState();
  const materialsUrlState = useMaterialsUrlState();
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
            branches render independently, so there's no nesting conflict.
            #349: only the visible table's provider is mounted — at most one
            URL writer is active at a time (see useServicesUrlState.ts). */}
        {view === 'services' ? (
          <ServicesProvider urlState={servicesUrlState}>
            <ServicesTable />
          </ServicesProvider>
        ) : (
          <MaterialsProvider urlState={materialsUrlState}>
            <MaterialsTable />
          </MaterialsProvider>
        )}
      </div>
    </div>
  );
}

export default function ServicesPage() {
  // #349 Task 6: the Suspense boundary stays at the very top — the providers
  // (and their first GETs) live under the boundary. Nothing observable
  // renders outside it, so the «Загрузка...» fallback stays the first
  // visible frame (locations T5 precedent).
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <ServicesPageInner />
    </Suspense>
  );
}
