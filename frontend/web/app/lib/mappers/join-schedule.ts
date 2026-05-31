import type { ScheduleDTO } from '@/app/lib/model/dto/schedule';
import type { ActivityResponse, ServiceResponse, MasterResponse, LocationResponse } from '@memo/api-client';

export interface LocationIndex {
  byDate: Map<string, string[]>;
  byServiceId: Map<string, string[]>;
}

export interface ScheduleIndex {
  byId: Map<string, ScheduleDTO>;
  byLocation: Record<string, LocationIndex>;
}

function extractTime(iso: string): string {
  return iso.slice(11, 16); // "2026-06-01T10:00:00" → "10:00"
}

function extractDate(iso: string): string {
  return iso.slice(0, 10); // "2026-06-01T10:00:00" → "2026-06-01"
}

function computePriceHint(tariffs: { title: string; price: number }[]): string {
  return tariffs.map(t => `${t.title}: ${t.price}₽`).join(', ');
}

function buildTagSet(serviceTags: { tag: string }[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of serviceTags) {
    if (!seen.has(t.tag)) {
      seen.add(t.tag);
      result.push(t.tag);
    }
  }
  return result;
}

export function joinActivities(
  activities: ActivityResponse[],
  services: Map<string, ServiceResponse>,
  masters: Map<string, MasterResponse>,
  locations: Map<string, LocationResponse>,
): ScheduleIndex {
  const byId = new Map<string, ScheduleDTO>();
  const locationIds = new Set<string>();

  // Phase 1: Build all ScheduleDTOs
  for (const act of activities) {
    const service = services.get(act.service_id);
    const master = masters.get(act.master_id);
    const location = locations.get(act.location_id);

    if (!service || !master || !location) continue;

    const tariffs = service.tariffs ?? [];
    const prices = tariffs.map(t => t.price);
    const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
    const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

    const dto: ScheduleDTO = {
      id: act.id,
      title: service.title,
      tags: buildTagSet(service.tags ?? []),
      image_url: service.image_url || '',
      photos: [],
      time: extractTime(act.start),
      duration_minutes: act.duration,
      location_id: act.location_id,
      location_name: location.name,
      location_address: location.address ?? undefined,
      guests_count: act.occupied,
      material: service.material_hint?.split(',')[0]?.trim() ?? '',
      size: '',
      price_min: priceMin,
      price_max: priceMax,
      master_name: `${master.first_name} ${master.last_name}`,
      master_avatar: master.avatar_url ?? undefined,
      date: extractDate(act.start),
      price_hint: computePriceHint(tariffs),
      material_hint: service.material_hint ?? undefined,
      location_hint: location.location_hint ?? undefined,
    };

    byId.set(act.id, dto);
    locationIds.add(act.location_id);
  }

  // Phase 2: Build location indexes
  const allLocIds = ['all', ...Array.from(locationIds)];
  const byLocation: Record<string, LocationIndex> = {};

  allLocIds.forEach(locId => {
    byLocation[locId] = {
      byDate: new Map(),
      byServiceId: new Map(),
    };
  });

  byId.forEach((dto, id) => {
    const locKeys = ['all', dto.location_id];
    locKeys.forEach(locKey => {
      const idx = byLocation[locKey];

      // byDate
      const dateArr = idx.byDate.get(dto.date) ?? [];
      dateArr.push(id);
      idx.byDate.set(dto.date, dateArr);

      // byServiceId — use title as key
      const svcKey = dto.title;
      const svcArr = idx.byServiceId.get(svcKey) ?? [];
      svcArr.push(id);
      idx.byServiceId.set(svcKey, svcArr);
    });
  });

  // Phase 3: Compute next_times for each DTO
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  byId.forEach((dto, id) => {
    const locIdx = byLocation[dto.location_id];
    const svcIds = locIdx.byServiceId.get(dto.title) ?? [];

    const nextIds = svcIds
      .map(sid => byId.get(sid)!)
      .filter(a => a.id !== id && a.date >= todayStr && (a.date > dto.date || (a.date === dto.date && a.time > dto.time)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .slice(0, 6)
      .map(a => ({ id: a.id, date: a.date, time: a.time }));

    if (nextIds.length > 0) {
      dto.next_times = nextIds;
    }
  });

  return { byId, byLocation };
}
