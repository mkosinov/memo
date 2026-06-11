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
  sort_order: z.number().optional(),
  created_at: z.string(), // ISO datetime string
  updated_at: z.string(), // ISO datetime string
});

export type MasterResponse = z.infer<typeof MasterResponseSchema>;

// ─── MasterCreate (request body) ──────────────────────────────────────────

export const MasterCreateSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  position: z.enum(['мастер', 'администратор']),
  specialty: z.enum(['живопись', 'керамика']),
  avatar_url: z.string().optional().default(''),
});
export type MasterCreate = z.infer<typeof MasterCreateSchema>;

export const MasterUpdateSchema = MasterCreateSchema.partial();
export type MasterUpdate = z.infer<typeof MasterUpdateSchema>;

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
  sort_order: z.number().optional(),
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
  tags: z.array(z.object({ id: z.string(), tag: z.string() })).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type PhotoResponse = z.infer<typeof PhotoResponseSchema>;

// ─── PhotoCreate (request body) ──────────────────────────────────────────

export const PhotoCreateSchema = z.object({
  filename: z.string().min(1),
  visitor_id: z.string().optional().default(''),
  service_id: z.string().optional().default(''),
  activity_id: z.string().optional().default(''),
  is_public: z.boolean().default(false),
  tag_ids: z.array(z.string()).default([]),
});
export type PhotoCreate = z.infer<typeof PhotoCreateSchema>;

export const PhotoUpdateSchema = PhotoCreateSchema.partial();
export type PhotoUpdate = z.infer<typeof PhotoUpdateSchema>;

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

// ─── TagCreate (request body) ───────────────────────────────────────────

export const TagCreateSchema = z.object({
  tag: z.string().min(1).max(100),
});
export type TagCreate = z.infer<typeof TagCreateSchema>;

export const TagUpdateSchema = TagCreateSchema.partial();
export type TagUpdate = z.infer<typeof TagUpdateSchema>;

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
  custom_price: z.number().nullable(),
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
  custom_price: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
  visits: z.array(VisitResponseSchema),
});

export type RecordResponse = z.infer<typeof RecordResponseSchema>;

// ─── ClientResponse ────────────────────────────────────────────────────────

export const ClientResponseSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  channel: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});

export type ClientResponse = z.infer<typeof ClientResponseSchema>;

// ─── ClientCreate (request body) ──────────────────────────────────────────

export const ClientCreateSchema = z.object({
  name: z.string().optional(),
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
  custom_price: z.number().nullable().optional(),
  visits: z.array(z.object({
    visitor_id: z.string().optional(),
    price: z.number(),
    custom_price: z.number().nullable().optional(),
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

// ─── MaterialResponse ───────────────────────────────────────────────────

export const MaterialResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MaterialResponse = z.infer<typeof MaterialResponseSchema>;

// ─── MaterialCreate (request body) ──────────────────────────────────────

export const MaterialCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
});
export type MaterialCreate = z.infer<typeof MaterialCreateSchema>;

export const MaterialUpdateSchema = MaterialCreateSchema.partial();
export type MaterialUpdate = z.infer<typeof MaterialUpdateSchema>;

// ─── Search Result Schemas ──────────────────────────────────────────────

export const VisitorSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().nullable(),
});
export type VisitorSearchResult = z.infer<typeof VisitorSearchResultSchema>;

export const ServiceSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
});
export type ServiceSearchResult = z.infer<typeof ServiceSearchResultSchema>;

export const ActivitySearchResultSchema = z.object({
  id: z.string(),
  start: z.string(),
  service_id: z.string(),
  service_title: z.string(),
});
export type ActivitySearchResult = z.infer<typeof ActivitySearchResultSchema>;

export const TagSearchResultSchema = z.object({
  id: z.string(),
  tag: z.string(),
});
export type TagSearchResult = z.infer<typeof TagSearchResultSchema>;
