'use client';
import { useQuery } from '@tanstack/react-query';
import { getActivities } from '@memo/api-client';
import { transformActivity } from '@/lib/transformers';
import type { ActivityResponse } from '@memo/api-client';
import type { Activity } from '@memo/domain';

export function useActivities(weekStart: string, weekEnd: string) {
  return useQuery<ActivityResponse[], Error, Activity[]>({
    queryKey: ['activities', weekStart, weekEnd],
    queryFn: () => getActivities({ date_from: weekStart, date_to: weekEnd }),
    select: (raw) => raw.map(transformActivity),
  });
}
