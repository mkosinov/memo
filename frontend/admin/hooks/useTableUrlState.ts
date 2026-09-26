'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// #349: URL as source of truth for admin table pages
// (?status=&search=&page=&per_page=&sort_by=&sort_order=&date_from=&date_to=&tag_id=).
// Read: state derived synchronously from the URL with silent per-preset
// fallbacks (the dirty URL is never rewritten on read). Write: update() is
// the single writer — atomic batch, rapid writes coalesced into one
// navigation per ~16ms frame, default values stripped, unmanaged params
// preserved, { scroll: false } everywhere.

/** Coalescing window (ms): rapid update() calls merge into one navigation. */
const COALESCE_MS = 16;

export interface EnumPreset {
  kind: 'enum';
  values: readonly (string | number)[];
  defaultValue: string | number;
  /**
   * State key this param depends on (e.g. sort_order requires sort_by):
   * the dependent is honored only while the requirement is non-default.
   */
  requires?: string;
}

export interface IntPreset {
  kind: 'int';
  min: number;
  max: number;
  defaultValue: number;
}

export interface StringPreset {
  kind: 'string';
  maxLength: number;
  defaultValue: string;
}

export interface DatePairPreset {
  kind: 'datePair';
  fromName: string;
  toName: string;
  /** Default range — a function ("current week" for records, nulls for journal). */
  defaults: () => { from: string | null; to: string | null };
}

export interface ArrayOfPreset {
  kind: 'arrayOf';
  maxItems: number;
  /**
   * Only the empty array is a valid default (the sole "absent" state):
   * serialize strips empty arrays to nothing, so a non-empty default could
   * never round-trip through the URL. Non-empty defaults are intentionally
   * unsupported (YAGNI — no consumer needs one).
   */
  defaultValue: readonly [];
  /** Per-element validation; invalid elements are dropped. */
  validate?: (value: string) => boolean;
}

export type TableUrlPreset = EnumPreset | IntPreset | StringPreset | DatePairPreset | ArrayOfPreset;

export type TableUrlConfig = Record<string, TableUrlPreset>;

export interface DateRange {
  from: string | null;
  to: string | null;
}

export type PresetValue<P> = P extends { kind: 'datePair' }
  ? DateRange
  : P extends { kind: 'int' }
    ? number
    : P extends { kind: 'arrayOf' }
      ? string[]
      : P extends { kind: 'string' }
        ? string
        : P extends { defaultValue: infer D }
          ? D
          : never;

export type TableUrlState<C extends TableUrlConfig> = {
  [K in keyof C]: PresetValue<C[K]>;
};

export interface UpdateOptions {
  /** 'replace' for service corrections (e.g. page clamp) — no history step. */
  history?: 'push' | 'replace';
}

/** Strict `YYYY-MM-DD` AND a real calendar date. Anything else → null. */
function parseDateKey(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Reject rollovers like 2026-02-31 (Date would silently land in March)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return raw;
}

/** Drop empty/invalid elements, dedup keeping first occurrence, cap length. */
function normalizeArray(values: string[], preset: ArrayOfPreset): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (preset.validate && !preset.validate(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= preset.maxItems) break;
  }
  return out;
}

/** URL param names a config entry owns (datePair owns two). */
function urlNamesOf(key: string, preset: TableUrlPreset): string[] {
  return preset.kind === 'datePair' ? [preset.fromName, preset.toName] : [key];
}

function readPreset(key: string, preset: TableUrlPreset, params: URLSearchParams): unknown {
  switch (preset.kind) {
    case 'enum': {
      const raw = params.get(key);
      if (raw === null) return preset.defaultValue;
      const match = preset.values.find((value) => String(value) === raw);
      return match !== undefined ? match : preset.defaultValue;
    }
    case 'int': {
      const raw = params.get(key);
      if (raw === null || !/^-?\d+$/.test(raw)) return preset.defaultValue;
      return Math.min(preset.max, Math.max(preset.min, Number(raw)));
    }
    case 'string': {
      const raw = params.get(key);
      if (raw === null || raw.length > preset.maxLength) return preset.defaultValue;
      return raw;
    }
    case 'datePair': {
      const from = parseDateKey(params.get(preset.fromName));
      const to = parseDateKey(params.get(preset.toName));
      if (from !== null && to !== null && from > to) return { from: null, to: null };
      // Both sides absent → configured default; partial change keeps the
      // missing side null.
      if (from === null && to === null) return preset.defaults();
      return { from, to };
    }
    case 'arrayOf': {
      if (params.get(key) === null) return preset.defaultValue;
      return normalizeArray(params.getAll(key), preset);
    }
  }
}

/** Does `value` equal the preset's default? (for `requires` linkage) */
function isDefaultPresetValue(preset: TableUrlPreset, value: unknown): boolean {
  switch (preset.kind) {
    case 'enum':
    case 'int':
    case 'string':
      return value === preset.defaultValue;
    case 'arrayOf':
      // Type-guaranteed default is [] — an empty array IS the default state.
      return (value as string[]).length === 0;
    case 'datePair': {
      const range = value as DateRange;
      const defaults = preset.defaults();
      return range.from === defaults.from && range.to === defaults.to;
    }
  }
}

/** Derive the full state from URL params with silent fallbacks. */
function readState(config: TableUrlConfig, params: URLSearchParams): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const [key, preset] of Object.entries(config)) {
    state[key] = readPreset(key, preset, params);
  }
  // Dependency linkage: an orphan dependent (requirement absent or at its
  // default, e.g. ?sort_order without a meaningful ?sort_by) is ignored.
  for (const [key, preset] of Object.entries(config)) {
    if (preset.kind === 'enum' && preset.requires !== undefined) {
      const required = config[preset.requires];
      if (required && isDefaultPresetValue(required, state[preset.requires])) {
        state[key] = preset.defaultValue;
      }
    }
  }
  return state;
}

/**
 * Serialize the managed state back to params: defaults are stripped, the
 * dependent of an unsatisfied `requires` is not written, unmanaged params
 * from the base pass through untouched.
 */
function serialize(
  config: TableUrlConfig,
  state: Record<string, unknown>,
  baseParams: URLSearchParams,
): URLSearchParams {
  const managed = new Set<string>();
  for (const [key, preset] of Object.entries(config)) {
    for (const name of urlNamesOf(key, preset)) managed.add(name);
  }

  const params = new URLSearchParams();
  // Unmanaged params (e.g. ?clientId=) are preserved as-is.
  for (const [key, value] of Array.from(baseParams.entries())) {
    if (!managed.has(key)) params.append(key, value);
  }

  for (const [key, preset] of Object.entries(config)) {
    const value = state[key];
    switch (preset.kind) {
      case 'enum': {
        if (value === preset.defaultValue) break;
        if (preset.requires !== undefined) {
          const required = config[preset.requires];
          if (required && isDefaultPresetValue(required, state[preset.requires])) break;
        }
        params.set(key, String(value));
        break;
      }
      case 'int':
      case 'string': {
        if (value === preset.defaultValue) break; // '' default → never written
        params.set(key, String(value));
        break;
      }
      case 'datePair': {
        const range = value as DateRange;
        const defaults = preset.defaults();
        if (range.from === defaults.from && range.to === defaults.to) break;
        if (range.from !== null) params.set(preset.fromName, range.from);
        if (range.to !== null) params.set(preset.toName, range.to);
        break;
      }
      case 'arrayOf': {
        const items = value as string[];
        // The only default is [] (type-enforced) → empty array → param absent.
        if (items.length === 0) break;
        for (const item of normalizeArray(items, preset)) params.append(key, item);
        break;
      }
    }
  }
  return params;
}

interface PendingUpdate {
  patch: Record<string, unknown>;
  history: 'push' | 'replace';
}

/**
 * Single read/write point for a table page's URL state.
 *
 * `state` — values of all config params derived from the URL synchronously
 * at render; invalid values silently fall back to defaults. `update(patch)`
 * — the only writer: applies the patch atomically (one navigation), strips
 * values equal to defaults, preserves unmanaged params, resets `page` to 1
 * when a filter changes in the same batch, and coalesces rapid calls into
 * a single router.push within one ~16ms frame. Consumed inside a Suspense
 * boundary (useSearchParams).
 */
export function useTableUrlState<C extends TableUrlConfig>(config: C): {
  state: TableUrlState<C>;
  update: (patch: Partial<TableUrlState<C>>, options?: UpdateOptions) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Latest values for the scheduled flush — the flush may run after a
  // re-render, so it must not close over stale render-time objects.
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const configRef = useRef(config);
  configRef.current = config;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  /**
   * Params of the last write, kept until the router state catches up.
   * Sequential writes build on it instead of the stale render snapshot.
   * Scope: one hook instance per URL (per-table-per-page); two instances
   * on one URL would clobber each other's writes.
   */
  const latestParamsRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingUpdate | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const state = readState(config, searchParams) as TableUrlState<C>;

  // A committed navigation re-renders with fresh searchParams — adopt them
  // as the new base (a stale ref from before the navigation must not win).
  // Idempotent and StrictMode-safe (assigning the same value twice is a
  // no-op). Known limitation: a discarded concurrent render could
  // prematurely clear the write base — theoretical only, admin tables use
  // no transitions.
  const searchParamsKey = searchParams.toString();
  if (latestParamsRef.current !== null && latestParamsRef.current !== searchParamsKey) {
    latestParamsRef.current = null;
  }

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    timerRef.current = null;
    if (!pending) return;

    const cfg = configRef.current;
    const base = latestParamsRef.current ?? searchParamsRef.current.toString();
    const baseParams = new URLSearchParams(base);
    const current = readState(cfg, baseParams);
    const next: Record<string, unknown> = { ...current, ...pending.patch };

    // Architect-approved (spec §3): a filter change (any key except `page`)
    // must reset page→1 in the SAME navigation — enforced here at hook level
    // so non-factory consumers (records, photos) inherit it for free.
    // Explicit `page` in the patch always wins over the auto-reset.
    const touchedFilters = Object.keys(pending.patch).some((key) => key !== 'page');
    const pagePreset = cfg.page;
    if (touchedFilters && !('page' in pending.patch) && pagePreset?.kind === 'int') {
      next.page = pagePreset.defaultValue;
    }

    const params = serialize(cfg, next, baseParams);
    const query = params.toString();
    // No-op guard: patch serializes to the URL already in the address bar →
    // skip the router call entirely (a redundant push would create a
    // duplicate history entry for a zero-change interaction).
    if (query === base) {
      latestParamsRef.current = query;
      return;
    }
    latestParamsRef.current = query;
    const url = query ? `${pathnameRef.current}?${query}` : pathnameRef.current;
    if (pending.history === 'replace') {
      routerRef.current.replace(url, { scroll: false });
    } else {
      routerRef.current.push(url, { scroll: false });
    }
  }, []);

  const update = useCallback(
    (patch: Partial<TableUrlState<C>>, options?: UpdateOptions) => {
      const pending = pendingRef.current ?? { patch: {}, history: 'push' as const };
      pending.patch = { ...pending.patch, ...patch };
      // History precedence within a coalesced batch: `replace` wins over
      // `push` — a service correction must not mutate into a history step
      // (extra back-button entry) just because it races a user write.
      if (pending.history !== 'replace') {
        pending.history = options?.history ?? 'push';
      }
      pendingRef.current = pending;
      if (timerRef.current === null) {
        timerRef.current = setTimeout(flush, COALESCE_MS);
      }
    },
    [flush],
  );

  // A cancelled frame must not navigate after unmount.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      pendingRef.current = null;
    },
    [],
  );

  return { state, update };
}
