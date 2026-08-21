'use client';

import { createPagedListContext } from './createPagedListContext';
import { getPhotos } from '@memo/api-client';
import type { PaginatedResponse, PhotoResponse } from '@memo/api-client';

// INTERIM CLIENT ADAPTER (#139 T7 → #211): the photos endpoint is UNPAGINATED
// (getPhotos(): Promise<PhotoResponse[]>), so this adapter builds the
// PaginatedResponse envelope client-side — fetch all, optionally sort
// (verbatim pre-#139 comparator), slice the requested page. The
// PagedListState contract seen by <DataTable> is server-shaped from day one,
// so #211 can swap the internals to true server pagination without touching
// the table layer.

const { Provider, usePagedList } = createPagedListContext<PhotoResponse>({
  queryKeyPrefix: 'photos',
  fetcher: async ({ page, per_page, sort_by, sort_order }): Promise<PaginatedResponse<PhotoResponse>> => {
    const all = await getPhotos();

    // Preserve today's client sort exactly (pre-#139 PhotosTable): strings
    // via localeCompare 'ru', booleans false-before-true on asc, other/null
    // values compare equal (stable → API order); asc only when picked.
    let rows = all;
    if (sort_by) {
      rows = [...all];
      rows.sort((a, b) => {
        const aVal = a[sort_by as keyof PhotoResponse];
        const bVal = b[sort_by as keyof PhotoResponse];
        let cmp = 0;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          cmp = aVal.localeCompare(bVal, 'ru');
        } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
          cmp = aVal === bVal ? 0 : aVal ? 1 : -1;
        }
        return sort_order === 'asc' ? cmp : -cmp;
      });
    }

    const start = (page - 1) * per_page;
    const items = rows.slice(start, start + per_page);
    return { items, total: all.length, page, per_page };
  },
  withStatus: false,
  // #139 T7 — dict search is predicate-only (spec §6.7): filters the loaded
  // page into `visibleItems`; `search` stays out of the query key/fetcher.
  // Filename-only match, per the pre-#139 table filter (PhotoResponse has no
  // title field — filename is the search field; case-insensitive includes).
  searchPredicate: (p, q) => p.filename.toLowerCase().includes(q.toLowerCase()),
});

export const PhotosProvider = Provider;
/** Table list state (client-paginated until #211). */
export const usePhotosTable = usePagedList;
