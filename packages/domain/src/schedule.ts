// ─── Schedule DTOs ──────────────────────────────────────────────────────────
// These are plain TypeScript DTOs (not Zod schemas) for the unified Schedule
// data model shared between admin and web apps.

export interface ScheduleDTO {
  id: string;
  masterId: string;
  serviceId: string;
  locationId: string;
  masterName: string;
  serviceTitle: string;
  date: string; // YYYY-MM-DD extracted from ISO start
  time: string; // HH:MM extracted from ISO start
  durationMinutes: number;
  occupied: number;
  capacity: number;
  locationName: string;
  locationAddress?: string;
  locationHint?: string;
  /** Joined per-material display lines (GH #223 §9). Derived from service links in clients. */
  materialDetails?: string;
  priceMin: number;
  priceMax: number;
  priceHint?: string;
  image_url?: string;
  tags?: string[];
  masterAvatar?: string;
}

export interface ScheduleAdminDTO extends ScheduleDTO {
  day: number; // day index (Mon=0..Sun=6), for grid positioning
  startMinutes: number; // minutes from midnight, for grid positioning
  isPrivate: boolean;
  masterColor: string; // resolved from masters reference
  minAge: string; // resolved from services reference
  maxAge?: string; // resolved from services reference (null = no upper limit)
  comment: string; // required, empty string as default
}
