'use client';

import React, { Suspense } from 'react';
import { LocationsTable } from './components/LocationsTable';
import { LocationsProvider } from '@/contexts/LocationsContext';
import { useLocationsUrlState } from './useLocationsUrlState';

// #349 Task 5 — managed mode (spec §3): the page-scoped hook is instantiated
// EXACTLY ONCE, here — inside the Suspense boundary (useSearchParams) — and
// flows DOWN to the provider as its urlState integration. The table consumes
// the URL-backed state through the context (search/status/sort/pagination
// setters route through update()).
function LocationsPageInner() {
  const urlState = useLocationsUrlState();
  return (
    <LocationsProvider urlState={urlState}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
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
    </LocationsProvider>
  );
}

export default function LocationsPage() {
  // #349 Task 5: the Suspense boundary stays at the very top — the provider
  // (and its first GET) lives under the boundary. Nothing observable renders
  // outside it, so the «Загрузка...» fallback stays the first visible frame.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <LocationsPageInner />
    </Suspense>
  );
}
