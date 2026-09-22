'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useAuditLogTable } from '@/contexts/AuditLogContext';
import { DataTable } from '@/app/components/shared/DataTable';
import type { ColumnDef } from '@/app/components/shared/tableTypes';
import type { AuditLogResponse } from '@memo/api-client';
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  ROLE_LABELS,
  labelOf,
  formatChangesValue,
} from '../auditLabels';

/** Russian plural for «поле» (1 поле / 2–4 поля / 5+ полей). */
function pluralFields(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} поле`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} поля`;
  return `${n} полей`;
}

/** «Когда»: ru-RU date + HH:MM (the clientColumns formatDate precedent). */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * «Изменения» cell (spec §7): collapsed — a «N поля» hint; expanded — the
 * compact «поле: было → стало» decryption. Masked phone/email values
 * arrive ALREADY masked from the backend and render verbatim.
 */
function ChangesCell({
  row,
  expanded,
  onToggle,
}: {
  row: AuditLogResponse;
  expanded: boolean;
  onToggle: () => void;
}) {
  const entries = row.changes ? Object.entries(row.changes) : [];
  if (entries.length === 0) {
    return <span style={{ color: 'var(--ink-light)' }}>—</span>;
  }
  return (
    <div data-testid={`audit-changes-${row.id}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="text-xs px-2 py-0.5 rounded"
        style={{ color: 'var(--brand)' }}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Свернуть' : 'Раскрыть изменения'} — ${row.id}`}
      >
        {expanded ? '−' : '+'} {pluralFields(entries.length)}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 text-xs" style={{ color: 'var(--ink-mid)' }}>
          {entries.map(([field, pair]) => {
            const [before, after] = Array.isArray(pair) ? pair : [undefined, pair];
            return (
              <div key={field} className="whitespace-nowrap">
                <span style={{ color: 'var(--ink-light)' }}>{field}:</span>{' '}
                {formatChangesValue(before)} <span aria-hidden>→</span> {formatChangesValue(after)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * «Журнал» table (GH #344 §7) — DataTable по канону дизайн-системы.
 *
 * Server-fixed ordering created_at DESC (spec §7): every column is
 * non-sortable — sortBy stays null in the page context for its whole
 * lifetime, so the headers render as plain <th> labels.
 */
export function AuditLogTable() {
  const {
    items, total, page, perPage, sortBy, sortOrder, isLoading, isPending,
    isFetching, error, refetch, setPage, setPerPage, setSort,
  } = useAuditLogTable();

  // Expanded «Изменения» rows — local UI state, keyed by journal row id.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // §6.15 — memoize the factory outputs.
  const columns = useMemo<ColumnDef<AuditLogResponse>[]>(() => [
    {
      key: 'created_at',
      label: 'Когда',
      defaultVisible: true,
      sortable: false, // server-fixed created_at DESC
      render: (r) => (
        <span style={{ color: 'var(--ink-mid)' }}>{formatWhen(r.created_at)}</span>
      ),
    },
    {
      key: 'user',
      label: 'Кто',
      defaultVisible: true,
      sortable: false,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span style={{ color: 'var(--ink)' }}>{r.user?.label ?? '—'}</span>
          {/* Role badge — the ROW's role snapshot (spec §5), not live role. */}
          <span
            data-testid="audit-role-badge"
            className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-light)' }}
          >
            {labelOf(ROLE_LABELS, r.user_role)}
          </span>
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Действие',
      defaultVisible: true,
      sortable: false,
      render: (r) => (
        <span style={{ color: 'var(--ink)' }}>{labelOf(ACTION_LABELS, r.action)}</span>
      ),
    },
    {
      key: 'entity',
      label: 'Над чем',
      defaultVisible: true,
      sortable: false,
      render: (r) => (
        <span style={{ color: 'var(--ink-mid)' }}>
          {labelOf(ENTITY_LABELS, r.entity)}: {r.entity_label}
        </span>
      ),
    },
    {
      key: 'changes',
      label: 'Изменения',
      defaultVisible: true,
      sortable: false,
      render: (r) => (
        <ChangesCell
          row={r}
          expanded={expandedIds.has(r.id)}
          onToggle={() => toggleExpanded(r.id)}
        />
      ),
    },
    // Columns read expandedIds — re-memo when the set changes (§6.15 carve-out:
    // the renders close over live expansion state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [expandedIds, toggleExpanded]);

  return (
    <DataTable<AuditLogResponse>
      storageKey="audit-columns"
      columns={columns}
      tableState={{
        items,
        total,
        page,
        perPage,
        sortBy,
        sortOrder,
        isLoading,
        isPending,
        isFetching,
        error,
        setPage,
        setPerPage,
        setSort,
        refetch,
      }}
      actions={() => []} // the journal is read-only — no row actions
      emptyLabel="Нет действий"
      rowKey={(r) => r.id}
      rowTestId={(r) => `audit-row-${r.id}`}
    />
  );
}
