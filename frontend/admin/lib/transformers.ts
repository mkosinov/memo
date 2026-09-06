import type { Master, Service, Location } from '@memo/domain';
import type { MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { displayMasterName } from '@/lib/utils';

// ─── Transformers ───────────────────────────────────────────────────────────

export function transformMaster(raw: MasterResponse): Master {
  return {
    id: raw.id,
    name: displayMasterName(raw),
    shortName: raw.first_name,
    color: raw.color,
    specialty: raw.specialty,
    sortOrder: raw.sort_order ?? 0,
  };
}

export function transformService(raw: ServiceResponse): Service {
  return {
    id: raw.id,
    name: raw.title,
    durationMinutes: raw.duration,
    minAge: `${raw.min_age}`,
    maxAge: raw.max_age != null ? `${raw.max_age}` : undefined,
    tariffs: raw.tariffs ?? [],
    defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0,
    description: raw.description,
  };
}

export function transformLocation(raw: LocationResponse): Location {
  return {
    id: raw.id,
    name: raw.name,
    shortTitle: raw.short_title ?? undefined,
    address: raw.address ?? undefined,
    defaultCapacity: raw.capacity,
    sortOrder: raw.sort_order ?? 0,
  };
}
