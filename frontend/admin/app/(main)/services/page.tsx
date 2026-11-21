'use client';

import React, { Suspense, useState } from 'react';
import { ServicesTable } from './components/ServicesTable';
import { MaterialsTable } from './components/MaterialsTable';
import { SpecialtiesTable } from './components/SpecialtiesTable';
import { ServicesProvider } from '@/contexts/ServicesContext';
import { MaterialsProvider } from '@/contexts/MaterialsContext';
import { SpecialtiesProvider } from '@/contexts/SpecialtiesContext';
import { useServicesUrlState, useMaterialsUrlState, useSpecialtiesUrlState } from './useServicesUrlState';
import { useAuth } from '@/contexts/AuthContext';

// #349 Task 6 — managed mode (spec §3): ALL page-scoped URL adapters are
// instantiated EXACTLY ONCE, here — inside the Suspense boundary
// (useSearchParams) — and flow DOWN to their providers as the urlState
// integration. The services table owns the canonical param names; the
// materials table owns the mat_-prefixed set and the specialties table the
// spec_-prefixed one (spec §2) — see the multiple-instances-safety note in
// useServicesUrlState.ts (disjoint configs + mutually exclusive table
// branches = no clobbering).
function ServicesPageInner() {
  const servicesUrlState = useServicesUrlState();
  const materialsUrlState = useMaterialsUrlState();
  const specialtiesUrlState = useSpecialtiesUrlState();
  const [view, setView] = useState<'services' | 'materials' | 'specialties'>('services');
  // GH #263 T9: the «Материалы» block is the materials surface on this page —
  // without materials:read (master) the toggle must not render; switching to
  // it would fire a 403 fetch. Admin keeps both tabs (no regression).
  // GH #599 Task 8.1: «Направления» rides the same rule on specialties:read
  // (spec §2.3 — the materials:read precedent).
  const { can } = useAuth();
  const canReadMaterials = can('materials:read');
  const canReadSpecialties = can('specialties:read');

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          {view === 'services'
            ? 'Управление услугами'
            : view === 'materials'
              ? 'Управление материалами'
              : 'Управление направлениями'}
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
          {canReadSpecialties && (
            <button
              data-testid="specialties-tab"
              onClick={() => setView('specialties')}
              className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
              style={{
                backgroundColor: view === 'specialties' ? 'var(--brand)' : 'transparent',
                color: view === 'specialties' ? 'white' : 'var(--ink-light)',
              }}
            >
              Направления
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
            ServicesProvider (Task 9), MaterialsProvider (Task 10),
            SpecialtiesProvider (GH #599 Task 8.1) — the three branches render
            independently, so there's no nesting conflict.
            #349: only the visible table's provider is mounted — at most one
            URL writer is active at a time (see useServicesUrlState.ts). */}
        {view === 'services' && (
          <ServicesProvider urlState={servicesUrlState}>
            <ServicesTable />
          </ServicesProvider>
        )}
        {view === 'materials' && (
          <MaterialsProvider urlState={materialsUrlState}>
            <MaterialsTable />
          </MaterialsProvider>
        )}
        {view === 'specialties' && (
          <SpecialtiesProvider urlState={specialtiesUrlState}>
            <SpecialtiesTable />
          </SpecialtiesProvider>
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
