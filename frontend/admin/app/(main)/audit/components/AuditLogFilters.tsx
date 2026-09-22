'use client';

import React from 'react';
import { useAuditLogTable } from '@/contexts/AuditLogContext';
import { useAuditLogAuthors } from '@/hooks/useAuditLogAuthors';
import { ENTITY_LABELS } from '../auditLabels';

/**
 * GH #344 §7 — the «Журнал» filter bar, по образцу клиентов
 * (ClientsFilters): author dropdown (from GET /audit-logs/authors),
 * action, entity, period (date_from/date_to), reset link.
 *
 * Empty states (spec §7): an empty journal yields an empty authors list —
 * the dropdown keeps only its «Все авторы» placeholder.
 */

/** Action dropdown options — update/patch share «изменил», so patch gets
 *  the slug in parens to disambiguate the two identical labels. */
const ACTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Любое' },
  { value: 'create', label: 'создал' },
  { value: 'update', label: 'изменил' },
  { value: 'patch', label: 'изменил (patch)' },
  { value: 'delete', label: 'удалил' },
  { value: 'archive', label: 'заархивировал' },
  { value: 'restore', label: 'восстановил' },
  { value: 'reorder', label: 'переставил' },
];

/** Entity dropdown options — the 16 canonical #239 names (ENTITY_LABELS
 *  key order mirrors the backend ENTITY_SIGNATURES vocabulary). */
const ENTITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Любая' },
  ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })),
];

export function AuditLogFilters() {
  const { filters, setFilters, resetFilters } = useAuditLogTable();
  const { data: authors = [] } = useAuditLogAuthors();

  const inputClass = 'rounded-lg border px-2 py-1.5 text-xs';
  const inputStyle = { borderColor: 'var(--line)' };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="text-xs text-ink-mid block mb-1">Автор</label>
          <select
            aria-label="Автор"
            className={inputClass}
            style={inputStyle}
            value={filters.user_id}
            onChange={(e) => setFilters({ user_id: e.target.value })}
          >
            <option value="">Все авторы</option>
            {authors.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.label ?? a.user_id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Действие</label>
          <select
            aria-label="Действие"
            className={inputClass}
            style={inputStyle}
            value={filters.action}
            onChange={(e) => setFilters({ action: e.target.value })}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Сущность</label>
          <select
            aria-label="Сущность"
            className={inputClass}
            style={inputStyle}
            value={filters.entity}
            onChange={(e) => setFilters({ entity: e.target.value })}
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-mid block mb-1">Период</label>
          <div className="flex gap-1">
            <input
              type="date"
              aria-label="Период"
              className={inputClass}
              style={inputStyle}
              value={filters.date_from}
              onChange={(e) => setFilters({ date_from: e.target.value })}
            />
            <input
              type="date"
              aria-label="Период"
              className={inputClass}
              style={inputStyle}
              value={filters.date_to}
              onChange={(e) => setFilters({ date_to: e.target.value })}
            />
          </div>
        </div>
      </div>
      <button onClick={resetFilters} className="text-xs text-brand hover:underline">
        Сбросить фильтры
      </button>
    </div>
  );
}
