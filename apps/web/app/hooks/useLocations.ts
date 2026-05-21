'use client';

import { useState, useEffect } from 'react';
import { getLocations } from '@/app/lib/api/locations';
import { toLocationViewModel } from '@/app/lib/transforms/to-location-vm';
import type { LocationViewModel } from '@/app/lib/model/view/location';
import { ApiError } from '@/app/lib/errors';

export function useLocations() {
  const [locations, setLocations] = useState<LocationViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getLocations()
      .then((raw) => {
        if (!cancelled) {
          setLocations(raw.map(toLocationViewModel));
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
  }, []);

  return { locations, isLoading, error };
}
