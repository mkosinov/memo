'use client';

import React from 'react';
import { PhotosTable } from './components/PhotosTable';
import { PhotosFilters } from './components/PhotosFilters';
import { PhotosProvider } from '@/contexts/PhotosContext';

function PhotosPageContent() {
  return (
    <div className="p-4 space-y-4">
      <h1
        className="text-lg font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        Управление фото
      </h1>

      {/* Filters (GH #211 Task 8; records/page.tsx card pattern) */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <PhotosFilters />
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <PhotosTable />
      </div>
    </div>
  );
}

export default function PhotosPage() {
  return (
    <PhotosProvider>
      <PhotosPageContent />
    </PhotosProvider>
  );
}
