'use client';

import React from 'react';
import { AuditLogProvider } from '@/contexts/AuditLogContext';
import { AuditLogTable } from './components/AuditLogTable';
import { AuditLogFilters } from './components/AuditLogFilters';

/**
 * GH #344 §7 — the «Журнал» section (/audit, admin-only via
 * ADMIN_ONLY_SECTIONS + the (main)/layout guard). Read-only page: filters
 * bar + DataTable, по образцу клиентов. The empty journal renders the
 * table's «Нет действий» stub (emptyLabel).
 */
export default function AuditPage() {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          Журнал
        </h1>
      </div>

      <AuditLogProvider>
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
