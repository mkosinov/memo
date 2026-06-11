import type { Activity, Master, Service, Location } from '@memo/domain';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

/**
 * Normalize JavaScript getDay() (0=Sun..6=Sat) to Mon=0..Sun=6.
 */
function normalizeDay(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/**
 * Extract day (Mon=0..Sun=6) and startTime (float hours) from an ISO datetime string.
 */
function parseStart(start: string): { day: number; startTime: number } {
  const d = new Date(start);
  return {
    day: normalizeDay(d.getDay()),
    startTime: d.getHours() + d.getMinutes() / 60,
  };
}

// ─── Transformers ───────────────────────────────────────────────────────────

export function transformActivity(raw: ActivityResponse): Activity {
  const { day, startTime } = parseStart(raw.start);
  return {
    id: raw.id,
    day,
    masterId: raw.master_id,
    startTime,
    duration: raw.duration / 60,
    durationMinutes: raw.duration,
    serviceId: raw.service_id,
    locationId: raw.location_id,
    occupied: raw.occupied,
    capacity: raw.capacity,
    isPrivate: raw.is_private,
    comment: raw.comment ?? undefined,
  };
}

export function transformMaster(raw: MasterResponse): Master {
  return {
    id: raw.id,
    name: `${raw.last_name} ${raw.first_name}`,
    shortName: raw.first_name,
    color: raw.color,
    specialty: raw.specialty,
  };
}

export function transformService(raw: ServiceResponse): Service {
  return {
    id: raw.id,
    name: raw.title,
    duration: raw.duration / 60,
    durationMinutes: raw.duration,
    maxCapacity: raw.max_age,
    minAge: `${raw.min_age}`,
    maxAge: `${raw.max_age}`,
    defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0,
    description: raw.description,
  };
}

export function transformLocation(raw: LocationResponse): Location {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address ?? undefined,
    defaultCapacity: raw.capacity,
  };
}
