'use client';

import { useMemo } from 'react';
import type { ActivityView } from '@/app/lib/model/view/activity';

/** Pure filter function — testable, no React dependency */
export function filterActivities(
  activities: ActivityView[],
  date: string | null,
  location: string | null,
  tag: string | null,
): ActivityView[] {
  return activities.filter((a) => {
    if (date && a.date !== date) return false;
    if (location && a.location.id !== location) return false;
    if (tag && a.category !== tag) return false;
    return true;
  });
}

/**
 * Client-side filtering of activities by date, location, and tag.
 * Tag is filtered on client (not sent to API).
 */
export function useFilteredActivities(
  activities: ActivityView[],
  date: string | null,
  location: string | null,
  tag: string | null,
): ActivityView[] {
  return useMemo(
    () => filterActivities(activities, date, location, tag),
    [activities, date, location, tag],
  );
}
