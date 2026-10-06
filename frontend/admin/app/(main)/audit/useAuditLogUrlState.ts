'use client';

import { useCallback, useMemo } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';
import { ACTION_LABELS, ENTITY_LABELS } from './auditLabels';

// #349 Task 9 — audit page URL state (wave group 4). The page-scoped hook
// owns the journal's canonical params (user_id/action/entity/date_from/
// date_to + page/per_page) via the generic useTableUrlState, passed into
// AuditLogProvider as its urlState integration (managed mode, spec §3) —
// the staff precedent (wave group 3). Sorting is SERVER-FIXED
// (created_at DESC): sort_by/sort_order are deliberately NOT in the config
// (spec §5 п.7 — sort params are neither read from nor written to the URL).

/** Discrete action enum — the real journal vocabulary (auditLabels, spec §7). */
export const AUDIT_ACTION_VALUES = Object.keys(ACTION_LABELS);

/** Discrete entity enum — the 16 canonical #239 names (auditLabels). */
export const AUDIT_ENTITY_VALUES = Object.keys(ENTITY_LABELS);

/**
 * The hook config — page-scoped, memoized forever (one identity per mount).
 * Deviations from the records precedent (spec §2/§5 п.7): the period param
 * names are date_from/date_to (NOT the legacy from/to); the datePair
 * default is «не задано» (BOTH null — the journal ships no implicit range);
 * per_page default = 20 (the AuditLogContext factory default, not 10).
 */
export const auditLogUrlConfig = {
  user_id: { kind: 'string', maxLength: 64, defaultValue: '' },
  action: { kind: 'enum', values: AUDIT_ACTION_VALUES, defaultValue: '' },
  entity: { kind: 'enum', values: AUDIT_ENTITY_VALUES, defaultValue: '' },
  period: {
    kind: 'datePair',
    fromName: 'date_from',
    toName: 'date_to',
    // «Не задано» — unlike records' current-week function (spec §1 datePair).
    defaults: () => ({ from: null, to: null }),
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 20 },
} satisfies TableUrlConfig;

type AuditLogUrlState = TableUrlState<typeof auditLogUrlConfig>;

/**
 * The adapter's state view — the factory's vocabulary: the AuditLogFilters
 * contract (flat strings, '' = unset; the datePair pair is flattened into
 * date_from/date_to because the factory treats every non-canonical state
 * key as a structured filter).
 */
export interface AuditLogUrlStateView {
  user_id: string;
  action: string;
  entity: string;
  date_from: string; // YYYY-MM-DD ('' = unset)
  date_to: string;
  page: number;
  per_page: number;
}

export interface AuditLogUrlAdapter {
  state: AuditLogUrlStateView & Record<string, unknown>;
  update: (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => void;
}

/** Flat patch keys passed straight through to the URL config. */
const FLAT_KEYS = new Set(['user_id', 'action', 'entity', 'page', 'per_page']);

/**
 * Page-scoped URL adapter for /audit (#349 Task 9). Created INSIDE the
 * page's Suspense boundary, passed into AuditLogProvider as its urlState
 * integration. The only translation: the factory's flat date_from/date_to
 * strings ('' = unset) ↔ the datePair preset's {from, to} (null = absent).
 */
export function useAuditLogUrlState(): AuditLogUrlAdapter {
  const { state, update: urlUpdate } = useTableUrlState(auditLogUrlConfig);

  const periodFrom = state.period.from;
  const periodTo = state.period.to;

  const update = useCallback(
    (patch: Record<string, unknown>, options?: { history?: 'push' | 'replace' }) => {
      const urlPatch: Record<string, unknown> = {};
      // Untouched pair sides carry the CURRENT URL value (a partial patch
      // replaces the whole datePair object); '' means "clear this side".
      let from: string | null | undefined;
      let to: string | null | undefined;
      let hasPeriod = false;
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'date_from') {
          from = value === '' ? null : (value as string);
          hasPeriod = true;
        } else if (key === 'date_to') {
          to = value === '' ? null : (value as string);
          hasPeriod = true;
        } else if (FLAT_KEYS.has(key)) {
          urlPatch[key] = value;
        }
        // Unknown keys (sort/status/q…) are dropped defensively — the
        // journal never writes them.
      }
      if (hasPeriod) {
        // `!== undefined` (NOT ??): null IS a meaningful patch value — it
        // clears the side; ?? would swallow it back to the carried value.
        urlPatch.period = {
          from: from !== undefined ? from : periodFrom,
          to: to !== undefined ? to : periodTo,
        };
      }
      if (Object.keys(urlPatch).length > 0) {
        // Record-shaped patch → hook's config-typed patch: sanctioned cast
        // (the services/staff adapter precedent — the config owns every key).
        urlUpdate(urlPatch as Partial<AuditLogUrlState>, options);
      }
    },
    [urlUpdate, periodFrom, periodTo],
  );

  // Identity-stable on VALUES (the records-adapter precedent): the provider
  // reads the view each render; a spurious new identity would churn its
  // urlState-keyed effects without a URL change.
  return useMemo(
    () => ({
      state: {
        user_id: state.user_id,
        action: state.action,
        entity: state.entity,
        date_from: periodFrom ?? '',
        date_to: periodTo ?? '',
        page: state.page,
        per_page: state.per_page,
      },
      update,
    }),
    [
      state.user_id,
      state.action,
      state.entity,
      periodFrom,
      periodTo,
      state.page,
      state.per_page,
      update,
    ],
  );
}
