'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { RecordResponse, TariffResponse } from '@memo/api-client';
import type { VisitStatus } from '@memo/domain';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VisitorOverride {
  name?: string;
  age?: number | null;
}

interface VisitOverride {
  tariff_id?: string;
  price?: number;
  status?: VisitStatus;
}

export interface UseOptimisticVisitMutationParams {
  record: RecordResponse | undefined;
  visitorsMap: Map<string, { name: string; age: number | null }>;
  serviceTariffs: TariffResponse[];
  /** Patch the record (for visit-level fields: tariff, price). */
  onUpdateRecord: (id: string, data: RecordPatchData) => Promise<void>;
  /** Update a single visit's status. */
  updateVisitStatus: (visitId: string, status: string) => Promise<void>;
  showToast: (message: string) => void;
}

export interface UseOptimisticVisitMutationResult {
  mergedVisitorsMap: Map<string, { name: string; age: number | null }>;
  mergedVisits: RecordResponse['visits'];
  handleVisitorChange: (visitorId: string, data: { name?: string; age?: number | null }) => void;
  handleVisitChange: (visitId: string, data: { status?: VisitStatus; tariff_id?: string }) => void;
  handleVisitPriceChange: (visitId: string, price: number) => void;
}

// ── RecordPatchData (inline to avoid circular import) ──────────────────────────

interface RecordPatchData {
  visits?: Array<{
    visitor_id?: string | null;
    tariff_id?: string | null;
    price: number;
    status?: string;
  }>;
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry(
  send: (signal: AbortSignal) => Promise<void>,
  controller: AbortController,
  isMountedRef: React.MutableRefObject<boolean>,
  onFinalError: () => void,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (controller.signal.aborted || !isMountedRef.current) return;
    try {
      await send(controller.signal);
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (attempt < 2) {
        const delay = attempt === 0 ? 500 : 1500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  if (isMountedRef.current) onFinalError();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOptimisticVisitMutation({
  record,
  visitorsMap,
  serviceTariffs,
  onUpdateRecord,
  updateVisitStatus,
  showToast,
}: UseOptimisticVisitMutationParams): UseOptimisticVisitMutationResult {
  const [visitorOverrides, setVisitorOverrides] = useState<Map<string, VisitorOverride>>(new Map());
  const [visitOverrides, setVisitOverrides] = useState<Map<string, VisitOverride>>(new Map());
  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup: abort on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  // ── Merged data ────────────────────────────────────────────────────────────

  const mergedVisitorsMap = useMemo(() => {
    if (visitorOverrides.size === 0) return visitorsMap;
    const merged = new Map(visitorsMap);
    visitorOverrides.forEach((override, visitorId) => {
      const existing = merged.get(visitorId) ?? { name: '', age: null };
      merged.set(visitorId, {
        name: override.name ?? existing.name,
        age: override.age !== undefined ? override.age : existing.age,
      });
    });
    return merged;
  }, [visitorsMap, visitorOverrides]);

  // ── Visitor name/age change ────────────────────────────────────────────────

  const handleVisitorChange = useCallback(
    (visitorId: string, data: { name?: string; age?: number | null }) => {
      // 1. Optimistic update
      setVisitorOverrides((prev) => {
        const next = new Map(prev);
        const existing = next.get(visitorId) ?? {};
        next.set(visitorId, { ...existing, ...data });
        return next;
      });

      // 2. Abort previous + create new controller
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      // 3. Send (TODO: no API endpoint yet — will always error)
      const fieldLabel = data.name !== undefined ? 'Имя' : 'Возраст';
      const newValue = data.name !== undefined
        ? (data.name || 'Анонимный')
        : (data.age !== null && data.age !== undefined ? String(data.age) : 'Взрослый');
      const visitorName = visitorsMap.get(visitorId)?.name?.trim() || 'Анонимный';

      withRetry(
        async (_signal: AbortSignal) => {
          // TODO: replace with actual PATCH /api/visitors/{visitorId} when API ready
          throw new Error('API not implemented yet');
        },
        controller,
        isMountedRef,
        () => {
          showToast(`Ошибка данных посетителя ${visitorName}: ${fieldLabel} - ${newValue}`);
        },
      );
    },
    [visitorsMap, showToast],
  );

  // ── Visit tariff/status change ─────────────────────────────────────────────

  const handleVisitChange = useCallback(
    (visitId: string, data: { status?: VisitStatus; tariff_id?: string }) => {
      if (!record) return;
      // Determine which field changed
      const isStatusOnly = data.status !== undefined && data.tariff_id === undefined;

      if (isStatusOnly) {
        // Status-only: optimistic + call updateVisitStatus
        setVisitOverrides((prev) => {
          const next = new Map(prev);
          const existing = next.get(visitId) ?? {};
          next.set(visitId, { ...existing, status: data.status! });
          return next;
        });

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;

        const fieldLabel = 'Статус';
        const statusConfig: Record<string, string> = {
          waiting: 'Ожидание',
          visited: 'Посетил',
          cancelled: 'Отменён',
          missed: 'Неявка',
        };
        const newValue = statusConfig[data.status!] ?? String(data.status);
        const visitorId = record?.visits.find((v) => v.id === visitId)?.visitor_id ?? '';
        const visitorName = visitorsMap.get(visitorId)?.name?.trim() || 'Анонимный';

        withRetry(
          async (_signal: AbortSignal) => {
            await updateVisitStatus(visitId, data.status!);
          },
          controller,
          isMountedRef,
          () => {
            showToast(`Ошибка данных посетителя ${visitorName}: ${fieldLabel} - ${newValue}`);
          },
        );
        return;
      }

      // Tariff change: optimistic + rebuild visits array
      if (data.tariff_id !== undefined) {
        setVisitOverrides((prev) => {
          const next = new Map(prev);
          const existing = next.get(visitId) ?? {};
          next.set(visitId, { ...existing, tariff_id: data.tariff_id });
          return next;
        });

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;

        const fieldLabel = 'Тариф';
        const tariffName = serviceTariffs.find((t) => t.id === data.tariff_id)?.title ?? data.tariff_id;
        const visitorId = record?.visits.find((v) => v.id === visitId)?.visitor_id ?? '';
        const visitorName = visitorsMap.get(visitorId)?.name?.trim() || 'Анонимный';

        const updatedVisits = (record?.visits || []).map((v) => ({
          visitor_id: v.visitor_id,
          price: v.price,
          status: v.status,
          ...(v.id === visitId ? { tariff_id: data.tariff_id } : {}),
        }));

        withRetry(
          async (_signal: AbortSignal) => {
            await onUpdateRecord(record.id, { visits: updatedVisits } as RecordPatchData);
          },
          controller,
          isMountedRef,
          () => {
            showToast(`Ошибка данных посетителя ${visitorName}: ${fieldLabel} - ${tariffName}`);
          },
        );
      }
    },
    [visitorsMap, record, updateVisitStatus, onUpdateRecord, showToast],
  );

  // ── Visit price change ─────────────────────────────────────────────────────

  const handleVisitPriceChange = useCallback(
    (visitId: string, price: number) => {
      if (!record) return;
      // Optimistic update
      setVisitOverrides((prev) => {
        const next = new Map(prev);
        const existing = next.get(visitId) ?? {};
        next.set(visitId, { ...existing, price });
        return next;
      });

      // Abort previous + create new controller
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const fieldLabel = 'Стоимость';
      const visitorId = record?.visits.find((v) => v.id === visitId)?.visitor_id ?? '';
      const visitorName = visitorsMap.get(visitorId)?.name?.trim() || 'Анонимный';

      const updatedVisits = (record?.visits || []).map((v) => ({
        visitor_id: v.visitor_id,
        price: v.id === visitId ? price : v.price,
        status: v.status,
      }));

      withRetry(
        async (_signal: AbortSignal) => {
          await onUpdateRecord(record.id, { visits: updatedVisits } as RecordPatchData);
        },
        controller,
        isMountedRef,
        () => {
          showToast(`Ошибка данных посетителя ${visitorName}: ${fieldLabel} - ${String(price)}`);
        },
      );
    },
    [visitorsMap, record, onUpdateRecord, showToast],
  );

  // ── Derived ────────────────────────────────────────────────────────────────

  const mergedVisits = useMemo(() => {
    const baseVisits = record?.visits ?? [];
    if (visitOverrides.size === 0) return baseVisits;
    return baseVisits.map((v) => {
      const override = visitOverrides.get(v.id);
      if (!override) return v;
      return {
        ...v,
        tariff_id: override.tariff_id !== undefined ? override.tariff_id : v.tariff_id,
        price: override.price !== undefined ? override.price : v.price,
        status: override.status !== undefined ? override.status : v.status,
      };
    });
  }, [record?.visits, visitOverrides]);

  return {
    mergedVisitorsMap,
    mergedVisits,
    handleVisitorChange,
    handleVisitChange,
    handleVisitPriceChange,
  };
}
