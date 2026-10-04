import type { PhotosUrlStateView } from '@/app/(main)/photos/usePhotosUrlState';
import type { PhotosUrlAdapter } from '@/app/(main)/photos/usePhotosUrlState';

/**
 * Static URL-adapter stub for rendering the REAL PhotosProvider outside the
 * page (#349 Task 8 made urlState required — RecordsProvider precedent).
 * `update` is a no-op spy: the provider's optimistic mirror applies every
 * setter locally, which is exactly what context-level tests exercise.
 */
export function createPhotosUrlStateStub(
  overrides?: Partial<PhotosUrlStateView>,
): PhotosUrlAdapter {
  const state: PhotosUrlStateView = {
    search: '',
    tagIds: [],
    page: 1,
    perPage: 10,
    ...overrides,
  };
  const update = () => {};
  return { state, update };
}
