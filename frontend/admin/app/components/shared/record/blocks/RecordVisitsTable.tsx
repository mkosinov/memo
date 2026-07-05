'use client';

import { useState, useCallback } from 'react';
import type { VisitResponse, TariffResponse } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';
import { StatusPicker } from '@/app/components/shared/StatusPicker';
import { StatusBadge } from '@/app/components/shared/StatusBadge';
import type { AddVisitorPayload } from '@/app/components/shared/visitors/AddVisitorForm';
import { safeStatus } from '@/app/lib/status-utils';
import { RecordTable, type Column } from '@/app/components/shared/record/RecordTable';
import { InlineEditCell } from '../InlineEditCell';

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
  isReadOnly?: boolean;
  onChangeVisit: (visitId: string, data: { status?: VisitStatus; tariff_id?: string }) => void;
  onChangeVisitor: (visitorId: string, data: { name?: string; age?: number | null }) => void;
  onChangeVisitPrice: (visitId: string, price: number) => void;
  onDeleteVisit: (visitId: string) => void;
  onAnonymVisitsChange: (value: number) => void;
  onAddVisitor: (data: AddVisitorPayload) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecordVisitsTable({
  visits,
  visitorsMap,
  tariffs,
  anonymVisits,
  totalCost,
  recordStatus,
  isReadOnly,
  onChangeVisit,
  onChangeVisitor,
  onChangeVisitPrice,
  onDeleteVisit,
  onAnonymVisitsChange,
  onAddVisitor,
}: RecordVisitsTableProps) {
  const [showForm, setShowForm] = useState(false);
  const [anonymInput, setAnonymInput] = useState(anonymVisits);

  // Inline add-row state (when showForm is true)
  const [newName, setNewName] = useState('');
  const [newAge, setNewAge] = useState<number | null>(null);
  const [newTariffId, setNewTariffId] = useState('');
  const [newPrice, setNewPrice] = useState(0);

  const handleAnonymChange = useCallback((value: number) => {
    setAnonymInput(value);
    const t = setTimeout(() => onAnonymVisitsChange(value), 500);
    return () => clearTimeout(t);
  }, [onAnonymVisitsChange]);

  const resetNewVisitor = useCallback(() => {
    setNewName('');
    setNewAge(null);
    setNewTariffId('');
    setNewPrice(0);
  }, []);

  // Empty name → create visitor with empty name (backend counts it as anonym_visit)
  const handleAdd = useCallback((data: AddVisitorPayload) => {
    onAddVisitor(data);
    setShowForm(false);
    resetNewVisitor();
  }, [onAddVisitor, resetNewVisitor]);

  const handleCancelAdd = useCallback(() => {
    setShowForm(false);
    resetNewVisitor();
  }, [resetNewVisitor]);

  // Auto-fill price when tariff changes (if user hasn't manually edited it)
  const handleNewTariffChange = useCallback((tariffId: string) => {
    setNewTariffId(tariffId);
    const tariff = tariffs.find((t) => t.id === tariffId);
    if (tariff) setNewPrice(tariff.price);
  }, [tariffs]);

  // Commit on Enter in price field (name field has its own inline handler)
  const handleNewNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd({ name: newName.trim(), age: newAge, tariff_id: newTariffId });
    }
  }, [newName, newAge, newTariffId, handleAdd]);

  return (
    <div data-testid="record-visits-table">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-ink-mid">Посетители</h4>
      </div>

      {/* Table */}
      <RecordTable testId="record-visits-table-table">
        {(visits.length > 0 || showForm) && <RecordTable.Header columns={VISIT_COLUMNS} isReadOnly={isReadOnly} />}

        {visits.map((visit) => {
          const visitor = visitorsMap.get(visit.visitor_id ?? '');
          const tariff = tariffs.find((t) => t.id === visit.tariff_id);
          return (
            <RecordTable.Row
              key={visit.id}
              columns={VISIT_COLUMNS}
              testId={`visit-row-${visit.id}`}
              cells={{
                name: isReadOnly ? (
                  <span className={`truncate ${visitor?.name ? 'text-ink' : 'text-ink-light italic'}`}>
                    {visitor?.name || 'Аноним'}
                  </span>
                ) : (
                  <InlineEditCell
                    value={visitor?.name ?? ''}
                    onCommit={(v) => {
                      if (visit.visitor_id) onChangeVisitor(visit.visitor_id, { name: v });
                    }}
                    title={visitor?.name || ''}
                    placeholder="Аноним"
                  />
                ),
                age: isReadOnly ? (
                  <span className="text-ink-mid text-sm">
                    {visitor?.age != null ? visitor.age : 'Взрослый'}
                  </span>
                ) : (
                  <select
                    value={visitor?.age != null ? String(visitor.age) : 'adult'}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (visit.visitor_id) {
                        onChangeVisitor(visit.visitor_id, { age: v === 'adult' ? null : Number(v) });
                      }
                    }}
                    title={visitor?.age != null ? String(visitor.age) : 'Взрослый'}
                    className="w-full rounded border px-1 py-0.5 text-sm bg-white truncate"
                    style={{ borderColor: 'var(--line)' }}
                    data-testid={`visit-${visit.id}-age`}
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
                ),
                tariff: isReadOnly ? (
                  <span className="text-ink-mid">{tariff?.title || '—'}</span>
                ) : (
                  <select
                    value={visit.tariff_id ?? ''}
                    onChange={(e) => onChangeVisit(visit.id, { tariff_id: e.target.value })}
                    className="w-full rounded border px-2 py-0.5 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                    data-testid={`visit-${visit.id}-tariff`}
                  >
                    <option value="">— тариф —</option>
                    {tariffs.map((t) => (
                      <option key={t.id} value={t.id}>{t.title} ({t.price} ₽)</option>
                    ))}
                  </select>
                ),
                price: isReadOnly ? (
                  <span className="text-ink-mid" data-testid={`visit-${visit.id}-price`}>
                    {visit.price.toLocaleString('ru-RU')} ₽
                  </span>
                ) : (
                  <InlineEditCell
                    type="number"
                    value={String(visit.price)}
                    onCommit={(v) => onChangeVisitPrice(visit.id, Number(v) || 0)}
                    className="text-right"
                  />
                ),
                status: isReadOnly ? (
                  <StatusBadge status={safeStatus(visit.status)} />
                ) : (
                  <StatusPicker
                    value={safeStatus(visit.status)}
                    onChange={(s) => onChangeVisit(visit.id, { status: s })}
                    variant="icon"
                    size="sm"
                    testIdPrefix={`visit-${visit.id}-status`}
                  />
                ),
                __actions: !isReadOnly ? (
                  <button
                    onClick={() => onDeleteVisit(visit.id)}
                    className="text-red-500 hover:text-red-600"
                    aria-label="Удалить посетителя"
                    data-testid={`visit-${visit.id}-delete`}
                  >
                    ×
                  </button>
                ) : null,
              }}
            />
          );
        })}

        {!isReadOnly && showForm && (
          <RecordTable.Row
            testId="add-visitor-row"
            columns={VISIT_COLUMNS}
            cells={{
              name: (
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      // Use e.currentTarget.value to avoid stale closure
                      const name = e.currentTarget.value.trim();
                      handleAdd({ name, age: newAge, tariff_id: newTariffId });
                    }
                  }}
                  onBlur={(e) => {
                    // Use e.currentTarget.value to avoid stale closure
                    const name = e.currentTarget.value.trim();
                    handleAdd({ name, age: newAge, tariff_id: newTariffId });
                  }}
                  placeholder="Аноним"
                  autoFocus
                  className="w-full rounded border px-2 py-0.5 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-visitor-name"
                />
              ),
              age: (
                <select
                  value={newAge != null ? String(newAge) : 'adult'}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewAge(v === 'adult' ? null : Number(v));
                  }}
                  className="w-full rounded border px-1 py-0.5 text-sm bg-white truncate"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-visitor-age"
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
              ),
              tariff: (
                <select
                  value={newTariffId}
                  onChange={(e) => handleNewTariffChange(e.target.value)}
                  className="w-full rounded border px-2 py-0.5 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-visitor-tariff"
                >
                  <option value="">— тариф —</option>
                  {tariffs.map((t) => (
                    <option key={t.id} value={t.id}>{t.title} ({t.price} ₽)</option>
                  ))}
                </select>
              ),
              price: (
                <input
                  type="number"
                  value={newPrice || ''}
                  onChange={(e) => setNewPrice(Number(e.target.value) || 0)}
                  onKeyDown={handleNewNameKeyDown}
                  className="w-full rounded border px-2 py-0.5 text-sm text-right"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="add-visitor-price"
                />
              ),
              status: <StatusPicker value="waiting" onChange={() => {}} variant="icon" size="sm" testIdPrefix="add-visitor-status" />,
              __actions: (
                <button
                  onClick={handleCancelAdd}
                  className="text-red-500 hover:text-red-600"
                  aria-label="Отменить"
                  data-testid="add-visitor-cancel"
                >
                  ×
                </button>
              ),
            }}
          />
        )}

        {!isReadOnly && (
          <RecordTable.TotalsRow
            testId="visits-total"
            columns={VISIT_COLUMNS}
            cells={{
              name: !showForm ? (
                <button
                  onClick={() => {
                    resetNewVisitor();
                    // pre-fill with first tariff's price as default
                    const firstTariff = tariffs[0];
                    if (firstTariff) {
                      setNewTariffId(firstTariff.id);
                      setNewPrice(firstTariff.price);
                    }
                    setShowForm(true);
                  }}
                  className="text-xs text-brand hover:underline transition-colors"
                  data-testid="btn-add-visitor"
                >
                  + Добавить
                </button>
              ) : null,
              tariff: <span className="text-sm text-ink-mid text-right block">Итого</span>,
              price: <span className="text-sm font-semibold text-ink">{totalCost.toLocaleString('ru-RU')} ₽</span>,
            }}
          />
        )}
      </RecordTable>

      {/* Empty state (shown when no visits) */}
      {visits.length === 0 && (
        <div className="px-3 py-4 text-xs text-ink-light text-center rounded-lg border" style={{ borderColor: 'var(--line)' }}>
          Нет посетителей
        </div>
      )}

    </div>
  );
}
