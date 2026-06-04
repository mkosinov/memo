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

// ─── VisitorResponse ─────────────────────────────────────────────────────

export const VisitorResponseSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  name: z.string(),
  age: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type VisitorResponse = z.infer<typeof VisitorResponseSchema>;

// ─── VisitResponse ─────────────────────────────────────────────────────────

export const VisitResponseSchema = z.object({
  id: z.string(),
  record_id: z.string(),
  visitor_id: z.string(),
  price: z.number(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type VisitResponse = z.infer<typeof VisitResponseSchema>;

// ─── RecordResponse ────────────────────────────────────────────────────────

export const RecordResponseSchema = z.object({
  id: z.string(),
  activity_id: z.string(),
  client_id: z.string().nullable(),
  status: z.string(),
  seats: z.number(),
  comment: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
  visits: z.array(VisitResponseSchema),
});

export type RecordResponse = z.infer<typeof RecordResponseSchema>;

// ─── ClientResponse ────────────────────────────────────────────────────────

export const ClientResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  channel: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type ClientResponse = z.infer<typeof ClientResponseSchema>;

// ─── ClientCreate (request body) ──────────────────────────────────────────

export const ClientCreateSchema = z.object({
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
  channel: z.string().optional(),
});

export type ClientCreate = z.infer<typeof ClientCreateSchema>;

// ─── ClientWithStats ────────────────────────────────────────────────────────

export const ClientWithStatsSchema = ClientResponseSchema.extend({
  visits_count: z.number(),
  last_visit: z.string().nullable(),
  total_paid: z.number(),
  missed_visits: z.number(),
});

export type ClientWithStats = z.infer<typeof ClientWithStatsSchema>;

// ─── ClientListResponse ─────────────────────────────────────────────────────

export const ClientListResponseSchema = z.object({
  items: z.array(ClientWithStatsSchema),
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
});

export type ClientListResponse = z.infer<typeof ClientListResponseSchema>;

// ─── PaymentResponse ───────────────────────────────────────────────────────

export const PaymentResponseSchema = z.object({
  id: z.string(),
  record_id: z.string(),
  amount: z.number(),
  method: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

// ─── RecordCreate (request body) ─────────────────────────────────────────

export const RecordCreateSchema = z.object({
  activity_id: z.string(),
  client_id: z.string().optional(),
  phone: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'no_show']).optional(),
  seats: z.number().optional(),
  comment: z.string().optional(),
  visits: z.array(z.object({
    visitor_id: z.string().optional(),
    price: z.number(),
    status: z.enum(['waiting', 'visited', 'missed', 'cancelled']).optional(),
  })).optional(),
});

export type RecordCreate = z.infer<typeof RecordCreateSchema>;

export const RecordUpdateSchema = RecordCreateSchema.partial();
export type RecordUpdate = z.infer<typeof RecordUpdateSchema>;

// ─── PaymentCreate (request body) ────────────────────────────────────────

export const PaymentCreateSchema = z.object({
  record_id: z.string(),
  amount: z.number(),
  method: z.enum(['cash', 'card', 'transfer']).optional(),
});

export type PaymentCreate = z.infer<typeof PaymentCreateSchema>;

export const PaymentUpdateSchema = PaymentCreateSchema.partial();
export type PaymentUpdate = z.infer<typeof PaymentUpdateSchema>;

// ─── VisitorCreate (request body) ────────────────────────────────────────

export const VisitorCreateSchema = z.object({
  client_id: z.string(),
  name: z.string(),
  age: z.number().optional(),
});

export type VisitorCreate = z.infer<typeof VisitorCreateSchema>;

export const VisitorUpdateSchema = VisitorCreateSchema.partial();
export type VisitorUpdate = z.infer<typeof VisitorUpdateSchema>;

// ─── TariffCreate (request body) ─────────────────────────────────────────

export const TariffCreateSchema = z.object({
  title: z.string(),
  description: z.string().optional().default(''),
  price: z.number().min(0),
});

export type TariffCreate = z.infer<typeof TariffCreateSchema>;

// ─── ServiceCreate (request body) ────────────────────────────────────────

export const ServiceCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  image_url: z.string().optional().default(''),
  specialty: z.string().optional().default(''),
  min_age: z.number().min(0).max(18).default(0),
  max_age: z.number().min(0).max(18).default(18),
  duration: z.number().min(15).max(480),
  record_info: z.string().optional().default(''),
  material_hint: z.string().optional().default(''),
  tariffs: z.array(TariffCreateSchema).default([]),
  tag_ids: z.array(z.string()).default([]),
});

export type ServiceCreate = z.infer<typeof ServiceCreateSchema>;

export const ServiceUpdateSchema = ServiceCreateSchema.partial();
export type ServiceUpdate = z.infer<typeof ServiceUpdateSchema>;

// ─── LocationCreate (request body) ───────────────────────────────────────

export const LocationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().optional().default(''),
  description: z.string().optional().default(''),
  capacity: z.number().min(1).max(500),
  yandex_map_url: z.string().optional().default(''),
  review_url: z.string().optional().default(''),
  record_info: z.string().optional().default(''),
  image_url: z.string().optional().default(''),
  location_hint: z.string().optional().default(''),
  tag_ids: z.array(z.string()).default([]),
});

export type LocationCreate = z.infer<typeof LocationCreateSchema>;

export const LocationUpdateSchema = LocationCreateSchema.partial();
export type LocationUpdate = z.infer<typeof LocationUpdateSchema>;
