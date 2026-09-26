import { z } from 'zod';
import { api } from './client';
import {
  StaffResponseSchema,
  type StaffResponse,
  type StaffCreate,
  type StaffUpdate,
  type StaffPatch,
  StaffArchiveRequestSchema,
  type StaffArchiveRequest,
  type MasterViewResponse,
  PositionResponseSchema,
  type PositionResponse,
  type PositionCreate,
  type PositionUpdate,
  type PositionPatch,
  LocationResponseSchema,
  type LocationResponse,
  ServiceResponseSchema,
  type ServiceResponse,
  ServiceCreateSchema,
  ServiceUpdateSchema,
  type ServiceUpdate,
  LocationCreateSchema,
  LocationUpdateSchema,
  type LocationUpdate,
  ActivityCreateSchema,
  type ActivityCreate,
  type ActivityPatch,
  ActivityResponseSchema,
  CopyWeekResultSchema,
  type CopyWeekResult,
  type ActivityResponse,
  PhotoResponseSchema,
  type PhotoResponse,
  type PhotoCreate,
  type PhotoUpdate,
  RecordResponseSchema,
  type RecordResponse,
  RecordViewListResponseSchema,
  type RecordView,
  type RecordCreate,
  type RecordUpdate,
  ClientResponseSchema,
  type ClientResponse,
  type ClientCreate,
  type ClientUpdate,
  ClientWithStatsSchema,
  type ClientWithStats,
  PaymentResponseSchema,
  PaymentTotalsResponseSchema,
  type PaymentResponse,
  type PaymentCreate,
  type PaymentUpdate,
  VisitorResponseSchema,
  type VisitorResponse,
  type VisitorCreate,
  type VisitorUpdate,
  VisitResponseSchema,
  type VisitResponse,
  type VisitCreate,
  type VisitPatch,
  TagResponseSchema,
  type TagResponse,
  type TagCreate,
  type TagUpdate,
  MaterialResponseSchema,
  type MaterialResponse,
  type MaterialCreate,
  type MaterialUpdate,
  UserSettingsResponseSchema,
  type UserSettingsResponse,
  type UserSettingsUpdate,
  StaffListResponseSchema,
  PositionListResponseSchema,
  MasterViewListResponseSchema,
  LocationListResponseSchema,
  TagListResponseSchema,
  MaterialListResponseSchema,
  ServiceListResponseSchema,
  StaffAllResponseSchema,
  PositionAllResponseSchema,
  MasterViewAllResponseSchema,
  LocationAllResponseSchema,
  ServiceAllResponseSchema,
  TagAllResponseSchema,
  MaterialAllResponseSchema,
  ActivityListResponseSchema,
  PaymentListResponseSchema,
  RecordListResponseSchema,
  VisitorListResponseSchema,
  ClientListResponseSchema,
  PhotoListResponseSchema,
  type PhotoListResponse,
  type PaginatedResponse,
  AuthMeSchema,
  type AuthMe,
  MyProfileSchema,
  type MyProfile,
  type MyProfileUpdate,
  PortraitResponseSchema,
  type PortraitResponse,
  type ChangePassword,
} from './schemas';
import { ApiError } from './client';

// ─── List pagination ─────────────────────────────────────────────────────────

export interface ListParams {
  page?: number;
  per_page?: number;
  /** Archive filter — soft-delete entities only (masters/locations/services/materials).
   *  Ignored by endpoints that don't declare it (tags, visitors). */
  status?: 'active' | 'all' | 'archived' | null;
  /** Server-side sort — dictionary list endpoints only (#205); must be in the endpoint's whitelist. */
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  /** Server-side search (GH #212); min 2 chars server-enforced. */
  q?: string;
  /** Services only (GH #223): filter services linked to this material.
   *  Ignored by endpoints that don't declare it. */
  material_id?: string;
}

function listQuery(params?: ListParams): string {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  if (params?.status) search.set('status', params.status);
  if (params?.sort_by) search.set('sort_by', params.sort_by);
  if (params?.sort_order) search.set('sort_order', params.sort_order);
  if (params?.q) search.set('q', params.q);
  if (params?.material_id) search.set('material_id', params.material_id);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

// ─── Masters (read-only view, GH #266 D8) ─────────────────────────────────
// /api/v1/masters serves the ACTING masters (masters.is_active = true) for
// schedule filters and the client site #48. No mutations, no GET /{id}, no
// reorder — writes live on the staff card. Undeclared query params (status/
// sort/q) are ignored server-side; ListParams keeps the shared listQuery shape.

export async function getMasters(params?: ListParams): Promise<PaginatedResponse<MasterViewResponse>> {
  return api(`/api/v1/masters${listQuery(params)}`, MasterViewListResponseSchema);
}

// ─── Staff (GH #266 — the full staff directory) ───────────────────────────

/** Staff sort whitelist (#266): position EXCLUDED — M2M makes the sort ambiguous. */
export type StaffSortBy = 'name' | 'specialty' | 'color' | 'avatar' | 'status';

export async function getStaff(params?: ListParams & { sort_by?: StaffSortBy }): Promise<PaginatedResponse<StaffResponse>> {
  return api(`/api/v1/staff${listQuery(params)}`, StaffListResponseSchema);
}

export async function getStaffById(id: string): Promise<StaffResponse> {
  return api(`/api/v1/staff/${id}`, StaffResponseSchema);
}

// Create a card — one transaction: person + optional master section (D5),
// position ids, and the create-only account checkbox (D6).
export async function createStaff(data: StaffCreate): Promise<StaffResponse> {
  return api('/api/v1/staff', StaffResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Full update via PUT — card + sections replace, atomically.
export async function updateStaff(id: string, data: StaffUpdate): Promise<StaffResponse> {
  return api(`/api/v1/staff/${id}`, StaffResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — master is three-state (absent/null/payload).
export async function patchStaff(id: string, data: StaffPatch): Promise<StaffResponse> {
  return api(`/api/v1/staff/${id}`, StaffResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// D6 dismissal checkboxes: {archive_master, archive_user}, both default true.
// An archive call without a body = consent to the preselected choice.
export async function archiveStaff(
  id: string,
  checkboxes?: StaffArchiveRequest,
): Promise<StaffResponse> {
  return api(`/api/v1/staff/${id}/archive`, StaffResponseSchema, {
    method: 'POST',
    ...(checkboxes !== undefined ? { body: JSON.stringify(StaffArchiveRequestSchema.parse(checkboxes)) } : {}),
  });
}

// Restores the PERSON only (master/user flags are explicit toggles, D3).
export async function restoreStaff(id: string): Promise<StaffResponse> {
  return api(`/api/v1/staff/${id}/restore`, StaffResponseSchema, { method: 'POST' });
}

export async function deleteStaff(id: string): Promise<void> {
  await api(`/api/v1/staff/${id}`, z.any(), { method: 'DELETE' });
}

// Execute a hard delete with dependency resolutions (GH #207 §6) — DELETE with body.
// Activities BLOCK (422); the masters row, account, master_tags and
// staff_positions auto-cascade (domain-rules/staff.md).
export async function resolveDeleteStaff(id: string, resolutions: Record<string, string>): Promise<void> {
  await api(`/api/v1/staff/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify({ resolutions }) });
}

// ─── Positions (GH #266 D4 — salary-side dictionary) ──────────────────────

export async function getPositions(params?: ListParams): Promise<PaginatedResponse<PositionResponse>> {
  return api(`/api/v1/positions${listQuery(params)}`, PositionListResponseSchema);
}

export async function getPosition(id: string): Promise<PositionResponse> {
  return api(`/api/v1/positions/${id}`, PositionResponseSchema);
}

export async function createPosition(data: PositionCreate): Promise<PositionResponse> {
  return api('/api/v1/positions', PositionResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePosition(id: string, data: PositionUpdate): Promise<PositionResponse> {
  return api(`/api/v1/positions/${id}`, PositionResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — title only.
export async function patchPosition(
  id: string,
  data: PositionPatch,
): Promise<PositionResponse> {
  return api(`/api/v1/positions/${id}`, PositionResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Built-ins (is_system) are rejected server-side with POSITION_IS_SYSTEM.
export async function deletePosition(id: string): Promise<void> {
  await api(`/api/v1/positions/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Locations ─────────────────────────────────────────────────────────────

export async function getLocations(params?: ListParams): Promise<PaginatedResponse<LocationResponse>> {
  return api(`/api/v1/locations${listQuery(params)}`, LocationListResponseSchema);
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export async function getWebPhotos(params?: { activity_id?: string }): Promise<PhotoResponse[]> {
  const search = new URLSearchParams();
  if (params?.activity_id) search.set('activity_id', params.activity_id);
  const qs = search.toString();
  return api(`/api/v1/photos/web${qs ? `?${qs}` : ''}`, z.array(PhotoResponseSchema));
}

// ─── Photos list (GH #211: paginated with filters/sort) ────────────────────

export interface PhotoListParams {
  page?: number;
  per_page?: number;
  q?: string;
  client_id?: string;
  location_id?: string;
  activity_id?: string;
  service_id?: string;
  tag_id?: string[];
  sort_by?: 'filename' | 'is_public' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

export async function getPhotos(params?: PhotoListParams): Promise<PhotoListResponse> {
  const search = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (k === 'tag_id') (v as string[]).forEach((t) => search.append('tag_id', t));
      else search.set(k, String(v));
    }
  }
  const qs = search.toString();
  return api(`/api/v1/photos${qs ? `?${qs}` : ''}`, PhotoListResponseSchema);
}

// ─── Photos CRUD ────────────────────────────────────────────────────────

export async function createPhoto(data: PhotoCreate): Promise<PhotoResponse> {
  return api('/api/v1/photos', PhotoResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePhoto(id: string, data: PhotoUpdate): Promise<PhotoResponse> {
  return api(`/api/v1/photos/${id}`, PhotoResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deletePhoto(id: string): Promise<void> {
  await api(`/api/v1/photos/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Services ──────────────────────────────────────────────────────────────

export async function getServices(params?: ListParams): Promise<PaginatedResponse<ServiceResponse>> {
  return api(`/api/v1/services${listQuery(params)}`, ServiceListResponseSchema);
}

// ─── Activities ────────────────────────────────────────────────────────────

export async function getActivities(params: {
  date_from?: string;
  date_to?: string;
  service_id?: string;
  q?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<ActivityResponse>> {
  const search = new URLSearchParams();
  if (params.date_from) search.set('date_from', params.date_from);
  if (params.date_to) search.set('date_to', params.date_to);
  if (params.service_id) search.set('service_id', params.service_id);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/activities${qs ? `?${qs}` : ''}`, ActivityListResponseSchema);
}

export async function getActivity(id: string): Promise<ActivityResponse> {
  return api(`/api/v1/activities/${id}`, ActivityResponseSchema);
}

export async function createActivity(data: ActivityCreate): Promise<ActivityResponse> {
  return api('/api/v1/activities', ActivityResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Backend uses PUT (full update), not PATCH.
export async function updateActivity(
  id: string,
  data: Partial<ActivityCreate>,
): Promise<ActivityResponse> {
  return api(`/api/v1/activities/${id}`, ActivityResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — only send the changed fields.
export async function patchActivity(
  id: string,
  data: ActivityPatch,
): Promise<ActivityResponse> {
  return api(`/api/v1/activities/${id}`, ActivityResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Dry-run preview (GH #286 D2, mirror of the records dry-run #285 rev7):
// DELETE ?dry_run=true without body. 204 No Content → resolves; 409 → ApiError
// with .dependencies tree (the RECURSIVE activity subtree — records → their
// visits/payments — carries items: [{id, label}] for one-line previews).
export async function dryRunDeleteActivity(id: string): Promise<void> {
  await api(`/api/v1/activities/${id}?dry_run=true`, z.any(), { method: 'DELETE' });
}

// Execute a hard activity delete (GH #286 D2, mirror of resolveDeleteRecord) —
// body contract: {expected}. `expected` is MANDATORY (bare DELETE → 422
// expected_state_required): uuid id-sets of the user-confirmed dry-run subtree
// {records, visits, payments}; backend answers 409 stale_dependencies on
// mismatch (auto deps photos/activity_tags are exempt from the check).
export interface DeleteActivityWithExpectedPayload {
  expected: Record<string, string[]>;
}

export async function deleteActivityWithExpected(
  id: string,
  payload: DeleteActivityWithExpectedPayload,
): Promise<void> {
  await api(`/api/v1/activities/${id}`, z.any(), {
    method: 'DELETE',
    body: JSON.stringify({ expected: payload.expected }),
  });
}

// Atomic last-week copy (#242): merge dedup server-side; week_start is the
// TARGET week's Monday, locations is the explicit checked list from the popup.
export async function copyWeek(params: {
  week_start: string;
  locations: string[];
}): Promise<CopyWeekResult> {
  return api('/api/v1/activities/copy-week', CopyWeekResultSchema, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ─── Records ────────────────────────────────────────────────────────────────

export async function getRecord(id: string): Promise<RecordResponse> {
  return api(`/api/v1/records/${id}`, RecordResponseSchema);
}

export async function getRecords(params?: {
  date_from?: string;
  date_to?: string;
  client_id?: string;
  activity_id?: string;
  location_id?: string;
  service_id?: string;
  master_id?: string;
  status?: string;
  q?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<RecordResponse>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  if (params?.client_id) search.set('client_id', params.client_id);
  if (params?.activity_id) search.set('activity_id', params.activity_id);
  if (params?.location_id) search.set('location_id', params.location_id);
  if (params?.service_id) search.set('service_id', params.service_id);
  if (params?.master_id) search.set('master_id', params.master_id);
  if (params?.status) search.set('status', params.status);
  if (params?.q) search.set('q', params.q);
  if (params?.sort_by) search.set('sort_by', params.sort_by);
  if (params?.sort_order) search.set('sort_order', params.sort_order);
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/records${qs ? `?${qs}` : ''}`, RecordListResponseSchema);
}

// GH #213: composite read endpoint for the records table — records + display
// fields (client name, activity start, service/master/location, paid) in one
// request. Param serialization mirrors getRecords byte-for-byte (single
// RecordListParams class on the backend).
export async function getRecordsView(params?: {
  date_from?: string;
  date_to?: string;
  client_id?: string;
  activity_id?: string;
  location_id?: string;
  service_id?: string;
  master_id?: string;
  status?: string;
  q?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<RecordView>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  if (params?.client_id) search.set('client_id', params.client_id);
  if (params?.activity_id) search.set('activity_id', params.activity_id);
  if (params?.location_id) search.set('location_id', params.location_id);
  if (params?.service_id) search.set('service_id', params.service_id);
  if (params?.master_id) search.set('master_id', params.master_id);
  if (params?.status) search.set('status', params.status);
  if (params?.q) search.set('q', params.q);
  if (params?.sort_by) search.set('sort_by', params.sort_by);
  if (params?.sort_order) search.set('sort_order', params.sort_order);
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/records/view${qs ? `?${qs}` : ''}`, RecordViewListResponseSchema);
}

// ─── Clients ────────────────────────────────────────────────────────────────

export async function getClientsWithStats(
  // GH #232: `ids` serializes as repeated `id` query keys (backend accepts
  // ≤100 after dedup). Keys are collected explicitly — no spread of the
  // filters bag into searchParams.
  params?: Record<string, string | number | boolean | string[] | null | undefined>,
): Promise<PaginatedResponse<ClientWithStats>> {
  const search = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (key === 'ids') return; // handled explicitly below
      if (value !== undefined && value !== null && value !== '') {
        search.append(key, String(value));
      }
    });
    if (Array.isArray(params.ids)) {
      for (const id of params.ids) search.append('id', id);
    }
  }
  const qs = search.toString();
  return api(`/api/v1/clients${qs ? `?${qs}` : ''}`, ClientListResponseSchema);
}

// GH #211: light paginated client list for photo pickers/typeaheads.
// Photo pickers always request status: "active" — archived clients must not
// surface (spec §7.3).
export interface ClientListParams {
  q?: string;
  phone?: string; // GH #221: digits-mode national-substring filter, 4-15 digits
  per_page?: number;
  page?: number;
  status?: 'active' | 'archived';
}

export async function getClientsPaged(
  params: ClientListParams,
): Promise<PaginatedResponse<ClientWithStats>> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }
  const qs = search.toString();
  return api(`/api/v1/clients${qs ? `?${qs}` : ''}`, ClientListResponseSchema);
}

export async function createClient(data: ClientCreate): Promise<ClientResponse> {
  return api('/api/v1/clients', ClientResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateClient(id: string, data: ClientUpdate): Promise<ClientResponse> {
  return api(`/api/v1/clients/${id}`, ClientResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function patchClient(
  id: string,
  data: Partial<Pick<ClientResponse, 'name' | 'phone' | 'email' | 'channel'>>,
): Promise<ClientResponse> {
  return api(`/api/v1/clients/${id}`, ClientResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteClient(id: string): Promise<void> {
  await api(`/api/v1/clients/${id}`, z.any(), { method: 'DELETE' });
}

export async function archiveClient(id: string): Promise<ClientResponse> {
  return api(`/api/v1/clients/${id}/archive`, ClientResponseSchema, { method: 'POST' });
}

export async function restoreClient(id: string): Promise<ClientResponse> {
  return api(`/api/v1/clients/${id}/restore`, ClientResponseSchema, { method: 'POST' });
}

// Execute a hard delete with dependency resolutions (GH #207 §6) — DELETE with body.
export async function resolveDeleteClient(id: string, resolutions: Record<string, string>): Promise<void> {
  await api(`/api/v1/clients/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify({ resolutions }) });
}

// ─── Payments ───────────────────────────────────────────────────────────────

export async function getPayments(params?: {
  record_id?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<PaymentResponse>> {
  const search = new URLSearchParams();
  if (params?.record_id) search.set('record_id', params.record_id);
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/payments${qs ? `?${qs}` : ''}`, PaymentListResponseSchema);
}

export async function getPaymentTotals(recordIds: string[]): Promise<Record<string, number>> {
  const search = new URLSearchParams();
  recordIds.forEach((id) => search.append('record_ids', id));
  const qs = search.toString();
  const res = await api(`/api/v1/payments/totals${qs ? `?${qs}` : ''}`, PaymentTotalsResponseSchema);
  return res.totals;
}

// ─── Records CRUD ─────────────────────────────────────────────────────────

export async function createRecord(data: RecordCreate): Promise<RecordResponse> {
  return api('/api/v1/records', RecordResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateRecord(id: string, data: RecordUpdate): Promise<RecordResponse> {
  return api(`/api/v1/records/${id}`, RecordResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Dry-run preview (GH #285 rev7): DELETE ?dry_run=true without body.
// 204 No Content → resolves; 409 → ApiError with .dependencies tree
// (record nodes carry items: [{id, label}] for one-line previews).
export async function dryRunDeleteRecord(id: string): Promise<void> {
  await api(`/api/v1/records/${id}?dry_run=true`, z.any(), { method: 'DELETE' });
}

// Execute a hard delete (GH #285 rev7) — body contract: {expected, resolutions?}.
// `expected` is MANDATORY (contract "every delete carries state"): uuid id-sets
// snapshotted from the dry-run tree; backend answers 409 stale_dependencies on
// mismatch. resolutions (nullify/cascade) optional — pure path sends only expected.
export interface ResolveDeleteRecordPayload {
  expected: Record<string, string[]>;
  resolutions?: Record<string, string>;
}

export async function resolveDeleteRecord(id: string, payload: ResolveDeleteRecordPayload): Promise<void> {
  const body: ResolveDeleteRecordPayload = { expected: payload.expected };
  if (payload.resolutions !== undefined) body.resolutions = payload.resolutions;
  await api(`/api/v1/records/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify(body) });
}

export async function patchRecord(id: string, data: Partial<Pick<RecordResponse, 'status' | 'comment' | 'custom_price'> & { visits?: Array<{ visitor_id?: string | null; tariff_id?: string | null; price: number; custom_price?: number | null; status?: string }> }>): Promise<RecordResponse> {
  return api(`/api/v1/records/${id}`, RecordResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Payments CRUD ────────────────────────────────────────────────────────

export async function createPayment(data: PaymentCreate): Promise<PaymentResponse> {
  return api('/api/v1/payments', PaymentResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePayment(id: string, data: PaymentUpdate): Promise<PaymentResponse> {
  return api(`/api/v1/payments/${id}`, PaymentResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — only send the changed fields.
export async function patchPayment(
  id: string,
  data: { amount?: number; method?: string },
): Promise<PaymentResponse> {
  return api(`/api/v1/payments/${id}`, PaymentResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePayment(id: string): Promise<void> {
  await api(`/api/v1/payments/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Client Visitors ─────────────────────────────────────────────────────

export async function getClientVisitors(clientId: string): Promise<VisitorResponse[]> {
  return api(`/api/v1/clients/${clientId}/visitors`, z.array(VisitorResponseSchema));
}

// ─── Visitors CRUD ────────────────────────────────────────────────────────

export async function getVisitors(params?: ListParams): Promise<PaginatedResponse<VisitorResponse>> {
  return api(`/api/v1/visitors${listQuery(params)}`, VisitorListResponseSchema);
}

export async function createVisitor(data: VisitorCreate): Promise<VisitorResponse> {
  return api('/api/v1/visitors', VisitorResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateVisitor(id: string, data: VisitorUpdate): Promise<VisitorResponse> {
  return api(`/api/v1/visitors/${id}`, VisitorResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function patchVisitor(id: string, data: VisitorUpdate): Promise<VisitorResponse> {
  return api(`/api/v1/visitors/${id}`, VisitorResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteVisitor(id: string): Promise<void> {
  await api(`/api/v1/visitors/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Client Phone Lookup (GH #212: /clients/search → /clients/get) ──────────

export async function getClientByPhone(phone: string): Promise<ClientResponse> {
  return api(
    `/api/v1/clients/get?phone=${encodeURIComponent(phone)}`,
    ClientResponseSchema,
  );
}

// GH #213: per-id client fetch (ClientQuickCard header, ActivityDetailsModal).
// Backend route: GET /clients/{client_id} → ClientResponse (clients.py:73-89).
export async function getClientById(id: string): Promise<ClientResponse> {
  return api(`/api/v1/clients/${id}`, ClientResponseSchema);
}

// ─── Visit Status ─────────────────────────────────────────────────────────

export async function updateVisitStatus(id: string, status: string): Promise<VisitResponse> {
  return api(`/api/v1/visits/${id}/status`, VisitResponseSchema, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

// ─── Visits CRUD ────────────────────────────────────────────────────────

export async function createVisit(data: VisitCreate): Promise<VisitResponse> {
  return api('/api/v1/visits', VisitResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function patchVisit(id: string, data: VisitPatch): Promise<VisitResponse> {
  return api(`/api/v1/visits/${id}`, VisitResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteVisit(id: string): Promise<void> {
  await api(`/api/v1/visits/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Tags ──────────────────────────────────────────────────────────────────

export async function getTags(params?: ListParams): Promise<PaginatedResponse<TagResponse>> {
  return api(`/api/v1/tags${listQuery(params)}`, TagListResponseSchema);
}

export async function getTag(id: string): Promise<TagResponse> {
  return api(`/api/v1/tags/${id}`, TagResponseSchema);
}

export async function createTag(data: TagCreate): Promise<TagResponse> {
  return api('/api/v1/tags', TagResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTag(id: string, data: TagUpdate): Promise<TagResponse> {
  return api(`/api/v1/tags/${id}`, TagResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTag(id: string): Promise<void> {
  await api(`/api/v1/tags/${id}`, z.any(), { method: 'DELETE' });
}

// Dry-run preview (GH #318, mirror of records GH #285 rev7): DELETE ?dry_run=true
// without body. 204 No Content → resolves; 409 → ApiError with .dependencies tree
// (nodes carry items: [{id, label}] for one-line previews).
export async function dryRunDeleteTag(id: string): Promise<void> {
  await api(`/api/v1/tags/${id}?dry_run=true`, z.any(), { method: 'DELETE' });
}

// Execute a hard delete (GH #318) — body contract mirrors records: {expected, resolutions?}.
// `expected` is MANDATORY (contract "every delete carries state"): uuid id-sets
// snapshotted from the dry-run tree; backend answers 409 stale_dependencies on
// mismatch. resolutions (nullify/cascade) optional — pure path sends only expected.
export interface ResolveDeleteTagPayload {
  expected: Record<string, string[]>;
  resolutions?: Record<string, string>;
}

export async function resolveDeleteTag(id: string, payload: ResolveDeleteTagPayload): Promise<void> {
  const body: ResolveDeleteTagPayload = { expected: payload.expected };
  if (payload.resolutions !== undefined) body.resolutions = payload.resolutions;
  await api(`/api/v1/tags/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify(body) });
}

// ─── Services CRUD ─────────────────────────────────────────────────────────

export async function createService(data: z.input<typeof ServiceCreateSchema>): Promise<ServiceResponse> {
  return api('/api/v1/services', ServiceResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateService(id: string, data: ServiceUpdate): Promise<ServiceResponse> {
  return api(`/api/v1/services/${id}`, ServiceResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — only send the changed fields.
export async function patchService(
  id: string,
  data: Partial<ServiceUpdate>,
): Promise<ServiceResponse> {
  return api(`/api/v1/services/${id}`, ServiceResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteService(id: string): Promise<void> {
  await api(`/api/v1/services/${id}`, z.any(), { method: 'DELETE' });
}

export async function archiveService(id: string): Promise<ServiceResponse> {
  return api(`/api/v1/services/${id}/archive`, ServiceResponseSchema, { method: 'POST' });
}

export async function restoreService(id: string): Promise<ServiceResponse> {
  return api(`/api/v1/services/${id}/restore`, ServiceResponseSchema, { method: 'POST' });
}

// Execute a hard delete with dependency resolutions (GH #207 §6) — DELETE with body.
export async function resolveDeleteService(id: string, resolutions: Record<string, string>): Promise<void> {
  await api(`/api/v1/services/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify({ resolutions }) });
}

// ─── Locations CRUD ────────────────────────────────────────────────────────

export async function createLocation(data: z.input<typeof LocationCreateSchema>): Promise<LocationResponse> {
  return api('/api/v1/locations', LocationResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLocation(id: string, data: LocationUpdate): Promise<LocationResponse> {
  return api(`/api/v1/locations/${id}`, LocationResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — only send the changed fields.
export async function patchLocation(
  id: string,
  data: Partial<LocationUpdate>,
): Promise<LocationResponse> {
  return api(`/api/v1/locations/${id}`, LocationResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteLocation(id: string): Promise<void> {
  await api(`/api/v1/locations/${id}`, z.any(), { method: 'DELETE' });
}

export async function archiveLocation(id: string): Promise<LocationResponse> {
  return api(`/api/v1/locations/${id}/archive`, LocationResponseSchema, { method: 'POST' });
}

export async function restoreLocation(id: string): Promise<LocationResponse> {
  return api(`/api/v1/locations/${id}/restore`, LocationResponseSchema, { method: 'POST' });
}

// Execute a hard delete with dependency resolutions (GH #207 §6) — DELETE with body.
export async function resolveDeleteLocation(id: string, resolutions: Record<string, string>): Promise<void> {
  await api(`/api/v1/locations/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify({ resolutions }) });
}

export async function reorderLocations(ids: string[]): Promise<void> {
  await api('/api/v1/locations/reorder', z.any(), {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
}

// ─── Materials ──────────────────────────────────────────────────────────

export async function getMaterials(params?: ListParams): Promise<PaginatedResponse<MaterialResponse>> {
  return api(`/api/v1/materials${listQuery(params)}`, MaterialListResponseSchema);
}

export async function createMaterial(data: MaterialCreate): Promise<MaterialResponse> {
  return api('/api/v1/materials', MaterialResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMaterial(id: string, data: MaterialUpdate): Promise<MaterialResponse> {
  return api(`/api/v1/materials/${id}`, MaterialResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// PATCH for partial updates — only send the changed fields.
export async function patchMaterial(
  id: string,
  data: Partial<MaterialUpdate>,
): Promise<MaterialResponse> {
  return api(`/api/v1/materials/${id}`, MaterialResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteMaterial(id: string): Promise<void> {
  await api(`/api/v1/materials/${id}`, z.any(), { method: 'DELETE' });
}

export async function archiveMaterial(id: string): Promise<MaterialResponse> {
  return api(`/api/v1/materials/${id}/archive`, MaterialResponseSchema, { method: 'POST' });
}

export async function restoreMaterial(id: string): Promise<MaterialResponse> {
  return api(`/api/v1/materials/${id}/restore`, MaterialResponseSchema, { method: 'POST' });
}

// Execute a hard delete with dependency resolutions (GH #207 §6) — DELETE with body.
export async function resolveDeleteMaterial(id: string, resolutions: Record<string, string>): Promise<void> {
  await api(`/api/v1/materials/${id}`, z.any(), { method: 'DELETE', body: JSON.stringify({ resolutions }) });
}

// ─── Dictionary bare /all endpoints (GH #205) ────────────────────────────────

/** Params for bare /all dictionary endpoints (#205). */
export interface AllParams {
  status?: 'active' | 'all' | 'archived';
}

function allQuery(params?: AllParams): string {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function getAllMasters(params?: AllParams): Promise<MasterViewResponse[]> {
  return api(`/api/v1/masters/all${allQuery(params)}`, MasterViewAllResponseSchema);
}

export async function getAllStaff(params?: AllParams): Promise<StaffResponse[]> {
  return api(`/api/v1/staff/all${allQuery(params)}`, StaffAllResponseSchema);
}

// Plain dictionary — no archive status, no params (GH #205 bare-array contract).
export async function getAllPositions(): Promise<PositionResponse[]> {
  return api('/api/v1/positions/all', PositionAllResponseSchema);
}

export async function getAllLocations(params?: AllParams): Promise<LocationResponse[]> {
  return api(`/api/v1/locations/all${allQuery(params)}`, LocationAllResponseSchema);
}

export async function getAllServices(params?: AllParams): Promise<ServiceResponse[]> {
  return api(`/api/v1/services/all${allQuery(params)}`, ServiceAllResponseSchema);
}

export async function getAllMaterials(params?: AllParams): Promise<MaterialResponse[]> {
  return api(`/api/v1/materials/all${allQuery(params)}`, MaterialAllResponseSchema);
}

/** Tags have no archive status — no params. */
export async function getAllTags(): Promise<TagResponse[]> {
  return api('/api/v1/tags/all', TagAllResponseSchema);
}

// ─── Auth (GH #247 spec §3.6/§4.1) ────────────────────────────────────────

export async function login(phone: string, password: string): Promise<AuthMe> {
  return api('/api/v1/auth/login', AuthMeSchema, {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
}

export async function logout(): Promise<void> {
  await api('/api/v1/auth/logout', z.any(), { method: 'POST' });
}

// Guest bootstrap contract (spec §4.1): a 401 here means "no session" —
// resolved to null, not thrown, so AuthContext can distinguish guest from
// error. /auth/* 401s also never trigger the unauthorized handler (client.ts).
export async function getMe(): Promise<AuthMe | null> {
  try {
    return await api('/api/v1/auth/me', AuthMeSchema);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

// POST /auth/change-password (GH #262 spec §4): wrong current password →
// 401 AUTH_INVALID_CREDENTIALS, policy breach → 422 PASSWORD_POLICY; 204
// keeps the current session and revokes all others (server-side).
export async function changePassword(data: ChangePassword): Promise<void> {
  await api('/api/v1/auth/change-password', z.any(), {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── My profile (GH #262 spec §4 — own data, session-guarded) ─────────────

export async function getMyProfile(): Promise<MyProfile> {
  return api('/api/v1/my', MyProfileSchema);
}

// Partial update: only sent keys apply, explicit null clears a nullable
// field (domain-rules/profile.md). Returns the full flat profile.
export async function updateMyProfile(data: MyProfileUpdate): Promise<MyProfile> {
  return api('/api/v1/my', MyProfileSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Multipart portrait upload — the browser sets the boundary Content-Type
// itself (client.ts skips the JSON default for FormData bodies).
export async function uploadPortrait(file: File): Promise<PortraitResponse> {
  const form = new FormData();
  form.append('file', file);
  return api('/api/v1/my/portrait', PortraitResponseSchema, {
    method: 'POST',
    body: form,
  });
}

// ─── User Settings ────────────────────────────────────────────────────
// Own-only since GH #247 §3.8: the server derives the user from the session —
// no user_id query parameter anywhere.

export async function getUserSettings(): Promise<UserSettingsResponse> {
  return api('/api/v1/user-settings', UserSettingsResponseSchema);
}

export async function updateUserSettings(data: UserSettingsUpdate): Promise<UserSettingsResponse> {
  return api(
    '/api/v1/user-settings',
    UserSettingsResponseSchema,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    },
  );
}

// PATCH for partial updates — only send the changed fields.
export async function patchUserSettings(
  data: Partial<UserSettingsUpdate>,
): Promise<UserSettingsResponse> {
  return api(
    '/api/v1/user-settings',
    UserSettingsResponseSchema,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  );
}
