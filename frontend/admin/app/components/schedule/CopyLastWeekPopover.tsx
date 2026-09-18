'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ActivityResponse, CopyWeekResult } from '@memo/api-client';
import { getActivities } from '@memo/api-client';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import { qk } from '@/lib/queryKeys';
import { shiftDateKey } from '@/lib/datetime';

// ─── Constants (spec §6) ────────────────────────────────────────────────────

/** Popup fetch lives a week behind the grid — 5-min cache reuse for repeat opens. */
const POPUP_STALE_TIME = 5 * 60_000;
const SOURCE_PAGE_SIZE = 100;

/**
 * Honest note when the source page was capped (spec §6: `total > items.length`).
 */
function cappedNote(total: number): string {
  return `Показаны первые ${SOURCE_PAGE_SIZE} из ${total} занятий; за один заход копируется до ${SOURCE_PAGE_SIZE} — сузьте выбор локаций или скопируйте в несколько заходов`;
}

// ─── Dedup key (spec §5.2) ──────────────────────────────────────────────────

/**
 * (master, service, start, duration) — location/capacity are deliberately
 * OUTSIDE the key (spec §5.2), so manual edits to those fields in the target
 * week don't turn a repeat click into duplicate generation.
 */
function dedupKey(masterId: string, serviceId: string, start: string, duration: number): string {
  return `${masterId}|${serviceId}|${start}|${duration}`;
}

/** Dedup key of a SOURCE row — start shifted +7 days into the target week (calendar-day arithmetic, #142). */
function shiftedDedupKey(a: ActivityResponse): string {
  const [date, time] = a.start.split('T');
  const shifted = shiftDateKey(date, 7);
  return dedupKey(a.master_id, a.service_id, `${shifted}T${time}`, a.duration);
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CopyLastWeekPopoverProps {
  /** Monday ('YYYY-MM-DD') of the TARGET (viewed) week — passed by the opener. */
  weekStart: string;
  onClose: () => void;
}

/** Source-week page — `{ items, total }` rides in ONE cache value, so a fresh cache hit still reports the capped total (spec §6). */
interface CopySource {
  items: ActivityResponse[];
  total: number;
}

interface LocationEntry {
  id: string;
  name: string;
  /** Source rows of this location minus private minus target-week duplicates (spec §6). */
  toCopy: number;
}

export function CopyLastWeekPopover({ weekStart, onClose }: CopyLastWeekPopoverProps) {
  const { locations, copyLastWeek } = useScheduleData();
  const { showToast } = useUI();

  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const checkedInitRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Target week = Monday..Sunday of the viewed week; source = the 7 days before.
  const srcStart = useMemo(() => shiftDateKey(weekStart, -7), [weekStart]);
  const srcEnd = useMemo(() => shiftDateKey(weekStart, -1), [weekStart]);
  const weekEnd = useMemo(() => shiftDateKey(weekStart, 6), [weekStart]);

  // Open → fetch the source week. Popover-OWNED key (qk.activityRangeCopySource):
  // the grid's activityRange cache holds plain rows and could shadow this
  // fetch, losing `total` — so the { items, total } pair lives in this key's
  // own cache entry. `meta.silent` skips the QueryCache error toast (the
  // popover reports the failure itself, inline + toast below).
  const {
    data: source,
    error: sourceError,
  } = useQuery<CopySource>({
    queryKey: qk.activityRangeCopySource(srcStart, srcEnd),
    queryFn: async () => {
      const res = await getActivities({
        date_from: srcStart,
        date_to: srcEnd,
        per_page: SOURCE_PAGE_SIZE,
      });
      return { items: res.items, total: res.total };
    },
    staleTime: POPUP_STALE_TIME,
    meta: { silent: true },
  });

  // Toast the source-fetch failure once (inline error renders below).
  useEffect(() => {
    if (sourceError) {
      showToast(sourceError.message, 'error');
    }
  }, [sourceError, showToast]);

  // Target week rows — reactive subscription on the grid's activityRange key
  // (spec §6: already loaded by the grid). `enabled: false`: the grid owns the
  // fetching; this observer only READS — but it re-renders whenever the cache
  // entry changes (grid query resolving after open, SSE invalidation refetch),
  // so net counters / enable state never stay pinned to an empty cache.
  const { data: targetRows = [] } = useQuery<ActivityResponse[]>({
    queryKey: qk.activityRange(weekStart, weekEnd),
    enabled: false,
  });

  // Per-location source rows (archived locations are absent from the active
  // page dictionary → never listed; the server filters them as a second line).
  const locationEntries = useMemo<LocationEntry[]>(() => {
    if (!source) return [];
    const targetKeys = new Set(targetRows.map((t) => dedupKey(t.master_id, t.service_id, t.start, t.duration)));

    return locations.flatMap((loc) => {
      const rows = source.items.filter((a) => a.location_id === loc.id);
      if (rows.length === 0) return [];
      const toCopy = rows.filter(
        (a) => !a.is_private && !targetKeys.has(shiftedDedupKey(a)),
      ).length;
      return [{ id: loc.id, name: loc.title, toCopy }];
    });
  }, [source, locations, targetRows]);

  // All locations checked by default — initialize once, after the source lands.
  useEffect(() => {
    if (!source || checkedInitRef.current || locationEntries.length === 0) return;
    checkedInitRef.current = true;
    setCheckedIds(new Set(locationEntries.map((e) => e.id)));
  }, [source, locationEntries]);

  const privateCount = useMemo(
    () => source?.items.filter((a) => a.is_private).length ?? 0,
    [source],
  );

  const totalToCopy = useMemo(
    () => locationEntries.reduce((sum, e) => sum + (checkedIds.has(e.id) ? e.toCopy : 0), 0),
    [locationEntries, checkedIds],
  );

  // Close on outside click — same guard as OverlapPopover (skip the toggle trigger).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        !target.closest('[data-popover-toggle]')
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const toggleLocation = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    if (!source || totalToCopy === 0 || submitting) return;
    setSubmitting(true);
    try {
      const result: CopyWeekResult = await copyLastWeek(weekStart, Array.from(checkedIds));
      if (result.copied > 0) {
        let message = `Скопировано ${result.copied} занятий`;
        if (result.skipped_duplicates > 0) {
          message += ` (пропущено ${result.skipped_duplicates} — уже есть)`;
        }
        const filtered = result.skipped_filtered + result.skipped_no_master;
        if (filtered > 0) {
          message += `\nне скопировано ещё ${filtered} — индивидуальные, архивная локация или без замены мастера`;
        }
        showToast(message, 'success');
      } else if (result.skipped_duplicates > 0) {
        showToast('Всё уже есть', 'info');
      } else {
        showToast('Нечего копировать', 'info');
      }
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Не удалось скопировать прошлую неделю', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [source, totalToCopy, submitting, copyLastWeek, weekStart, checkedIds, showToast, onClose]);

  const isLoading = !source && !sourceError;
  const isEmpty = !!source && source.items.length === 0;
  const copyDisabled = isLoading || !!sourceError || isEmpty || totalToCopy === 0 || submitting;

  return (
    <div
      ref={popoverRef}
      data-testid="copy-last-week-popover"
      className="fixed top-3 right-3 w-80 bg-white rounded-lg shadow-xl border z-[var(--z-popover-stack)]"
      style={{ borderColor: 'var(--line)' }}
      role="dialog"
      aria-label="Копировать прошлую неделю"
    >
      {/* Close button */}
      <button
        data-testid="copy-close"
        onClick={onClose}
        className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        aria-label="Закрыть"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <div className="px-4 pt-3 pb-4">
        <h3 className="text-sm font-semibold pr-6" style={{ color: 'var(--ink)' }}>
          Копировать прошлую неделю
        </h3>

        {isLoading && (
          <p data-testid="copy-loading" className="mt-3 text-xs" style={{ color: 'var(--ink-light)' }}>
            Загрузка прошлой недели…
          </p>
        )}

        {sourceError && (
          <p data-testid="copy-fetch-error" className="mt-3 text-xs text-red-600">
            {sourceError.message}
          </p>
        )}

        {isEmpty && (
          <p data-testid="copy-empty" className="mt-3 text-xs" style={{ color: 'var(--ink-light)' }}>
            На прошлой неделе занятий нет — нечего копировать.
          </p>
        )}

        {source && (
          <>
            {!isEmpty && (
              <>
                {privateCount > 0 && (
                  <p data-testid="copy-private-hint" className="mt-2 text-xs" style={{ color: 'var(--ink-light)' }}>
                    {privateCount} индивидуальных занятий не копируются
                  </p>
                )}

                {source.total > source.items.length && (
                  <p data-testid="copy-cap-note" className="mt-2 text-xs" style={{ color: 'var(--ink-light)' }}>
                    {cappedNote(source.total)}
                  </p>
                )}

                <ul className="mt-3 space-y-1">
                  {locationEntries.map((entry) => (
                    <li key={entry.id}>
                      <label className="flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors hover:bg-surface cursor-pointer">
                        <input
                          data-testid={`copy-loc-${entry.id}`}
                          type="checkbox"
                          className="accent-[var(--brand)]"
                          checked={checkedIds.has(entry.id)}
                          onChange={() => toggleLocation(entry.id)}
                        />
                        <span className="flex-1 truncate" style={{ color: 'var(--ink)' }}>{entry.name}</span>
                        <span
                          data-testid={`copy-count-${entry.id}`}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface"
                          style={{ color: 'var(--ink-mid)' }}
                        >
                          {entry.toCopy}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button
              data-testid="copy-confirm"
              onClick={handleCopy}
              disabled={copyDisabled}
              className="mt-3 w-full rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {submitting ? 'Копирование…' : 'Скопировать'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
