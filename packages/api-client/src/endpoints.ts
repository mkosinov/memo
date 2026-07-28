import { z } from 'zod';
import { api } from './client';
import {
  MasterResponseSchema,
  type MasterResponse,
  type MasterCreate,
  type MasterUpdate,
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
  ActivityResponseSchema,
  type ActivityResponse,
  PhotoResponseSchema,
  type PhotoResponse,
  type PhotoCreate,
  type PhotoUpdate,
  RecordResponseSchema,
  type RecordResponse,
  type RecordCreate,
  type RecordUpdate,
  ClientResponseSchema,
  type ClientResponse,
  type ClientCreate,
  ClientWithStatsSchema,
  type ClientWithStats,
  ClientListResponseSchema,
  type ClientListResponse,
  PaymentResponseSchema,
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
  type UserSettingsCreate,
  type UserSettingsUpdate,
  VisitorSearchResultSchema,
  type VisitorSearchResult,
  ServiceSearchResultSchema,
  type ServiceSearchResult,
  ActivitySearchResultSchema,
  type ActivitySearchResult,
  TagSearchResultSchema,
  type TagSearchResult,
} from './schemas';

// ─── Masters ───────────────────────────────────────────────────────────────

export async function getMasters(): Promise<MasterResponse[]> {
  return api('/api/v1/masters', z.array(MasterResponseSchema));
}

export async function getMaster(id: string): Promise<MasterResponse> {
  return api(`/api/v1/masters/${id}`, MasterResponseSchema);
}

export async function createMaster(data: MasterCreate): Promise<MasterResponse> {
  return api('/api/v1/masters', MasterResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMaster(id: string, data: MasterUpdate): Promise<MasterResponse> {
  return api(`/api/v1/masters/${id}`, MasterResponseSchema, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteMaster(id: string): Promise<void> {
  await api(`/api/v1/masters/${id}`, z.any(), { method: 'DELETE' });
}

export async function reorderMasters(ids: string[]): Promise<void> {
  await api('/api/v1/masters/reorder', z.any(), {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
}

// ─── Locations ─────────────────────────────────────────────────────────────

export async function getLocations(): Promise<LocationResponse[]> {
  return api('/api/v1/locations', z.array(LocationResponseSchema));
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export async function getWebPhotos(params?: { activity_id?: string }): Promise<PhotoResponse[]> {
  const search = new URLSearchParams();
  if (params?.activity_id) search.set('activity_id', params.activity_id);
  const qs = search.toString();
  return api(`/api/v1/photos/web${qs ? `?${qs}` : ''}`, z.array(PhotoResponseSchema));
}

// ─── Photos CRUD ────────────────────────────────────────────────────────

export async function getPhotos(): Promise<PhotoResponse[]> {
  return api('/api/v1/photos', z.array(PhotoResponseSchema));
}

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

export async function getServices(): Promise<ServiceResponse[]> {
  return api('/api/v1/services', z.array(ServiceResponseSchema));
}

// ─── Activities ────────────────────────────────────────────────────────────

export async function getActivities(params: {
  date_from: string;
  date_to: string;
}): Promise<ActivityResponse[]> {
  const search = new URLSearchParams();
  search.set('date_from', params.date_from);
  search.set('date_to', params.date_to);
  return api(`/api/v1/activities?${search.toString()}`, z.array(ActivityResponseSchema));
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
  data: Record<string, unknown>,
): Promise<ActivityResponse> {
  return api(`/api/v1/activities/${id}`, ActivityResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteActivity(id: string): Promise<void> {
  await api(`/api/v1/activities/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Records ────────────────────────────────────────────────────────────────

export async function getRecord(id: string): Promise<RecordResponse> {
  return api(`/api/v1/records/${id}`, RecordResponseSchema);
}

export async function getRecords(params?: {
  date_from?: string;
  date_to?: string;
  client_id?: string;
}): Promise<RecordResponse[]> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  if (params?.client_id) search.set('client_id', params.client_id);
  const qs = search.toString();
  return api(`/api/v1/records${qs ? `?${qs}` : ''}`, z.array(RecordResponseSchema));
}

// ─── Clients ────────────────────────────────────────────────────────────────

export async function getClients(): Promise<ClientResponse[]> {
  return api('/api/v1/clients', ClientListResponseSchema).then(r => r.items);
}

export async function getClientsWithStats(
  params?: Record<string, string | number | boolean | null | undefined>,
): Promise<ClientListResponse> {
  const search = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        search.append(key, String(value));
      }
    });
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

export async function updateClient(id: string, data: ClientCreate): Promise<ClientResponse> {
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

// ─── Payments ───────────────────────────────────────────────────────────────

export async function getPayments(params?: {
  record_id?: string;
}): Promise<PaymentResponse[]> {
  const search = new URLSearchParams();
  if (params?.record_id) search.set('record_id', params.record_id);
  const qs = search.toString();
  return api(`/api/v1/payments${qs ? `?${qs}` : ''}`, z.array(PaymentResponseSchema));
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

export async function deleteRecord(id: string): Promise<void> {
  await api(`/api/v1/records/${id}`, z.any(), { method: 'DELETE' });
}

export async function patchRecord(id: string, data: Partial<Pick<RecordResponse, 'status' | 'comment' | 'custom_price' | 'anonym_visits'> & { visits?: Array<{ visitor_id?: string | null; tariff_id?: string | null; price: number; custom_price?: number | null; status?: string }> }>): Promise<RecordResponse> {
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

// ─── Client Search ────────────────────────────────────────────────────────

export async function searchClientByPhone(phone: string): Promise<ClientResponse> {
  return api(
    `/api/v1/clients/search?phone=${encodeURIComponent(phone)}`,
    ClientResponseSchema,
  );
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

export async function getTags(): Promise<TagResponse[]> {
  return api('/api/v1/tags', z.array(TagResponseSchema));
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

export async function deleteService(id: string): Promise<void> {
  await api(`/api/v1/services/${id}`, z.any(), { method: 'DELETE' });
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

export async function deleteLocation(id: string): Promise<void> {
  await api(`/api/v1/locations/${id}`, z.any(), { method: 'DELETE' });
}

export async function reorderLocations(ids: string[]): Promise<void> {
  await api('/api/v1/locations/reorder', z.any(), {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
}

// ─── Materials ──────────────────────────────────────────────────────────

export async function getMaterials(): Promise<MaterialResponse[]> {
  return api('/api/v1/materials', z.array(MaterialResponseSchema));
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

export async function deleteMaterial(id: string): Promise<void> {
  await api(`/api/v1/materials/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Search Endpoints ──────────────────────────────────────────────────

export async function searchVisitors(q: string): Promise<VisitorSearchResult[]> {
  return api(`/api/v1/search/visitors?q=${encodeURIComponent(q)}`, z.array(VisitorSearchResultSchema));
}

export async function searchServices(q: string): Promise<ServiceSearchResult[]> {
  return api(`/api/v1/search/services?q=${encodeURIComponent(q)}`, z.array(ServiceSearchResultSchema));
}

export async function searchActivities(q: string, serviceId?: string): Promise<ActivitySearchResult[]> {
  const params = new URLSearchParams({ q });
  if (serviceId) params.set('service_id', serviceId);
  return api(`/api/v1/search/activities?${params.toString()}`, z.array(ActivitySearchResultSchema));
}

export async function searchTags(q: string): Promise<TagSearchResult[]> {
  return api(`/api/v1/search/tags?q=${encodeURIComponent(q)}`, z.array(TagSearchResultSchema));
}

// ─── User Settings ────────────────────────────────────────────────────

export async function getUserSettings(userId: string): Promise<UserSettingsResponse> {
  return api(
    `/api/v1/user-settings?user_id=${encodeURIComponent(userId)}`,
    UserSettingsResponseSchema,
  );
}

export async function createUserSettings(data: UserSettingsCreate): Promise<UserSettingsResponse> {
  return api('/api/v1/user-settings', UserSettingsResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUserSettings(
  userId: string,
  data: UserSettingsUpdate,
): Promise<UserSettingsResponse> {
  return api(
    `/api/v1/user-settings?user_id=${encodeURIComponent(userId)}`,
    UserSettingsResponseSchema,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    },
  );
}

export async function deleteUserSettings(id: string): Promise<void> {
  await api(`/api/v1/user-settings/${id}`, z.any(), { method: 'DELETE' });
}
