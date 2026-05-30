'use client';

import { useState, useEffect } from 'react';
import { getLocations } from '@/app/lib/api/locations';
import { toLocationView } from '@/app/lib/mappers/to-location-vm';
import type { LocationView } from '@/app/lib/model/view/location';
import { ApiError } from '@/app/lib/errors';

export function useLocations() {
  const [locations, setLocations] = useState<LocationView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getLocations()
      .then((raw) => {
        if (!cancelled) {
          setLocations(raw.map(toLocationView));
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
