'use client';

import { useState, useEffect } from 'react';
import { getActivities } from '@/app/lib/api/activities';
import { toActivityViewModel } from '@/app/lib/transforms/to-activity-vm';
import type { ActivityViewModel, ActivityFilters } from '@/app/lib/model/view/activity';
import { ApiError } from '@/app/lib/errors';

export function useActivities(filters?: ActivityFilters) {
  const [activities, setActivities] = useState<ActivityViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getActivities(filters)
      .then((raw) => {
        if (!cancelled) {
          setActivities(raw.map(toActivityViewModel));
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
  }, [filters?.date, filters?.location, filters?.category]);

  return { activities, isLoading, error };
}
