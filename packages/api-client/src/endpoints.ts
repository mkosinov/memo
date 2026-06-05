import { z } from 'zod';
import { api } from './client';
import {
  MasterResponseSchema,
  type MasterResponse,
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
  RecordResponseSchema,
  type RecordResponse,
  type RecordCreate,
  type RecordUpdate,
  ClientResponseSchema,
  type ClientResponse,
  type ClientCreate,
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
  TagResponseSchema,
  type TagResponse,
} from './schemas';

// ─── Masters ───────────────────────────────────────────────────────────────

export async function getMasters(): Promise<MasterResponse[]> {
  return api('/api/v1/masters', z.array(MasterResponseSchema));
}

export async function getMaster(id: string): Promise<MasterResponse> {
  return api(`/api/v1/masters/${id}`, MasterResponseSchema);
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

export async function getRecords(params?: {
  date_from?: string;
  date_to?: string;
}): Promise<RecordResponse[]> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  const qs = search.toString();
  return api(`/api/v1/records${qs ? `?${qs}` : ''}`, z.array(RecordResponseSchema));
}

// ─── Clients ────────────────────────────────────────────────────────────────

export async function getClients(): Promise<ClientResponse[]> {
  return api('/api/v1/clients', z.array(ClientResponseSchema));
}

export async function createClient(data: ClientCreate): Promise<ClientResponse> {
  return api('/api/v1/clients', ClientResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
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

export async function deletePayment(id: string): Promise<void> {
  await api(`/api/v1/payments/${id}`, z.any(), { method: 'DELETE' });
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

// ─── Tags ──────────────────────────────────────────────────────────────────

export async function getTags(): Promise<TagResponse[]> {
  return api('/api/v1/tags', z.array(TagResponseSchema));
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
