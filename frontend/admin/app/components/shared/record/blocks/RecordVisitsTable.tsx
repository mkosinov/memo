'use client';

import { useState, useCallback, useEffect } from 'react';
import type { VisitResponse, TariffResponse, VisitPatch } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';
import { useUI } from '@/contexts/UIContext';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { StatusPicker } from '@/app/components/shared/StatusPicker';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import { safeStatus } from '@/app/lib/status-utils';
import { RecordTable, type Column } from '@/app/components/shared/record/RecordTable';
import { InlineEditCell } from '../InlineEditCell';
import { InlineEditRow } from '../InlineEditRow';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VisitRow {
  id: string | null;
  /** Transient UUID for React key. Stripped before API send. */
  clientId: string;
  visitor_id: string | null;
  name: string;
  age: number | null;
  tariff_id: string | null;
  price: number;
  status: VisitStatus;
}

interface VisitFormState {
  name: string;
  age: number | null;
  tariff_id: string | null;
  price: number;
  status: VisitStatus;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
function transientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tid-${++_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function visitResponseToRow(
  visit: VisitResponse,
  visitorsMap: Map<string, { name: string; age: number | null }>,
): VisitRow {
  if (!visit) {
    // Defensive: should never happen, but guards against undefined API responses
    return {
      id: null,
      clientId: transientId(),
      visitor_id: null,
      name: '',
      age: null,
      tariff_id: null,
      price: 0,
      status: 'waiting' as VisitStatus,
    };
  }
  const visitor = visitorsMap.get(visit.visitor_id ?? '');
  return {
    id: visit.id,
    clientId: transientId(),
    visitor_id: visit.visitor_id ?? null,
    name: visitor?.name ?? '',
    age: visitor?.age ?? null,
    tariff_id: visit.tariff_id ?? null,
    price: visit.price,
    status: safeStatus(visit.status) as VisitStatus,
  };
}

function makeEmptyVisitRow(tariffs: TariffResponse[]): VisitRow {
  const firstTariff = tariffs[0];
  return {
    id: null,
    clientId: transientId(),
    visitor_id: null,
    name: '',
    age: null,
    tariff_id: firstTariff?.id ?? null,
    price: firstTariff?.price ?? 0,
    status: 'waiting' as VisitStatus,
  };
}

function pickFormData(row: VisitRow): VisitFormState {
  return {
    name: row.name,
    age: row.age,
    tariff_id: row.tariff_id,
    price: row.price,
    status: row.status,
  };
}

// ── Column definitions ────────────────────────────────────────────────────────

const VISIT_COLUMNS: Column[] = [
  { key: 'name', label: 'Имя', width: 'flex-1 min-w-[80px]' },
  { key: 'age', label: 'Возраст', width: 'w-12 shrink-0', align: 'center' },
  { key: 'tariff', label: 'Тариф', width: 'w-28 shrink-0' },
  { key: 'price', label: 'Стоимость', width: 'w-20 shrink-0', align: 'right' },
  { key: 'status', label: '', width: 'w-6 shrink-0' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RecordVisitsTableProps {
  visits: VisitResponse[];
  visitorsMap: Map<string, { name: string; age: number | null }>;
  tariffs: TariffResponse[];
  anonymVisits: number;
  totalCost: number;
  recordStatus: VisitStatus;
  /** The record's client — needed for addVisit (createVisitor requires client_id). */
  clientId: string;
  isReadOnly?: boolean;
  /** POST new visit (2-step: createVisitor → createVisit). Returns saved VisitResponse. */
  onAddVisit: (data: { client_id: string; name: string; age?: number; tariff_id?: string | null; price: number }) => Promise<VisitResponse>;
  /** PATCH existing visit (tariff/price/status). Returns updated VisitResponse. */
  onPatchVisit: (visitId: string, data: VisitPatch) => Promise<VisitResponse>;
  /** DELETE existing visit. */
  onDeleteVisit: (visitId: string) => Promise<void>;
  /** Update visitor name/age (calls updateVisitor API). */
  onChangeVisitor: (visitorId: string, data: { name?: string; age?: number | null }) => void;
  onAnonymVisitsChange: (value: number) => void;
}

// ── Age select options (shared between new & existing rows) ───────────────────

function AgeSelect({
  value,
  onChange,
  testId,
}: {
  value: number | null;
  onChange: (age: number | null) => void;
  testId?: string;
}) {
  return (
    <select
      value={value != null ? String(value) : 'adult'}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === 'adult' ? null : Number(v));
      }}
      title={value != null ? String(value) : 'Взрослый'}
      className="w-full rounded border px-1 py-0.5 text-sm bg-white truncate"
      style={{ borderColor: 'var(--line)' }}
      data-testid={testId}
    >
      <optgroup label="Дети">
        {[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
          <option key={n} value={String(n)}>{n}</option>
        ))}
      </optgroup>
      <optgroup label="Подростки">
        {[12, 13, 14, 15, 16, 17].map((n) => (
          <option key={n} value={String(n)}>{n}</option>
        ))}
      </optgroup>
      <option value="adult">Взрослый</option>
    </select>
  );
}

// ── Tariff select options (shared between new & existing rows) ────────────────

function TariffSelect({
  value,
  tariffs,
  onChange,
  testId,
}: {
  value: string | null;
  tariffs: TariffResponse[];
  onChange: (tariffId: string) => void;
  testId?: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border px-2 py-0.5 text-sm"
      style={{ borderColor: 'var(--line)' }}
      data-testid={testId}
    >
      <option value="">— тариф —</option>
      {tariffs.map((t) => (
        <option key={t.id} value={t.id}>{t.title} ({t.price} ₽)</option>
      ))}
    </select>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecordVisitsTable({
  visits,
  visitorsMap,
  tariffs,
  anonymVisits,
  totalCost,
  recordStatus,
  clientId,
  isReadOnly,
  onAddVisit,
  onPatchVisit,
  onDeleteVisit,
  onChangeVisitor,
  onAnonymVisitsChange,
}: RecordVisitsTableProps) {
  const { showToast } = useUI();
  const [rows, setRows] = useState<VisitRow[]>(() =>
    visits.map((v) => visitResponseToRow(v, visitorsMap)),
  );
  const [anonymInput, setAnonymInput] = useState(anonymVisits);

  // Re-sync rows when visits/visitorsMap changes (after invalidation/refetch).
  // Preserves new rows (id === null) and existing rows' clientId (for key stability).
  useEffect(() => {
    setRows((prevRows) => {
      const newRows = prevRows.filter((r) => r.id === null);
      const updatedExisting = visits.map((visit) => {
        const existing = prevRows.find((r) => r.id === visit.id);
        if (existing) {
          const visitor = visitorsMap.get(visit.visitor_id ?? '');
          return {
            ...existing,
            visitor_id: visit.visitor_id ?? null,
            name: visitor?.name ?? existing.name,
            age: visitor?.age ?? existing.age,
            tariff_id: visit.tariff_id ?? existing.tariff_id,
            price: visit.price,
            status: safeStatus(visit.status) as VisitStatus,
          };
        }
        return visitResponseToRow(visit, visitorsMap);
      });
      return [...updatedExisting, ...newRows];
    });
  }, [visits, visitorsMap]);

  const handleAnonymChange = useCallback((value: number) => {
    setAnonymInput(value);
    const t = setTimeout(() => onAnonymVisitsChange(value), 500);
    return () => clearTimeout(t);
  }, [onAnonymVisitsChange]);

  // ── Row mutations ─────────────────────────────────────────────────────────

  const handleAddClick = useCallback(() => {
    setRows((prev) => [...prev, makeEmptyVisitRow(tariffs)]);
  }, [tariffs]);

  /** Remove a new (unsaved) row from the array — no API call. */
  const handleRemove = useCallback((row: VisitRow) => {
    setRows((prev) => prev.filter((r) => r !== row));
  }, []);

  /** DELETE a saved visit via API, then remove from array. */
  const handleDeleteRow = useCallback(async (id: string) => {
    await onDeleteVisit(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, [onDeleteVisit]);

  /** POST a new visit (2-step: createVisitor → createVisit). Returns saved row, or undefined on error. */
  const handleAdd = useCallback(async (data: VisitFormState): Promise<VisitRow | undefined> => {
    try {
      const saved = await onAddVisit({
        client_id: clientId,
        name: data.name,
        age: data.age ?? undefined,
        tariff_id: data.tariff_id,
        price: data.price,
      });
      const row = visitResponseToRow(saved, visitorsMap);
      // Preserve submitted values — visitorsMap may be stale (new visitor not yet loaded).
      return { ...row, name: data.name, age: data.age };
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
      return undefined;
    }
  }, [onAddVisit, clientId, visitorsMap, showToast]);

  /** PATCH an existing visit. Returns updated row. */
  const handleUpdate = useCallback(async (id: string, data: VisitFormState): Promise<VisitRow> => {
    const updated = await onPatchVisit(id, {
      tariff_id: data.tariff_id,
      price: data.price,
      status: data.status,
    });
    return visitResponseToRow(updated, visitorsMap);
  }, [onPatchVisit, visitorsMap]);

  /** Replace a row in the array by its clientId (used after onAdd resolves). */
  const replaceRowByClientId = useCallback((rowClientId: string, savedRow: VisitRow) => {
    setRows((prev) =>
      prev.map((r) =>
        r.clientId === rowClientId ? { ...savedRow, clientId: r.clientId } : r,
      ),
    );
  }, []);

  /** Replace a row in the array by its id (used after onPatchVisit resolves). */
  const replaceRowById = useCallback((id: string, updatedRow: VisitRow) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...updatedRow, clientId: r.clientId } : r)),
    );
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="record-visits-table">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-ink-mid">Посетители</h4>
      </div>

      {/* Table */}
      <RecordTable testId="record-visits-table-table">
        {rows.length > 0 && <RecordTable.Header columns={VISIT_COLUMNS} isReadOnly={isReadOnly} />}

        {rows.map((row) => (
          <InlineEditRow<VisitRow, VisitFormState>
            key={row.id ?? row.clientId}
            row={row}
            testIdPrefix="visit-row"
            columns={VISIT_COLUMNS}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
            onDelete={handleDeleteRow}
            onRemove={handleRemove}
            onSaved={(oldRow, savedRow) => replaceRowByClientId(oldRow.clientId, savedRow)}
            emptyData={() => pickFormData(makeEmptyVisitRow(tariffs))}
            pickFormData={pickFormData}
            isReadOnly={isReadOnly}
            renderCell={({ row: r, formState, isNew, handleChange }) => {
              const visitor = visitorsMap.get(r.visitor_id ?? '');
              const tariff = tariffs.find((t) => t.id === r.tariff_id);

              return {
                name: isReadOnly ? (
                  <span className={`truncate ${formState.name ? 'text-ink' : 'text-ink-light italic'}`}>
                    {formState.name || 'Аноним'}
                  </span>
                ) : (
                  <InlineEditCell
                    value={isNew ? formState.name : (visitor?.name ?? formState.name)}
                    onCommit={(v) => {
                      if (isNew) {
                        handleChange('name', v);
                        // Save is triggered by row-level handleSave (Enter/blur)
                      } else if (r.visitor_id) {
                        onChangeVisitor(r.visitor_id, { name: v });
                      }
                    }}
                    title={formState.name || ''}
                    placeholder="Аноним"
                    autoFocus={isNew}
                    data-testid={isNew ? 'add-visitor-name' : undefined}
                  />
                ),

                age: isReadOnly ? (
                  <span className="text-ink-mid text-sm">
                    {formState.age != null ? formState.age : 'Взрослый'}
                  </span>
                ) : (
                  <AgeSelect
                    value={formState.age}
                    onChange={(age) => {
                      if (isNew) {
                        handleChange('age', age);
                      } else if (r.visitor_id) {
                        onChangeVisitor(r.visitor_id, { age });
                      }
                    }}
                    testId={isNew ? 'add-visitor-age' : `visit-${r.id}-age`}
                  />
                ),

                tariff: isReadOnly ? (
                  <span className="text-ink-mid">{tariff?.title || '—'}</span>
                ) : (
                  <TariffSelect
                    value={formState.tariff_id}
                    tariffs={tariffs}
                    onChange={(tariffId) => {
                      const selectedTariff = tariffs.find((t) => t.id === tariffId);
                      if (isNew) {
                        handleChange('tariff_id', tariffId);
                        if (selectedTariff) handleChange('price', selectedTariff.price);
                      } else {
                        onPatchVisit(r.id!, {
                          tariff_id: tariffId,
                          price: selectedTariff?.price,
                        }).then((updated) => {
                          replaceRowById(r.id!, visitResponseToRow(updated, visitorsMap));
                        });
                      }
                    }}
                    testId={isNew ? 'add-visitor-tariff' : `visit-${r.id}-tariff`}
                  />
                ),

                price: isReadOnly ? (
                  <span className="text-ink-mid" data-testid={`visit-${r.id}-price`}>
                    {formState.price.toLocaleString('ru-RU')} ₽
                  </span>
                ) : (
                  <InlineEditCell
                    type="number"
                    value={String(formState.price)}
                    onCommit={(v) => {
                      const price = Number(v) || 0;
                      if (isNew) {
                        handleChange('price', price);
                      } else {
                        onPatchVisit(r.id!, { price }).then((updated) => {
                          replaceRowById(r.id!, visitResponseToRow(updated, visitorsMap));
                        });
                      }
                    }}
                    className="text-right"
                  />
                ),

                status: isReadOnly ? (
                  <StatusBadge status={safeStatus(formState.status)} />
                ) : (
                  <StatusPicker
                    value={safeStatus(formState.status)}
                    onChange={(s) => {
                      if (isNew) {
                        handleChange('status', s);
                      } else {
                        onPatchVisit(r.id!, { status: s }).then((updated) => {
                          replaceRowById(r.id!, visitResponseToRow(updated, visitorsMap));
                        });
                      }
                    }}
                    variant="icon"
                    size="sm"
                    testIdPrefix={isNew ? 'add-visitor-status' : `visit-${r.id}-status`}
                  />
                ),
              };
            }}
          />
        ))}

        {!isReadOnly && (
          <RecordTable.TotalsRow
            testId="visits-total"
            columns={VISIT_COLUMNS}
            cells={{
              name: (
                <button
                  onClick={handleAddClick}
                  className="text-xs text-brand hover:underline transition-colors"
                  data-testid="btn-add-visitor"
                >
                  + Добавить
                </button>
              ),
              tariff: <span className="text-sm text-ink-mid text-right block">Итого</span>,
              price: <span className="text-sm font-semibold text-ink">{totalCost.toLocaleString('ru-RU')} ₽</span>,
            }}
          />
        )}
      </RecordTable>

      {/* Empty state (shown when no visits and no new rows) */}
      {rows.length === 0 && (
        <div className="px-3 py-4 text-xs text-ink-light text-center rounded-lg border" style={{ borderColor: 'var(--line)' }}>
          Нет посетителей
        </div>
      )}
    </div>
  );
}
