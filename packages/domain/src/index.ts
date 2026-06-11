import { z } from 'zod';

// ─── Artist ───────────────────────────────────────────────────────────────

export const ArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  color: z.string(),
  specialty: z.string().optional(),
});

export type Artist = z.infer<typeof ArtistSchema>;

// ─── Studio / Location ────────────────────────────────────────────────────

export const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().optional(),
  emoji: z.string().optional(),
  defaultCapacity: z.number().optional(),
});

export type Location = z.infer<typeof LocationSchema>;

// ─── Service ──────────────────────────────────────────────────────────────

export const ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  duration: z.number(), // hours
  durationMinutes: z.number().optional(),
  maxCapacity: z.number(),
  minAge: z.string(),
  maxAge: z.string(),
  defaultAdultPrice: z.number().optional(),
  defaultChildPrice: z.number().optional(),
  defaultIndividualPrice: z.number().optional(),
  adultPrice: z.number().optional(),
  childPrice: z.number().optional(),
  individualPrice: z.number().optional(),
  description: z.string().optional(),
});

export type Service = z.infer<typeof ServiceSchema>;

// ─── Activity ─────────────────────────────────────────────────────────────

export const ActivitySchema = z.object({
  id: z.string(),
  day: z.number(), // 0=ПН ... 6=ВС
  masterId: z.string(),
  artistId: z.string().optional(),
  startTime: z.number(), // e.g. 10.5 = 10:30
  duration: z.number(),
  durationMinutes: z.number().optional(),
  serviceId: z.string(),
  serviceName: z.string().optional(),
  minAge: z.string().optional(),
  locationId: z.string(),
  occupied: z.number(),
  capacity: z.number(),
  isPrivate: z.boolean(),
  // v1 fields
  isPublic: z.boolean().optional(),
  date: z.string().optional(), // YYYY-MM-DD
  endTime: z.string().optional(), // HH:MM
  priceAdult: z.number().optional(),
  priceChild: z.number().optional(),
  priceIndividual: z.number().optional(),
  hasRecords: z.boolean().optional(),
  comment: z.string().optional(),
  clientName: z.string().optional(),
});

export type Activity = z.infer<typeof ActivitySchema>;

// ─── Client ───────────────────────────────────────────────────────────────

export const ClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  createdAt: z.string(),
});

export type Client = z.infer<typeof ClientSchema>;

// ─── Visitor ──────────────────────────────────────────────────────────────

export const VisitorSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  age: z.number().optional(),
  isAdult: z.boolean(),
});

export type Visitor = z.infer<typeof VisitorSchema>;

// ─── Record ───────────────────────────────────────────────────────────────

export const RecordStatusSchema = z.enum(['pending', 'confirmed', 'cancelled', 'no_show']);
export type RecordStatus = z.infer<typeof RecordStatusSchema>;

export const RecordSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  clientId: z.string().nullable(),
  status: RecordStatusSchema,
  createdAt: z.string(),
  comment: z.string().optional(),
});

export type Record = z.infer<typeof RecordSchema>;

// ─── Visit ────────────────────────────────────────────────────────────────

export const VisitSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  visitorId: z.string(),
  isPrimary: z.boolean(),
  priceCharged: z.number(),
  visited: z.boolean(),
});

export type Visit = z.infer<typeof VisitSchema>;

// ─── Payment ──────────────────────────────────────────────────────────────

export const PaymentMethodSchema = z.enum(['cash', 'card', 'transfer']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  amount: z.number(),
  paid: z.boolean(),
  method: PaymentMethodSchema.optional(),
  createdAt: z.string(),
});

export type Payment = z.infer<typeof PaymentSchema>;

// ─── StampState ───────────────────────────────────────────────────────────

export const StampStateSchema = z.object({
  masterId: z.string().nullable(),
  serviceId: z.string().nullable(),
  locations: z.set(z.string()),
  ready: z.boolean(),
});

export type StampState = z.infer<typeof StampStateSchema>;

// ─── Filters ──────────────────────────────────────────────────────────────

export const FiltersSchema = z.object({
  locationId: z.string(),
  serviceId: z.string(),
  artistId: z.string(),
  weekStart: z.string(),
});

export type Filters = z.infer<typeof FiltersSchema>;

// ─── Conflict ─────────────────────────────────────────────────────────────

export const ConflictSchema = z.object({
  activityId1: z.string(),
  activityId2: z.string(),
  artistId: z.string(),
  message: z.string(),
});

export type Conflict = z.infer<typeof ConflictSchema>;

// ─── FormatPainterState ───────────────────────────────────────────────────

export const FormatPainterModeSchema = z.enum(['inactive', 'selectSource', 'selectTarget', 'delete']);
export type FormatPainterMode = z.infer<typeof FormatPainterModeSchema>;

export const FormatPainterStateSchema = z.object({
  mode: FormatPainterModeSchema,
  sourceId: z.string().nullable(),
});

export type FormatPainterState = z.infer<typeof FormatPainterStateSchema>;

// ─── ViewMode ─────────────────────────────────────────────────────────────

export const ViewModeSchema = z.enum(['week', 'month', 'day', 'list']);
export type ViewMode = z.infer<typeof ViewModeSchema>;

// ─── Chat Types ───────────────────────────────────────────────────────────

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ServiceRecommendationSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  confidence: z.number(),
  reason: z.string(),
});

export type ServiceRecommendation = z.infer<typeof ServiceRecommendationSchema>;

// ─── Booking Context Types ────────────────────────────────────────────────

export const BookingVisitorSchema = z.object({
  tempId: z.string(),
  name: z.string(),
  age: z.union([z.number(), z.literal('')]),
  isAdult: z.boolean(),
  isPrimary: z.boolean(),
  visitorId: z.string().nullable(),
  priceCharged: z.number(),
});

export type BookingVisitor = z.infer<typeof BookingVisitorSchema>;

export const BookingStepSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type BookingStep = z.infer<typeof BookingStepSchema>;

// ─── Schedule DTOs ─────────────────────────────────────────────────────────

export type { ScheduleDTO, ScheduleAdminDTO } from './schedule';

// ─── Schedule Index ────────────────────────────────────────────────────────

export type { ScheduleIndex } from './schedule-index';
export { buildSchedule, resolveById } from './schedule-index';

// ─── Alias for backward compatibility ─────────────────────────────────────

/** @deprecated Use `Location` instead. Kept for migration compatibility. */
export type Studio = Location;
