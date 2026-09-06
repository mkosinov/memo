import type { ScheduleAdminDTO } from '@memo/domain';
import type { ScheduleIndex as DomainScheduleIndex } from '@memo/domain';
import { buildSchedule } from '@memo/domain';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { parseLocalISO } from '@/lib/datetime';

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

    const { date, time, startMinutes } = parseLocalISO(act.start);

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
      startMinutes,
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
