import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { getMasters, getMaster, getLocations, getServices, getActivities, getActivity, createActivity, updateActivity, deleteActivity, getWebPhotos, getRecords, getClients, getPayments, createRecord, updateRecord, deleteRecord, patchRecord, createPayment, updatePayment, deletePayment, createVisitor, updateVisitor, patchVisitor, deleteVisitor, searchClientByPhone, updateVisitStatus, getTags, createService, updateService, deleteService, createLocation, updateLocation, deleteLocation, getClientsWithStats, patchClient, reorderMasters, reorderLocations } from './endpoints';
import { ServiceCreateSchema, LocationCreateSchema } from './schemas';

// Mock the api function from client
vi.mock('./client', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { api } from './client';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Masters ────────────────────────────────────────────────────────────────

describe('getMasters', () => {
  it('calls /api/v1/masters with array schema', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getMasters();
    expect(api).toHaveBeenCalledWith('/api/v1/masters', expect.anything());
  });
});

describe('getMaster', () => {
  it('calls /api/v1/masters/:id with master schema', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'm-1' });
    await getMaster('m-1');
    expect(api).toHaveBeenCalledWith('/api/v1/masters/m-1', expect.anything());
  });
});

describe('reorderMasters', () => {
  it('calls PUT /api/v1/masters/reorder with ids', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await reorderMasters(['m2', 'm1', 'm3']);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/masters/reorder',
      expect.anything(),
      {
        method: 'PUT',
        body: JSON.stringify({ ids: ['m2', 'm1', 'm3'] }),
      },
    );
  });
});

// ─── Locations ──────────────────────────────────────────────────────────────

describe('getLocations', () => {
  it('calls /api/v1/locations with array schema', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getLocations();
    expect(api).toHaveBeenCalledWith('/api/v1/locations', expect.anything());
  });
});

describe('reorderLocations', () => {
  it('calls PUT /api/v1/locations/reorder with ids', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await reorderLocations(['loc2', 'loc1', 'loc3']);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations/reorder',
      expect.anything(),
      {
        method: 'PUT',
        body: JSON.stringify({ ids: ['loc2', 'loc1', 'loc3'] }),
      },
    );
  });
});

// ─── Services ──────────────────────────────────────────────────────────────

describe('getServices', () => {
  it('calls /api/v1/services with array schema', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getServices();
    expect(api).toHaveBeenCalledWith('/api/v1/services', expect.anything());
  });
});

// ─── Photos ─────────────────────────────────────────────────────────────────

describe('getWebPhotos', () => {
  it('calls /api/v1/photos/web without query params', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getWebPhotos();
    expect(api).toHaveBeenCalledWith('/api/v1/photos/web', expect.anything());
  });

  it('calls /api/v1/photos/web with activity_id param', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getWebPhotos({ activity_id: 'activity-1' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/photos/web?activity_id=activity-1',
      expect.anything(),
    );
  });
});

// ─── Activities ─────────────────────────────────────────────────────────────

describe('getActivities', () => {
  it('calls /api/v1/activities with date_from and date_to params', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getActivities({ date_from: '2024-01-01', date_to: '2024-01-07' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities?date_from=2024-01-01&date_to=2024-01-07',
      expect.anything(),
    );
  });
});

describe('getActivity', () => {
  it('calls /api/v1/activities/:id', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'a-1' });
    await getActivity('a-1');
    expect(api).toHaveBeenCalledWith('/api/v1/activities/a-1', expect.anything());
  });
});

describe('createActivity', () => {
  it('calls POST /api/v1/activities with snake_case body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'a-1' });
    const data = {
      master_id: 'm-1',
      service_id: 's-1',
      location_id: 'l-1',
      start: '2024-12-25T14:00:00Z',
      duration: 180,
      capacity: 10,
    };
    await createActivity(data);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });
});

describe('updateActivity', () => {
  it('calls PUT /api/v1/activities/:id (not PATCH)', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'a-1' });
    await updateActivity('a-1', { duration: 120 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities/a-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ duration: 120 }),
      }),
    );
  });
});

describe('deleteActivity', () => {
  it('calls DELETE /api/v1/activities/:id', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteActivity('a-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities/a-1',
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

// ─── Records ────────────────────────────────────────────────────────────────

describe('getRecords', () => {
  it('calls /api/v1/records without params', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getRecords();
    expect(api).toHaveBeenCalledWith('/api/v1/records', expect.anything());
  });

  it('calls /api/v1/records with date_from and date_to params', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getRecords({ date_from: '2024-01-01', date_to: '2024-01-07' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?date_from=2024-01-01&date_to=2024-01-07',
      expect.anything(),
    );
  });

  it('calls /api/v1/records with only date_from', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getRecords({ date_from: '2024-01-01' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?date_from=2024-01-01',
      expect.anything(),
    );
  });
});

// ─── Clients ────────────────────────────────────────────────────────────────

describe('getClients', () => {
  it('calls /api/v1/clients with array schema', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getClients();
    expect(api).toHaveBeenCalledWith('/api/v1/clients', expect.anything());
  });
});

// ─── Clients With Stats ──────────────────────────────────────────────────────

describe('getClientsWithStats', () => {
  it('calls /api/v1/clients with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsWithStats({ page: 1, per_page: 20 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?page=1&per_page=20',
      expect.anything(),
    );
  });

  it('skips undefined and null params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsWithStats({ page: 1, search: undefined, channel: null });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?page=1',
      expect.anything(),
    );
  });

  it('skips empty string params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsWithStats({ page: 1, search: '' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?page=1',
      expect.anything(),
    );
  });
});

// ─── Patch Client ────────────────────────────────────────────────────────────

describe('patchClient', () => {
  it('calls PATCH /api/v1/clients/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', name: 'Updated' });
    await patchClient('c-1', { name: 'Updated' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients/c-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
      }),
    );
  });

  it('sends only provided fields', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', phone: '+79991234567' });
    await patchClient('c-1', { phone: '+79991234567' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients/c-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ phone: '+79991234567' }),
      }),
    );
  });
});

// ─── Payments ───────────────────────────────────────────────────────────────

describe('getPayments', () => {
  it('calls /api/v1/payments without params', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getPayments();
    expect(api).toHaveBeenCalledWith('/api/v1/payments', expect.anything());
  });

  it('calls /api/v1/payments with record_id param', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getPayments({ record_id: 'r-1' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments?record_id=r-1',
      expect.anything(),
    );
  });
});

// ─── Records CRUD ─────────────────────────────────────────────────────────

describe('createRecord', () => {
  it('calls POST /api/v1/records with body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'r-1' });
    const data = { activity_id: 'a-1', seats: 2, status: 'confirmed' as const };
    await createRecord(data);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });
});

describe('updateRecord', () => {
  it('calls PUT /api/v1/records/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'r-1' });
    await updateRecord('r-1', { seats: 3 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/r-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ seats: 3 }),
      }),
    );
  });
});

describe('deleteRecord', () => {
  it('calls DELETE /api/v1/records/:id', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteRecord('r-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/r-1',
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('patchRecord', () => {
  it('calls PATCH /api/v1/records/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'r-1', status: 'confirmed' });
    await patchRecord('r-1', { status: 'confirmed' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/r-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'confirmed' }),
      }),
    );
  });

  it('sends only provided fields', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'r-1', custom_price: 5000 });
    await patchRecord('r-1', { custom_price: 5000 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/r-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ custom_price: 5000 }),
      }),
    );
  });
});

// ─── Payments CRUD ────────────────────────────────────────────────────────

describe('createPayment', () => {
  it('calls POST /api/v1/payments with body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'p-1' });
    const data = { record_id: 'r-1', amount: 5000, method: 'card' as const };
    await createPayment(data);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });
});

describe('updatePayment', () => {
  it('calls PUT /api/v1/payments/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'p-1' });
    await updatePayment('p-1', { amount: 3000 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments/p-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ amount: 3000 }),
      }),
    );
  });
});

describe('deletePayment', () => {
  it('calls DELETE /api/v1/payments/:id', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deletePayment('p-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments/p-1',
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

// ─── Visitors CRUD ────────────────────────────────────────────────────────

describe('createVisitor', () => {
  it('calls POST /api/v1/visitors with body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'v-1' });
    const data = { client_id: 'c-1', name: 'Маша' };
    await createVisitor(data);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/visitors',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });
});

describe('updateVisitor', () => {
  it('calls PUT /api/v1/visitors/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'v-1' });
    await updateVisitor('v-1', { name: 'Мария' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/visitors/v-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Мария' }),
      }),
    );
  });
});

describe('patchVisitor', () => {
  it('calls PATCH /api/v1/visitors/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'v-1' });
    await patchVisitor('v-1', { name: 'Мария' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/visitors/v-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Мария' }),
      }),
    );
  });
});

describe('deleteVisitor', () => {
  it('calls DELETE /api/v1/visitors/:id', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteVisitor('v-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/visitors/v-1',
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

// ─── Client Search ────────────────────────────────────────────────────────

describe('searchClientByPhone', () => {
  it('calls GET /api/v1/clients/search with encoded phone', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', phone: '+79991234567' });
    await searchClientByPhone('+79991234567');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients/search?phone=%2B79991234567',
      expect.anything(),
    );
  });
});

// ─── Visit Status ─────────────────────────────────────────────────────────

describe('updateVisitStatus', () => {
  it('calls PUT /api/v1/visits/:id/status with body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'vis-1', status: 'visited' });
    await updateVisitStatus('vis-1', 'visited');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/visits/vis-1/status',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'visited' }),
      }),
    );
  });
});

// ─── Tags ──────────────────────────────────────────────────────────────────

describe('getTags', () => {
  it('calls /api/v1/tags with array schema', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getTags();
    expect(api).toHaveBeenCalledWith('/api/v1/tags', expect.anything());
  });
});

// ─── Services CRUD ─────────────────────────────────────────────────────────

describe('createService', () => {
  it('calls POST /api/v1/services with body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 's-1' });
    const data: z.input<typeof ServiceCreateSchema> = { title: 'Рисование', duration: 90 };
    await createService(data);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/services',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });
});

describe('updateService', () => {
  it('calls PUT /api/v1/services/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 's-1' });
    await updateService('s-1', { title: 'Обновлённое' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/services/s-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ title: 'Обновлённое' }),
      }),
    );
  });
});

describe('deleteService', () => {
  it('calls DELETE /api/v1/services/:id', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteService('s-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/services/s-1',
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

// ─── Locations CRUD ────────────────────────────────────────────────────────

describe('createLocation', () => {
  it('calls POST /api/v1/locations with body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1' });
    const data: z.input<typeof LocationCreateSchema> = { name: 'Новая студия', capacity: 20 };
    await createLocation(data);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  });
});

describe('updateLocation', () => {
  it('calls PUT /api/v1/locations/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1' });
    await updateLocation('l-1', { name: 'Обновлённая' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations/l-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Обновлённая' }),
      }),
    );
  });
});

describe('deleteLocation', () => {
  it('calls DELETE /api/v1/locations/:id', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteLocation('l-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations/l-1',
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
