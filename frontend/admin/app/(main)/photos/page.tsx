'use client';

import React from 'react';
import { PhotosTable } from './components/PhotosTable';

export default function PhotosPage() {
  return (
    <div className="p-4 space-y-4">
      <h1
        className="text-lg font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        Управление фото
      </h1>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <PhotosTable />
      </div>
    </div>
  );
}
