'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPublicPhotos } from '@memo/api-client';
import { toGalleryPhotoView } from '@/app/lib/mappers/to-gallery-vm';
import type { GalleryPhotoView } from '@/app/lib/model/view/gallery';

export interface UseGalleryResult {
  photos: GalleryPhotoView[];
  isLoading: boolean;
  error: Error | null;
}

/** Public photos via the dedicated public route (GH #493, ADR-015):
 * getPublicPhotos({ per_page: 12 }) → /api/v1/public/photos — not
 * getPhotos({ is_public: true }) — on the ['photos', 'public']
 * react-query cache; same stale/gc policy as useLocations/useSchedule. */
export function useGallery(): UseGalleryResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['photos', 'public'],
    queryFn: () => getPublicPhotos({ per_page: 12 }),
    staleTime: 300_000,
    gcTime: 600_000,
  });

  const photos = useMemo(
    () =>
      (data?.items ?? [])
        .map(toGalleryPhotoView)
        .filter((photo): photo is GalleryPhotoView => photo !== null),
    [data],
  );

  return { photos, isLoading, error };
}
