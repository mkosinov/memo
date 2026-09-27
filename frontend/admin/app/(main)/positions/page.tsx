'use client';

import React, { Suspense } from 'react';
import { PositionsTable } from './components/PositionsTable';
import { PositionsProvider } from '@/contexts/PositionsContext';
import { usePositionsUrlState } from './usePositionsUrlState';

/**
 * «Должности» — the positions dictionary screen (GH #266 T9). Flat page by the
 * tags/locations pattern (there is no `dictionaries` catalog in the project);
 * entered from the «Справочники» collapsible in the sidebar (DIRECTORY_ITEMS).
 */

// #349 Task 5 — managed mode (spec §3): the page-scoped hook is instantiated
// EXACTLY ONCE, here — inside the Suspense boundary (useSearchParams) — and
// flows DOWN to the provider as its urlState integration. The table consumes
// the URL-backed state through the context (every setter routes through
// update(); the dictionary has no search/status — page/per_page only).
function PositionsPageInner() {
  const urlState = usePositionsUrlState();
  return (
    <PositionsProvider urlState={urlState}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            Управление должностями
          </h1>
        </div>

        {/* Table card */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        >
          <PositionsTable />
        </div>
      </div>
    </PositionsProvider>
  );
}

export default function PositionsPage() {
  // #349 Task 5: the Suspense boundary stays at the very top — the provider
  // (and its first GET) lives under the boundary. Nothing observable renders
  // outside it, so the «Загрузка...» fallback stays the first visible frame.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <PositionsPageInner />
    </Suspense>
  );
}
