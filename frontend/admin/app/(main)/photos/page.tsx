'use client';

import React, { Suspense } from 'react';
import { PhotosTable } from './components/PhotosTable';
import { PhotosFilters } from './components/PhotosFilters';
import { PhotosProvider } from '@/contexts/PhotosContext';
import { usePhotosUrlState } from './usePhotosUrlState';

function PhotosPageContent() {
  return (
    <div className="p-4 space-y-4">
      <h1
        className="text-lg font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        Управление фото
      </h1>

      {/* Table — #412 US-3: the filter panel rides in the table toolbar
          (PhotosTable → DataTable toolbarLead); the external filter card
          above the table is retired. No key wrapper: the panel must not
          remount on page re-renders (local states — RemoteSearchSelect
          labels, resetKey — are preserved). */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <PhotosTable toolbarLead={<PhotosFilters />} />
      </div>
    </div>
  );
}

/**
 * #349 Task 8 — the URL adapter is created INSIDE the Suspense boundary (its
 * useTableUrlState reads useSearchParams) and passed into PhotosProvider:
 * the ONE useTableUrlState instance on the /photos URL (single writer,
 * RecordsUrlBoundary precedent).
 */
function PhotosUrlBoundary() {
  const urlState = usePhotosUrlState();
  return (
    <PhotosProvider urlState={urlState}>
      <PhotosPageContent />
    </PhotosProvider>
  );
}

export default function PhotosPage() {
  // #349 Task 8: the Suspense boundary stays at the very top — the provider
  // mounts inside it, so useSearchParams suspends the page shell only once
  // (without the boundary the static build bails out to client rendering).
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <PhotosUrlBoundary />
    </Suspense>
  );
}
