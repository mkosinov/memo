'use client';

import { useState, useEffect } from 'react';
import { getLocations as fetchLocations } from '@memo/api-client';
import { toLocationViewFromResponse } from '@/app/lib/mappers/to-location-vm';
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

    // Real locations via api-client (GH #491): the former in-repo mock list
    // hardcoded the pre-UUID seed ids and stopped matching real rows once
    // the seed switched to UUID ids.
    fetchLocations()
      .then((page) => {
        if (!cancelled) {
          setLocations(page.items.map(toLocationViewFromResponse));
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
