'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Combobox, type ComboboxOption } from '@/app/components/shared/Combobox';
import { MasterPicker } from '@/app/components/shared/MasterPicker';
import { TimePicker } from '@/app/components/shared/TimePicker';
import { RecordHeader } from '@/app/components/shared/records/RecordHeader';
import { ClientStatistics } from '@/app/components/shared/record/blocks/ClientStatistics';
import { RecordVisitsTable } from '@/app/components/shared/record/blocks/RecordVisitsTable';
import { RecordPaymentsTable } from '@/app/components/shared/record/blocks/RecordPaymentsTable';
import { RecordComments } from '@/app/components/shared/record/blocks/RecordComments';
import { RecordTimestamps } from '@/app/components/shared/record/blocks/RecordTimestamps';
import { DeleteDialog } from '@/app/components/DeleteDialog';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useDeleteRecord } from '@/hooks/useDeleteRecord';
import { useUI } from '@/contexts/UIContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { invalidateEntities } from '@/lib/invalidate';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { formatRecordLabel } from '@/lib/utils';
import { patchVisitor, patchActivity, ApiError } from '@memo/api-client';
import type { ClientWithStats, DependencyNode, RecordView } from '@memo/api-client';

interface ClientRecordTabProps {
  recordId: string;
  clientId: string;
  /** Client-level stats (optional, from parent). */
  client?: ClientWithStats | null;
}

export function ClientRecordTab({ recordId, clientId, client }: ClientRecordTabProps) {
  const queryClient = useQueryClient();
  const { gridFrequency } = useGridSettings();
  const { showToast } = useUI();

  const { record, activity, services, masters, locations, payments, visitorsMap, tariffs, isLoading, recordData, status } =
    useRecordData(recordId, clientId);

  // Fine-grained mutations. Note: `saveRecord` is gone — record-level ops
  // (custom_price, comment, date/service) go through `updateRecord` +
  // `patchActivity` directly. Visit CRUD is fine-grained (addVisit,
  // patchVisit, deleteVisitDeferred).
  const {
    addPayment,
    patchPayment,
    deletePayment,
    updateRecord,
    addVisit,
    patchVisit,
    deleteVisit,
    addAnonymousVisit,
    deleteVisitDeferred,
    convertAnonymousVisit,
  } = useRecordMutations(record?.activity_id ?? '', recordId);

  // Delete — GH #285 deferred flow: the shared useDeleteRecord hook
  // (dry-run → enqueue / 409 dialog), see handleDelete below.

  // ── Surface-specific editable state ─────────────────────────────────────
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [masterId, setMasterId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [comment, setComment] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [preciseTime, setPreciseTime] = useState(false);

  // Initialize from data
  useEffect(() => {
    if (activity) {
      setDate(activity.start.split('T')[0] || '');
      setTime(activity.start.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
      setMasterId(activity.master_id);
      setLocationId(activity.location_id);
    }
  }, [activity]);

  useEffect(() => {
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
    }
  }, [record]);

  const markChanged = useCallback(() => setHasChanges(true), []);

  // ── Anonymous visits stepper (#257 unified visitors model) ──────────────
  // Anonymous seats are real visits with visitor_id = null; the header
  // stepper +/− creates/deletes them one at a time. The counter is derived
  // from record.visits — no extra query.
  const lastAnonymousVisit = useMemo(
    () => [...(record?.visits ?? [])].reverse().find((v) => v.visitor_id == null),
    [record?.visits],
  );

  const handleAddAnonymousVisit = useCallback(async () => {
    try {
      // tariffs[0] — the same first-tariff default as makeEmptyVisitRow;
      // no service tariffs → undefined → the visit is created with price 0.
      await addAnonymousVisit(tariffs[0]);
    } catch (err) {
      // Capacity re-check failures (409) surface here.
      showToast(parseApiError(err).message, 'error');
    }
  }, [addAnonymousVisit, tariffs, showToast]);

  const handleDeleteAnonymousVisit = useCallback(async () => {
    if (!lastAnonymousVisit) return;
    try {
      await deleteVisit(lastAnonymousVisit.id);
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  }, [deleteVisit, lastAnonymousVisit, showToast]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  /**
   * Record-level Save: only patches record fields (custom_price, comment)
   * and the activity (date, service) — no visit CRUD. Visits are managed
   * by the fine-grained addVisit/patchVisit/deleteVisitDeferred mutations.
   */
  const handleSave = useCallback(async () => {
    if (!record || !activity) return;
    const activityChanged =
      serviceId !== activity.service_id ||
      `${date}T${time}:00` !== activity.start;

    if (activityChanged) {
      try {
        await patchActivity(activity.id, {
          start: `${date}T${time}:00`,
          service_id: serviceId,
        });
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
        return;
      }
    }

    try {
      await updateRecord(recordId, {
        custom_price: customPrice.trim() ? Number(customPrice) : null,
        comment: comment || null,
      });
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
      return;
    }

    setHasChanges(false);
  }, [updateRecord, record, activity, date, time, serviceId, customPrice, comment, recordId, showToast]);

  const handleCancel = useCallback(() => {
    if (activity) {
      setDate(activity.start.split('T')[0] || '');
      setTime(activity.start.split('T')[1]?.slice(0, 5) || '');
      setServiceId(activity.service_id);
      setMasterId(activity.master_id);
      setLocationId(activity.location_id);
    }
    if (record) {
      setCustomPrice(record.custom_price != null ? String(record.custom_price) : '');
      setComment(record.comment || '');
    }
    setHasChanges(false);
  }, [activity, record]);

  // ── Delete — GH #285 deferred flow (mirrors RecordsTable) ──────────
  // Parent owns the state: removeRecord dry-runs (pure preview) — a clean 204
  // removes the row optimistically + enqueues the deferred delete (5s undo
  // window); a 409 WITH the dependency tree parks the tree + opens
  // DeleteDialog. The tab STAYS open after confirm — the user remains in
  // context (ClientsIntegration behavior).
  const { removeRecord, removeRecordResolved } = useDeleteRecord();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; deps: DependencyNode[] } | null>(null);

  const handleDelete = useCallback(async () => {
    try {
      // The hook reads only `.id` — the modal record is a RecordResponse
      // (no denormalized RecordView fields), so a row-shaped stub is enough.
      await removeRecord({ id: recordId } as RecordView);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.dependencies) {
        setDeleteTarget({ id: recordId, deps: err.dependencies });
        return;
      }
      showToast(parseApiError(err).message, 'error');
    }
  }, [removeRecord, recordId, showToast]);

  /**
   * Visitor name/age change — direct visitor update (no optimistic override
   * state). Mirrors the ClientTab Task 7 pattern.
   */
  const handleVisitorChange = useCallback(
    (visitorId: string, data: { name?: string; age?: number | null }) => {
      const apiData = { ...data, age: data.age ?? undefined };
      patchVisitor(visitorId, apiData)
        .then(() => {
          // Reader: ['visitors', clientId] in useRecordData
          invalidateEntities(queryClient, ['visitors']);
        })
        .catch((err) => {
          showToast(parseApiError(err).message, 'error');
        });
    },
    [clientId, queryClient, showToast],
  );

  /**
   * #257 D7: convert a saved anonymous visit into a named visitor — one point
   * PATCH /visits/{id} {visitor_id}. On API failure the row stays anonymous
   * (the cache is untouched — upsertVisit runs only after a successful PATCH).
   * Mirrors the ClientTab Task 7 pattern.
   */
  const handleConvertAnonymousVisit = useCallback(
    async (visitId: string, name: string, age: number | null) => {
      try {
        await convertAnonymousVisit(visitId, name, age);
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
    },
    [convertAnonymousVisit, showToast],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLoading) return <div className="p-4">Загрузка...</div>;
  if (!record) return <div className="p-4">Запись не найдена</div>;

  const visits = record.visits ?? [];
  const total = visits.reduce((sum, v) => sum + (v.custom_price ?? v.price ?? 0), 0);

  const inputClass = 'rounded-lg border px-3 py-2 text-sm bg-white';
  const inputStyle = { borderColor: 'var(--line)' };

  const locationOptions: ComboboxOption[] = (Array.isArray(locations) ? locations : []).map((l) => ({
    value: l.id,
    label: l.name,
    searchText: `${l.name} ${l.short_title ?? ''}`.trim(),
  }));

  const serviceOptions: ComboboxOption[] = (Array.isArray(services) ? services : []).map((s) => ({
    value: s.id,
    label: s.title,
  }));

  // Build RecordWithDerived for RecordHeader
  const headerData = recordData ? { ...recordData, client: client ?? null } : null;

  return (
    <div className="space-y-4 p-4" data-testid="client-record-tab">
      {/* Record header with status badge + anonymous-visits stepper (#257) */}
      {headerData && (
        <RecordHeader
          data={headerData}
          onAddAnonymousVisit={handleAddAnonymousVisit}
          onDeleteAnonymousVisit={lastAnonymousVisit ? handleDeleteAnonymousVisit : undefined}
        />
      )}

      {/* Client statistics */}
      <ClientStatistics
        stats={client ? {
          recordsCount: client.records_count,
          missedRecords: client.missed_records,
          lastRecord: client.last_record,
          totalPaid: client.total_paid,
        } : undefined}
      />

      {/* Row 1: Date / Time / Location */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-date">Дата</label>
          <input id="record-date" type="date" className={inputClass} style={inputStyle} value={date}
            onChange={e => { setDate(e.target.value); markChanged(); }} />
        </div>
        <div id="record-time">
          <TimePicker value={date && time ? `${date}T${time}:00` : ''}
            onChange={(isoValue) => { setTime(isoValue.split('T')[1]?.slice(0, 5) || ''); markChanged(); }}
            gridFrequency={gridFrequency} precise={preciseTime} label="Время" />
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <label className="flex items-center gap-1.5 text-xs text-ink-mid cursor-pointer">
            <input type="checkbox" checked={preciseTime} onChange={(e) => setPreciseTime(e.target.checked)}
              className="rounded" data-testid="checkbox-precise-time" />
            Точное время
          </label>
        </div>
        <div data-testid="select-location">
          <label className="text-xs font-medium text-ink-mid block mb-1">Локация</label>
          <Combobox clearLabel="Не выбрана" value={locationId} options={locationOptions}
            onChange={(v) => { setLocationId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
        </div>
      </div>

      {/* Row 2: Service / Master */}
      <div className="flex flex-wrap gap-3">
        <div data-testid="select-service">
          <label className="text-xs font-medium text-ink-mid block mb-1">Услуга</label>
          <Combobox clearLabel="Не выбрана" value={serviceId} options={serviceOptions}
            onChange={(v) => { setServiceId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
        </div>
        <div data-testid="select-master">
          <label className="text-xs font-medium text-ink-mid block mb-1">Мастер</label>
          <MasterPicker masters={masters} value={masterId}
            onChange={(v) => { setMasterId(v); markChanged(); }} className={`${inputClass} appearance-none`} />
        </div>
      </div>

      {/* Visitors table — visits read from canonical record.visits, no optimistic layer.
          Saved anonymous rows (visitor_id = null) convert inline (#257 D7). */}
      <RecordVisitsTable
        visits={visits}
        visitorsMap={visitorsMap}
        tariffs={tariffs}
        totalCost={total}
        recordStatus={status}
        clientId={clientId}
        onAddVisit={addVisit}
        onPatchVisit={patchVisit}
        onDeleteVisit={deleteVisitDeferred}
        onChangeVisitor={handleVisitorChange}
        onConvertAnonymousVisit={handleConvertAnonymousVisit}
      />

      {/* Custom price override (unique to /clients) */}
      <div className="flex justify-end items-center gap-2">
        <span className="text-sm text-ink-mid">Итого:</span>
        <input type="number" className="w-24 text-right rounded-lg border px-2 py-1 text-sm"
          style={inputStyle} value={customPrice !== '' ? customPrice : total}
          onChange={e => { setCustomPrice(e.target.value); markChanged(); }}
          data-testid="input-custom-price" />
        <span className="text-sm">₽</span>
      </div>

      {/* Payments table */}
      <RecordPaymentsTable
        payments={Array.isArray(payments) ? payments : []}
        onAddPayment={addPayment}
        onPatchPayment={patchPayment}
        onDeletePayment={deletePayment}
      />

      {/* Comment */}
      <RecordComments value={comment} onChange={(v) => { setComment(v); markChanged(); }} />

      {/* Timestamps */}
      <RecordTimestamps createdAt={record.created_at} updatedAt={record.updated_at} />

      {/* Actions */}
      <div className="flex justify-between items-center pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
        <button onClick={() => void handleDelete()} className="text-sm text-red-500 hover:text-red-600 transition-colors"
          data-testid="btn-delete-record">Удалить запись</button>
        <div className="flex gap-2">
          <button disabled={!hasChanges} onClick={handleCancel}
            className="px-4 py-2 text-sm text-ink-mid border rounded-lg disabled:opacity-50"
            style={{ borderColor: 'var(--line)' }}>Отмена</button>
          <button disabled={!hasChanges} onClick={handleSave}
            className="px-4 py-2 text-sm text-white rounded-lg disabled:bg-gray-300"
            style={{ backgroundColor: hasChanges ? 'var(--brand)' : undefined }}
            data-testid="btn-save-record">Сохранить</button>
        </div>
      </div>

      {/* Delete dialog — GH #285 (D3): opened on dry-run 409; the confirm
          enqueues the cascade deferred delete and the dialog closes
          immediately via onDone. The tab (and the parent modal) STAYS open —
          the user remains in context (ClientsIntegration behavior). */}
      {deleteTarget && (
        <DeleteDialog
          entityName={formatRecordLabel(activity?.start)}
          entityType="record"
          entityId={deleteTarget.id}
          dependencies={deleteTarget.deps}
          onResolve={async (_id, resolutions) => {
            // D3: enqueue is synchronous — no await, the dialog closes at once.
            void removeRecordResolved({ id: deleteTarget.id } as RecordView, resolutions, deleteTarget.deps);
          }}
          onArchive={async () => { /* records have no archive flow — never Mode B */ }}
          onDone={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
