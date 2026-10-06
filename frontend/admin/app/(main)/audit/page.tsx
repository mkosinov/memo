'use client';

import React, { Suspense } from 'react';
import { AuditLogProvider } from '@/contexts/AuditLogContext';
import { AuditLogTable } from './components/AuditLogTable';
import { AuditLogFilters } from './components/AuditLogFilters';
import { useAuditLogUrlState } from './useAuditLogUrlState';

/**
 * GH #344 §7 — the «Журнал» section (/audit, admin-only via
 * ADMIN_ONLY_SECTIONS + the (main)/layout guard). Read-only page: filters
 * bar + DataTable, по образцу клиентов. The empty journal renders the
 * table's «Нет действий» stub (emptyLabel).
 */
function AuditPageContent() {
  // #349 Task 9 — the URL adapter is created EXACTLY ONCE, here — inside
  // the Suspense boundary (useSearchParams) — and flows DOWN to the
  // provider as its urlState integration (managed mode, spec §3; the staff
  // precedent). Every filter-bar write becomes a URL write; there is no
  // initialFilters seam to remove (the journal never had one).
  const urlState = useAuditLogUrlState();

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Журнал
        </h1>
      </div>

      <AuditLogProvider urlState={urlState}>
        {/* Filters */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        >
          <AuditLogFilters />
        </div>

        {/* Table */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        >
          <AuditLogTable />
        </div>
      </AuditLogProvider>
    </div>
  );
}

export default function AuditPage() {
  // #349 Task 9: the Suspense boundary stays at the very top — the provider
  // mounts inside it, so useSearchParams suspends the page shell only once
  // (without the boundary the static build bails out to client rendering —
  // the staff-page precedent).
  return (
    <Suspense fallback={<div className="p-4">Загрузка...</div>}>
      <AuditPageContent />
    </Suspense>
  );
}
