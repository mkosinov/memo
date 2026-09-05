'use client';
import { useQuery } from '@tanstack/react-query';
import { getActivities, getActivity, getRecords } from '@memo/api-client';
import { transformActivity } from '@/lib/transformers';
import type { ActivityResponse, RecordResponse } from '@memo/api-client';
import type { Activity } from '@memo/domain';
import { qk } from '@/lib/queryKeys';

export function useActivities(weekStart: string, weekEnd: string) {
  return useQuery<ActivityResponse[], Error, Activity[]>({
    queryKey: qk.activityRange(weekStart, weekEnd),
    queryFn: () => getActivities({ date_from: weekStart, date_to: weekEnd, per_page: 100 }).then(r => r.items),
    select: (raw) => raw.map(transformActivity),
  });
}

/** Single activity by id. */
export function useActivity(id: string | undefined) {
  return useQuery<ActivityResponse>({
    queryKey: qk.activity(id ?? ''),
    queryFn: () => getActivity(id!),
    enabled: !!id,
  });
}

/** All records of one activity (per_page 100 — current semantics). */
export function useActivityRecords(activityId: string | undefined, enabled = true) {
  return useQuery<RecordResponse[]>({
    queryKey: qk.activityRecords(activityId ?? ''),
    queryFn: () => getRecords({ activity_id: activityId!, per_page: 100 }).then((r) => r.items),
    enabled: !!activityId && enabled,
  });
}

/** Activities for a set of record ids (Promise.all bundle — current semantics). */
export function useActivitiesForRecords(recordActivityIds: string[]) {
  return useQuery<ActivityResponse[]>({
    queryKey: qk.activitiesForRecords(recordActivityIds),
    queryFn: () => Promise.all(recordActivityIds.map((id) => getActivity(id))),
    enabled: recordActivityIds.length > 0,
  });
}
