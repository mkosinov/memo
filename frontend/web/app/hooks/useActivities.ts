'use client';

import { useState, useEffect } from 'react';
import { getActivities } from '@/app/lib/api/activities';
import { toActivityView } from '@/app/lib/mappers/to-activity-vm';
import type { ActivityView, ActivityFiltersView } from '@/app/lib/model/view/activity';
import { ApiError } from '@/app/lib/errors';

export interface UseActivitiesOptions {
  /** Polling interval in ms. Default: no polling */
  refetchInterval?: number;
}

export function useActivities(filters?: ActivityFiltersView, options?: UseActivitiesOptions) {
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const fetchData = () => {
      getActivities(filters)
        .then((raw) => {
          if (!cancelled) {
            setActivities(raw.map(toActivityView));
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
    };

    setIsLoading(true);
    setError(null);
    fetchData();

    if (options?.refetchInterval && options.refetchInterval > 0) {
      intervalId = setInterval(fetchData, options.refetchInterval);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [
    filters?.date,
    filters?.dateStart,
    filters?.dateEnd,
    filters?.location,
    options?.refetchInterval,
  ]);

  return { activities, isLoading, error };
}
