import { z } from 'zod';
import { api } from './client';
import {
  MasterResponseSchema,
  type MasterResponse,
  LocationResponseSchema,
  type LocationResponse,
  ServiceResponseSchema,
  type ServiceResponse,
  ActivityCreateSchema,
  type ActivityCreate,
  ActivityResponseSchema,
  type ActivityResponse,
  PhotoResponseSchema,
  type PhotoResponse,
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

export async function deleteActivity(id: string): Promise<void> {
  await api(`/api/v1/activities/${id}`, z.any(), { method: 'DELETE' });
}
