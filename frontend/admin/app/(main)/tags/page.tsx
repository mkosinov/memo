'use client';

import React, { Suspense } from 'react';
import { TagsTable } from './components/TagsTable';
import { TagsProvider } from '@/contexts/TagsContext';
import { useTagsUrlState } from './useTagsUrlState';

// #349 Task 5 — managed mode (spec §3): the page-scoped hook is instantiated
// EXACTLY ONCE, here — inside the Suspense boundary (useSearchParams) — and
// flows DOWN to the provider as its urlState integration. The table consumes
// the URL-backed state through the context (search/sort/pagination setters
// route through update(); tags have no status — hard-delete dictionary).
function TagsPageInner() {
  const urlState = useTagsUrlState();
  return (
    <TagsProvider urlState={urlState}>
      <div className="p-4 space-y-4">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Управление тегами
        </h1>

        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        >
          <TagsTable />
        </div>
      </div>
    </TagsProvider>
  );
}

export default function TagsPage() {
  // #349 Task 5: the Suspense boundary stays at the very top — the provider
  // (and its first GET) lives under the boundary. Nothing observable renders
  // outside it, so the «Загрузка...» fallback stays the first visible frame.
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <TagsPageInner />
    </Suspense>
  );
}
