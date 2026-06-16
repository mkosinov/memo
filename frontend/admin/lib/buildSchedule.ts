import type { Activity, Service, ScheduleAdminDTO } from '@memo/domain';
import type { ScheduleIndex as DomainScheduleIndex } from '@memo/domain';
import { buildSchedule } from '@memo/domain';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

export interface ScheduleItem extends Activity {
  serviceName: string;
  minAge: string;
  maxAge?: string;
}

export interface ActivityIndex {
  byDate: Map<string, ScheduleItem[]>;   // key: YYYY-MM-DD ISO date
  byMasterId: Map<string, ScheduleItem[]>;
  byLocationId: Map<string, ScheduleItem[]>;
}

export interface ScheduleIndex {
  byId: Map<string, ScheduleItem>;
  index: ActivityIndex;
  byLocation: Record<string, ActivityIndex>;
}

function dayToDate(monday: Date, day: number): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayOfMonth}`;
}

function addToActivityIndex(idx: ActivityIndex, activity: ScheduleItem, monday: Date): void {
  // byDate — key is YYYY-MM-DD ISO date
  const dateKey = dayToDate(monday, activity.day);
  const dateArr = idx.byDate.get(dateKey) ?? [];
  dateArr.push(activity);
  idx.byDate.set(dateKey, dateArr);

  // byMasterId (uses masterId as key)
  const masterArr = idx.byMasterId.get(activity.masterId) ?? [];
  masterArr.push(activity);
  idx.byMasterId.set(activity.masterId, masterArr);

  // byLocationId
  const locArr = idx.byLocationId.get(activity.locationId) ?? [];
  locArr.push(activity);
  idx.byLocationId.set(activity.locationId, locArr);
}

export function toScheduleIndex(activities: ScheduleItem[], monday: Date): ScheduleIndex {
  const byId = new Map<string, ScheduleItem>();
  const allIndex: ActivityIndex = {
    byDate: new Map(),
    byMasterId: new Map(),
    byLocationId: new Map(),
  };
  const byLocation: Record<string, ActivityIndex> = {};

  for (const activity of activities) {
    byId.set(activity.id, activity);

    // Add to 'all' index
    addToActivityIndex(allIndex, activity, monday);

    // Add to per-location index (lazy init)
    if (!byLocation[activity.locationId]) {
      byLocation[activity.locationId] = {
        byDate: new Map(),
        byMasterId: new Map(),
        byLocationId: new Map(),
      };
    }
    addToActivityIndex(byLocation[activity.locationId], activity, monday);
  }

  // Ensure 'all' key always exists
  byLocation['all'] = allIndex;

  return { byId, index: allIndex, byLocation };
}

export function toScheduleItems(
  activities: Activity[],
  services: Service[],
): ScheduleItem[] {
  const serviceMap = new Map(services.map(s => [s.id, s]));

  return activities.map(activity => {
    const service = serviceMap.get(activity.serviceId);
    return {
      ...activity,
      serviceName: activity.serviceName || service?.name || '',
      minAge: activity.minAge || service?.minAge || '',
      maxAge: activity.maxAge ?? service?.maxAge,
    };
  });
}

// ─── buildAdminSchedule ──────────────────────────────────────────────────────

/**
 * Compute day index (Mon=0..Sun=6) from a YYYY-MM-DD date and the week Monday.
 */
function dateToDayIndex(dateStr: string, monday: Date): number {
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d.getTime() - monday.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function computePriceHint(tariffs: { title: string; price: number }[]): string {
  return tariffs.map(t => `${t.title}: ${t.price}₽`).join(', ');
}

export function buildAdminSchedule(
  activities: ActivityResponse[],
  masters: MasterResponse[],
  services: ServiceResponse[],
  locations: LocationResponse[],
  weekMonday: Date,
): { index: DomainScheduleIndex<ScheduleAdminDTO>; items: ScheduleAdminDTO[] } {
  const masterMap = new Map(masters.map(m => [m.id, m]));
  const serviceMap = new Map(services.map(s => [s.id, s]));
  const locationMap = new Map(locations.map(l => [l.id, l]));

  const items: ScheduleAdminDTO[] = [];

  for (const act of activities) {
    const master = masterMap.get(act.master_id);
    const service = serviceMap.get(act.service_id);
    const location = locationMap.get(act.location_id);

    if (!master || !service || !location) continue;

    const date = act.start.slice(0, 10);       // YYYY-MM-DD from ISO start
    const time = act.start.slice(11, 16);      // HH:MM from ISO start

    const tariffs = service.tariffs ?? [];
    const prices = tariffs.map(t => t.price);
    const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
    const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

    const item: ScheduleAdminDTO = {
      id: act.id,
      masterId: act.master_id,
      serviceId: act.service_id,
      locationId: act.location_id,
      masterName: `${master.first_name} ${master.last_name}`,
      serviceTitle: service.title,
      date,
      time,
      durationMinutes: act.duration,
      day: dateToDayIndex(date, weekMonday),
      startTime: parseInt(time.slice(0, 2)) + parseInt(time.slice(3, 5)) / 60,
      occupied: act.occupied,
      capacity: act.capacity,
      locationName: location.name,
      locationAddress: location.address ?? undefined,
      locationHint: location.location_hint ?? undefined,
      materialHint: service.material_hint ?? undefined,
      priceMin,
      priceMax,
      priceHint: computePriceHint(tariffs),
      image_url: service.image_url || '',
      tags: service.tags?.map(t => t.tag) ?? [],
      masterAvatar: master.avatar_url ?? undefined,
      // Admin-specific fields:
      isPrivate: act.is_private,
      masterColor: master.color,
      minAge: `${service.min_age}`,
      maxAge: service.max_age != null ? `${service.max_age}` : undefined,
      comment: act.comment ?? '',
    };

    items.push(item);
  }

  const index = buildSchedule(items, {
    getDateKey: item => item.date,
  });

  return { index, items };
}
