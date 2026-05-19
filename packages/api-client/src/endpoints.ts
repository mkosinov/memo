import { z } from 'zod';
import {
  ActivitySchema,
  ArtistSchema,
  LocationSchema,
  ServiceSchema,
  BookingRecordSchema,
  ClientSchema,
  type Activity,
  type Artist,
  type Location,
  type Service,
  type BookingRecord,
  type Client,
} from '@memo/domain';
import { api } from './client';

// ─── Activities ───────────────────────────────────────────────────────────

export async function getActivities(params: {
  date_from: string;
  date_to: string;
  location_id?: string;
}): Promise<Activity[]> {
  const search = new URLSearchParams();
  search.set('date_from', params.date_from);
  search.set('date_to', params.date_to);
  if (params.location_id) search.set('location_id', params.location_id);
  return api(`/api/activities?${search.toString()}`, z.array(ActivitySchema));
}

export async function getActivity(id: string): Promise<Activity> {
  return api(`/api/activities/${id}`, ActivitySchema);
}

export async function createActivity(data: Omit<Activity, 'id'>): Promise<Activity> {
  return api('/api/activities', ActivitySchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateActivity(id: string, data: Partial<Activity>): Promise<Activity> {
  return api(`/api/activities/${id}`, ActivitySchema, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteActivity(id: string): Promise<void> {
  await api(`/api/activities/${id}`, z.any(), { method: 'DELETE' });
}

// ─── Artists ──────────────────────────────────────────────────────────────

export async function getArtists(): Promise<Artist[]> {
  return api('/api/artists', z.array(ArtistSchema));
}

// ─── Locations ────────────────────────────────────────────────────────────

export async function getLocations(): Promise<Location[]> {
  return api('/api/locations', z.array(LocationSchema));
}

// ─── Services ─────────────────────────────────────────────────────────────

export async function getServices(): Promise<Service[]> {
  return api('/api/services', z.array(ServiceSchema));
}

// ─── Bookings ─────────────────────────────────────────────────────────────

export async function getBookings(params?: {
  status?: string;
  location_id?: string;
  date_from?: string;
  date_to?: string;
}): Promise<BookingRecord[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.location_id) search.set('location_id', params.location_id);
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  return api(`/api/bookings?${search.toString()}`, z.array(BookingRecordSchema));
}

export async function getBooking(id: string): Promise<BookingRecord> {
  return api(`/api/bookings/${id}`, BookingRecordSchema);
}

export async function createBooking(data: {
  activity_id: string;
  client_id?: string;
  visitors: { name: string; age?: number; is_adult: boolean }[];
  payment_method?: 'cash' | 'card' | 'transfer';
  comment?: string;
}): Promise<BookingRecord> {
  return api('/api/bookings', BookingRecordSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Clients ──────────────────────────────────────────────────────────────

export async function getClients(): Promise<Client[]> {
  return api('/api/clients', z.array(ClientSchema));
}

export async function getClient(id: string): Promise<Client> {
  return api(`/api/clients/${id}`, ClientSchema);
}

export async function searchClientByPhone(phone: string): Promise<Client | null> {
  const results = await api(`/api/clients?phone=${encodeURIComponent(phone)}`, z.array(ClientSchema));
  return results[0] ?? null;
}
