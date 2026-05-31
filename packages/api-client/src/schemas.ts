import { z } from 'zod';

// ─── MasterResponse ────────────────────────────────────────────────────────

export const MasterResponseSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  color: z.string(),
  position: z.string(),
  specialty: z.string(),
  avatar_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(), // ISO datetime string
  updated_at: z.string(), // ISO datetime string
});

export type MasterResponse = z.infer<typeof MasterResponseSchema>;

// ─── LocationResponse ──────────────────────────────────────────────────────

export const LocationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  description: z.string().nullable(),
  capacity: z.number(),
  yandex_map_url: z.string().nullable(),
  review_url: z.string().nullable(),
  record_info: z.string().nullable(),
  image_url: z.string().nullable(),
  location_hint: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(), // ISO datetime string
  updated_at: z.string(), // ISO datetime string
});

export type LocationResponse = z.infer<typeof LocationResponseSchema>;

// ─── PhotoResponse ──────────────────────────────────────────────────────────

export const PhotoResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  visitor_id: z.string().nullable(),
  service_id: z.string().nullable(),
  activity_id: z.string().nullable(),
  is_public: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type PhotoResponse = z.infer<typeof PhotoResponseSchema>;

// ─── TariffResponse (nested in ServiceResponse) ────────────────────────────

export const TariffResponseSchema = z.object({
  id: z.string(),
  service_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  price: z.number(),
});

export type TariffResponse = z.infer<typeof TariffResponseSchema>;

// ─── TagResponse (nested in ServiceResponse) ───────────────────────────────

export const TagResponseSchema = z.object({
  id: z.string(),
  tag: z.string(),
});

export type TagResponse = z.infer<typeof TagResponseSchema>;

// ─── ServiceResponse ───────────────────────────────────────────────────────

export const ServiceResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  image_url: z.string(),
  specialty: z.string(),
  min_age: z.number(),
  max_age: z.number(),
  duration: z.number(),
  record_info: z.string(),
  material_hint: z.string().nullable().optional(),
  tariffs: z.array(TariffResponseSchema),
  tags: z.array(TagResponseSchema),
  is_active: z.boolean(),
  created_at: z.string(), // ISO datetime string
  updated_at: z.string(), // ISO datetime string
});

export type ServiceResponse = z.infer<typeof ServiceResponseSchema>;

// ─── ActivityCreate (request body — no id, created_at, updated_at, is_active, occupied) ─
// Fields with backend defaults use .optional() — the backend handles default logic.

export const ActivityCreateSchema = z.object({
  master_id: z.string(),
  service_id: z.string(),
  location_id: z.string(),
  start: z.string(), // ISO datetime string
  duration: z.number(),
  capacity: z.number(),
  is_private: z.boolean().optional(),
  comment: z.string().nullable().optional(),
  record_info: z.string().nullable().optional(),
});

export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

// ─── ActivityResponse ──────────────────────────────────────────────────────
// Defined independently (not via extend) to keep output types clean.

export const ActivityResponseSchema = z.object({
  id: z.string(),
  master_id: z.string(),
  service_id: z.string(),
  location_id: z.string(),
  start: z.string(), // ISO datetime string
  duration: z.number(),
  capacity: z.number(),
  is_private: z.boolean(),
  comment: z.string().nullable(),
  record_info: z.string().nullable(),
  created_at: z.string(), // ISO datetime string
  updated_at: z.string(), // ISO datetime string
  is_active: z.boolean(),
  occupied: z.number(),
});

export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
