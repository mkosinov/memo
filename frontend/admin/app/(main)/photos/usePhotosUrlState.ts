'use client';

import { useCallback, useMemo } from 'react';
import { useTableUrlState } from '@/hooks/useTableUrlState';
import type { TableUrlConfig, TableUrlState } from '@/hooks/useTableUrlState';

// #349 Task 8 — photos page URL state (wave group 3). Spec §5 п.6: the
// photos URL contract is q + tag_id (REPEATABLE array — ?tag_id=1&tag_id=2)
// + page + per_page (the table has a page-size selector). Sort and the id
// filters (client/activity/service/location) are NOT part of the contract —
// they stay PhotosContext-local state.

/** Spec §5: the tag array is capped at 20 elements. */
export const PHOTOS_TAG_ID_MAX = 20;

/**
 * Per-element tag id validation: slug/uuid charset, ≤64 chars (the same
 * length budget as the records id params). Invalid elements are dropped by
 * the hook's normalizeArray; the dirty URL is never rewritten on read.
 */
export function isValidTagId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export const photosUrlConfig = {
  q: { kind: 'string', maxLength: 200, defaultValue: '' },
  tag_id: {
    kind: 'arrayOf',
    maxItems: PHOTOS_TAG_ID_MAX,
    defaultValue: [],
    validate: isValidTagId,
  },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100] as const, defaultValue: 10 },
} satisfies TableUrlConfig;

/** The adapter's state view — camelCase, consumed by PhotosProvider. */
export interface PhotosUrlStateView {
  search: string;
  tagIds: string[];
  page: number;
  perPage: number;
}

/** camelCase patch (the context's vocabulary) — translated to URL keys. */
export interface PhotosUrlPatch {
  search?: string;
  tagIds?: string[];
  page?: number;
  perPage?: number;
}

export interface PhotosUrlAdapter {
  state: PhotosUrlStateView;
  update: (patch: PhotosUrlPatch, options?: { history?: 'push' | 'replace' }) => void;
}

/** camelCase patch key → URL config key. */
const URL_KEY_OF = {
  search: 'q',
  tagIds: 'tag_id',
  page: 'page',
  perPage: 'per_page',
} as const;

/**
 * Page-scoped URL adapter for /photos (#349 Task 8). Created INSIDE the
 * page's Suspense boundary, passed into PhotosProvider as its urlState
 * integration — the ONE useTableUrlState instance on the /photos URL
 * (RecordsProvider precedent). State identity is stable BY VALUES.
 */
export function usePhotosUrlState(): PhotosUrlAdapter {
  const { state, update: urlUpdate } = useTableUrlState(photosUrlConfig);

  const update = useCallback(
    (patch: PhotosUrlPatch, options?: { history?: 'push' | 'replace' }) => {
      const urlPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        const urlKey = URL_KEY_OF[key as keyof typeof URL_KEY_OF];
        // Unknown keys are dropped defensively.
        if (urlKey !== undefined) urlPatch[urlKey] = value;
      }
      if (Object.keys(urlPatch).length > 0) {
        // Enum-typed urlPatch → hook patch inversion: sanctioned cast —
        // the records adapter (useRecordsUrlState) set the precedent.
        urlUpdate(urlPatch as never, options);
      }
    },
    [urlUpdate],
  );

  const { q, tag_id, page, per_page } = state as TableUrlState<typeof photosUrlConfig>;
  // Primitive signature of the tag array: valid elements match
  // /^[A-Za-z0-9_-]{1,64}$/ (isValidTagId) — comma-free by validation, so
  // the join is collision-free and value-equal arrays collapse to ONE dep.
  const tagSignature = tag_id.join(',');
  return useMemo(
    () => ({
      state: { search: q, tagIds: tag_id, page, perPage: per_page },
      update,
    }),
    // Identity-stable on VALUES (useRecordsUrlState precedent): the raw
    // hook state is rebuilt EVERY render (params.getAll allocates a fresh
    // array for a present tag_id), but PhotosProvider's mirror effect keys
    // on this state's identity — a per-render fresh array would read as a
    // "new" state while the URL didn't change. The deps cover every field
    // BY VALUE (tagSignature above); raw `tag_id` would churn per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value-keyed memo
    [q, tagSignature, page, per_page, update],
  );
}
