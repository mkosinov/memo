'use client';

// DEPRECATED: use useSchedule() instead.
// This hook previously depended on mock getActivities() from lib/api/activities.
// Keeping the file to avoid breaking imports, but it now returns empty data.

import { useState } from 'react';
import type { ActivityView, ActivityFiltersView } from '@/app/lib/model/view/activity';
import { ApiError } from '@/app/lib/errors';

export interface UseActivitiesOptions {
  /** Polling interval in ms. Default: no polling */
  refetchInterval?: number;
}

export function useActivities(_filters?: ActivityFiltersView, _options?: UseActivitiesOptions) {
  const [activities] = useState<ActivityView[]>([]);
  const [isLoading] = useState(false);
  const [error] = useState<ApiError | null>(null);

  return { activities, isLoading, error };
}
