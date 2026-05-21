'use client';

import { useState, useEffect } from 'react';
import { getGallery } from '@/app/lib/api/gallery';
import { toGalleryPhotoViewModel } from '@/app/lib/transforms/to-gallery-vm';
import type { GalleryPhotoViewModel } from '@/app/lib/model/view/gallery';
import { ApiError } from '@/app/lib/errors';

export function useGallery(limit?: number) {
  const [photos, setPhotos] = useState<GalleryPhotoViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getGallery(limit)
      .then((raw) => {
        if (!cancelled) {
          setPhotos(raw.map(toGalleryPhotoViewModel));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err : new ApiError(String(err), 500));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { photos, isLoading, error };
}
