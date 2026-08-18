'use client';

import React from 'react';
import { TagsTable } from './components/TagsTable';
import { TagsProvider } from '@/contexts/TagsContext';

export default function TagsPage() {
  return (
    <div className="p-4 space-y-4">
      <h1
        className="text-lg font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        Управление тегами
      </h1>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <TagsProvider>
          <TagsTable />
        </TagsProvider>
      </div>
    </div>
  );
}
