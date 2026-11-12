'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPublicPhotos } from '@memo/api-client';
import { toGalleryPhotoView } from '@/app/lib/mappers/to-gallery-vm';
import type { GalleryPhotoView } from '@/app/lib/model/view/gallery';

export interface UseServicePhotosResult {
  photos: GalleryPhotoView[];
  isLoading: boolean;
  error: Error | null;
}

/** Service photo strip (GH #576, spec §6.4): ONE getPublicPhotos call
 * scoped by service_id — same route, mapper and allowlist as useGallery
 * (#493, ADR-015), on the ['photos', 'public', 'service', id] cache;
 * the prefix link with the gallery's ['photos', 'public'] family is
 * intentional. Empty list on empty response and on error — the strip
 * hides, the cover is never blocked. No fallback: one data group. */
export function useServicePhotos(serviceId: string): UseServicePhotosResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['photos', 'public', 'service', serviceId],
    queryFn: () => getPublicPhotos({ service_id: serviceId, per_page: 20 }),
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
