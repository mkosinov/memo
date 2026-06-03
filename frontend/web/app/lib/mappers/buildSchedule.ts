import { ScheduleDTO, buildSchedule, resolveById } from '@memo/domain';
import type { ScheduleIndex } from '@memo/domain';
import type { ActivityResponse, ServiceResponse, MasterResponse, LocationResponse } from '@memo/api-client';
import type { PhotoDTO } from '@/app/lib/model/dto/schedule';

// ─── Re-export for backward compatibility ──────────────────────────────────
export type { ScheduleIndex } from '@memo/domain';

// ─── Web-specific extension ────────────────────────────────────────────────
export interface WebScheduleDTO extends ScheduleDTO {
  photos: PhotoDTO[];
  material: string;
  size: string;
}

// ─── Helper functions ──────────────────────────────────────────────────────

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

// ─── Main builder ──────────────────────────────────────────────────────────

export function buildWebSchedule(
  activities: ActivityResponse[],
  services: Map<string, ServiceResponse>,
  masters: Map<string, MasterResponse>,
  locations: Map<string, LocationResponse>,
) {
  // Phase 1: Build all WebScheduleDTOs
  const dtos: WebScheduleDTO[] = [];

  for (const act of activities) {
    const service = services.get(act.service_id);
    const master = masters.get(act.master_id);
    const location = locations.get(act.location_id);

    if (!service || !master || !location) continue;

    const tariffs = service.tariffs ?? [];
    const prices = tariffs.map(t => t.price);
    const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
    const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

    const dto: WebScheduleDTO = {
      // Domain fields
      id: act.id,
      masterId: act.master_id,
      serviceId: act.service_id,
      locationId: act.location_id,
      masterName: `${master.first_name} ${master.last_name}`,
      serviceTitle: service.title,
      date: extractDate(act.start),
      time: extractTime(act.start),
      durationMinutes: act.duration,
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
      tags: buildTagSet(service.tags ?? []),
      masterAvatar: master.avatar_url ?? undefined,
      // Web-only fields
      photos: [],
      material: service.material_hint?.split(',')[0]?.trim() ?? '',
      size: '',
    };

    dtos.push(dto);
  }

  // Phase 2: Build generic schedule index
  const index = buildSchedule(dtos, {
    getDateKey: item => item.date,
    getServiceKey: item => item.serviceTitle,
  });

  // Phase 3: nextTimes post-processing
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  for (const dto of dtos) {
    const locIdx = index.byLocation[dto.locationId];
    if (!locIdx) continue;
    const svcIds = locIdx.byServiceId.get(dto.serviceTitle) ?? [];
    const nextIds = svcIds
      .map(sid => index.byId.get(sid)!)
      .filter(a => a.id !== dto.id && a.date >= todayStr && (a.date > dto.date || (a.date === dto.date && a.time > dto.time)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .slice(0, 6)
      .map(a => ({ id: a.id, date: a.date, time: a.time }));
    if (nextIds.length > 0) {
      (dto as unknown as Record<string, unknown>).nextTimes = nextIds;
    }
  }

  return index;
}

export { resolveById };
