import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { getMasters, getMaster, getLocations, getServices, getActivities, getActivity, createActivity, updateActivity, deleteActivity, getWebPhotos, getRecords, getClients, getPayments, getPaymentTotals, createRecord, updateRecord, deleteRecord, patchRecord, createPayment, updatePayment, deletePayment, createVisitor, updateVisitor, patchVisitor, deleteVisitor, searchClientByPhone, updateVisitStatus, getTags, createService, updateService, deleteService, createLocation, updateLocation, deleteLocation, getClientsWithStats, updateClient, patchClient, reorderMasters, reorderLocations, patchMaster, patchLocation, patchMaterial, patchService, patchUserSettings, getMaterials, getTag, getVisitors, deleteMaster, deleteMaterial, deleteClient, archiveMaster, restoreMaster, resolveDeleteMaster, archiveLocation, restoreLocation, resolveDeleteLocation, archiveService, restoreService, resolveDeleteService, archiveMaterial, restoreMaterial, resolveDeleteMaterial, archiveClient, restoreClient, resolveDeleteClient, resolveDeleteRecord, getAllMasters, getAllLocations, getAllServices, getAllMaterials, getAllTags } from './endpoints';
import { ServiceCreateSchema, LocationCreateSchema, type ServiceUpdate, type LocationUpdate, type ClientUpdate } from './schemas';

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
  it('calls /api/v1/masters without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters();
    expect(api).toHaveBeenCalledWith('/api/v1/masters', expect.anything());
  });

  it('calls /api/v1/masters with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getMasters({ per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/masters?per_page=100', expect.anything());
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
  it('calls /api/v1/locations without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getLocations();
    expect(api).toHaveBeenCalledWith('/api/v1/locations', expect.anything());
  });

  it('calls /api/v1/locations with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 100 });
    await getLocations({ page: 2, per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/locations?page=2&per_page=100', expect.anything());
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
  it('calls /api/v1/services without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getServices();
    expect(api).toHaveBeenCalledWith('/api/v1/services', expect.anything());
  });

  it('calls /api/v1/services with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getServices({ per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/services?per_page=100', expect.anything());
  });
});

// ─── Materials ──────────────────────────────────────────────────────────────

describe('getMaterials', () => {
  it('calls /api/v1/materials without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMaterials();
    expect(api).toHaveBeenCalledWith('/api/v1/materials', expect.anything());
  });

  it('calls /api/v1/materials with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getMaterials({ per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/materials?per_page=100', expect.anything());
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
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getActivities({ date_from: '2024-01-01', date_to: '2024-01-07' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities?date_from=2024-01-01&date_to=2024-01-07',
      expect.anything(),
    );
  });

  it('calls /api/v1/activities with date range and pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getActivities({ date_from: '2024-01-01', date_to: '2024-01-07', per_page: 100 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities?date_from=2024-01-01&date_to=2024-01-07&per_page=100',
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
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords();
    expect(api).toHaveBeenCalledWith('/api/v1/records', expect.anything());
  });

  it('calls /api/v1/records with date_from and date_to params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({ date_from: '2024-01-01', date_to: '2024-01-07' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?date_from=2024-01-01&date_to=2024-01-07',
      expect.anything(),
    );
  });

  it('calls /api/v1/records with only date_from', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({ date_from: '2024-01-01' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?date_from=2024-01-01',
      expect.anything(),
    );
  });

  it('calls /api/v1/records with filters and pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 100 });
    await getRecords({ client_id: 'c-1', page: 2, per_page: 100 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?client_id=c-1&page=2&per_page=100',
      expect.anything(),
    );
  });

  it('sends all new filter and sort params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({
      date_from: '2026-08-03',
      date_to: '2026-08-09',
      location_id: 'l-1',
      service_id: 's-1',
      master_id: 'm-1',
      status: 'waiting',
      activity_id: 'a-1',
      sort_by: 'payment',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records?date_from=2026-08-03&date_to=2026-08-09&activity_id=a-1&location_id=l-1&service_id=s-1&master_id=m-1&status=waiting&sort_by=payment&sort_order=desc&page=2&per_page=50',
      expect.anything(),
    );
  });

  it('omits empty/undefined params from the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({ page: 1, per_page: 10, status: undefined, location_id: undefined });
    expect(api).toHaveBeenCalledWith('/api/v1/records?page=1&per_page=10', expect.anything());
  });
});

// ─── Clients ────────────────────────────────────────────────────────────────

describe('getClients', () => {
  it('calls /api/v1/clients?per_page=100 and returns the items array', async () => {
    const item = { id: 'c-1', name: 'Иван' };
    vi.mocked(api).mockResolvedValue({ items: [item], total: 1, page: 1, per_page: 100 });
    const result = await getClients();
    expect(api).toHaveBeenCalledWith('/api/v1/clients?per_page=100', expect.anything());
    expect(result).toEqual([item]);
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

// ─── Update Client (GH #201) ────────────────────────────────────────────────

describe('updateClient', () => {
  it('calls PUT /api/v1/clients/:id with full typed body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1' });
    const payload: ClientUpdate = {
      name: 'Updated', phone: null, email: null,
      channel: 'whatsapp',
    };
    await updateClient('c-1', payload);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients/c-1',
      expect.anything(),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) }),
    );
  });
});

// ─── Payments ───────────────────────────────────────────────────────────────

describe('getPayments', () => {
  it('calls /api/v1/payments without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPayments();
    expect(api).toHaveBeenCalledWith('/api/v1/payments', expect.anything());
  });

  it('calls /api/v1/payments with record_id param', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPayments({ record_id: 'r-1' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments?record_id=r-1',
      expect.anything(),
    );
  });

  it('calls /api/v1/payments with record_id and pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getPayments({ record_id: 'r-1', per_page: 100 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments?record_id=r-1&per_page=100',
      expect.anything(),
    );
  });
});

describe('getPaymentTotals', () => {
  it('calls /api/v1/payments/totals with repeated record_ids params', async () => {
    vi.mocked(api).mockResolvedValue({ totals: { 'r-1': 4500, 'r-2': 1500 } });
    await getPaymentTotals(['r-1', 'r-2']);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/payments/totals?record_ids=r-1&record_ids=r-2',
      expect.anything(),
    );
  });

  it('calls /api/v1/payments/totals without query string for empty ids', async () => {
    vi.mocked(api).mockResolvedValue({ totals: {} });
    await getPaymentTotals([]);
    expect(api).toHaveBeenCalledWith('/api/v1/payments/totals', expect.anything());
  });

  it('returns the plain record_id -> total map', async () => {
    vi.mocked(api).mockResolvedValue({ totals: { r1: 4500 } });
    const result = await getPaymentTotals(['r1']);
    expect(result).toEqual({ r1: 4500 });
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
  it('calls /api/v1/tags without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getTags();
    expect(api).toHaveBeenCalledWith('/api/v1/tags', expect.anything());
  });

  it('calls /api/v1/tags with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getTags({ per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/tags?per_page=100', expect.anything());
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
  it('calls PUT /api/v1/services/:id with full body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 's-1' });
    const payload: ServiceUpdate = {
      title: 'Обновлённое',
      description: '',
      image_url: '',
      specialty: '',
      min_age: 0,
      max_age: 18,
      duration: 60,
      record_info: '',
      material_hint: '',
      tariffs: [],
      tag_ids: [],
    };
    await updateService('s-1', payload);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/services/s-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(payload),
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
  it('calls PUT /api/v1/locations/:id with full body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1' });
    const payload: LocationUpdate = {
      name: 'Обновлённая',
      short_title: '',
      address: '',
      description: '',
      capacity: 10,
      yandex_map_url: '',
      review_url: '',
      record_info: '',
      image_url: '',
      location_hint: '',
      tag_ids: [],
    };
    await updateLocation('l-1', payload);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations/l-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(payload),
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

describe('patchMaster', () => {
  it('calls PATCH /api/v1/masters/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'm-1' });
    await patchMaster('m-1', { first_name: 'Анна' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/masters/m-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ first_name: 'Анна' }),
      }),
    );
  });
});

describe('patchLocation', () => {
  it('calls PATCH /api/v1/locations/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1' });
    await patchLocation('l-1', { name: 'Обновлённая' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations/l-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Обновлённая' }),
      }),
    );
  });
});

describe('patchMaterial', () => {
  it('calls PATCH /api/v1/materials/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'mat-1' });
    await patchMaterial('mat-1', { title: 'Новая глина' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/materials/mat-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Новая глина' }),
      }),
    );
  });
});

describe('patchService', () => {
  it('calls PATCH /api/v1/services/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 's-1' });
    await patchService('s-1', { title: 'Новое название' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/services/s-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Новое название' }),
      }),
    );
  });
});

describe('patchUserSettings', () => {
  it('calls PATCH /api/v1/user-settings?user_id= with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ user_id: 'u-1' });
    await patchUserSettings('u-1', { locale: 'en' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/user-settings?user_id=u-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ locale: 'en' }),
      }),
    );
  });
});

describe('getTag', () => {
  it('calls /api/v1/tags/:id with tag schema', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't-1', tag: 'VIP' });
    await getTag('t-1');
    expect(api).toHaveBeenCalledWith('/api/v1/tags/t-1', expect.anything());
  });
});

describe('getVisitors', () => {
  it('calls /api/v1/visitors without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getVisitors();
    expect(api).toHaveBeenCalledWith('/api/v1/visitors', expect.anything());
  });

  it('calls /api/v1/visitors with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    await getVisitors({ per_page: 100 });
    expect(api).toHaveBeenCalledWith('/api/v1/visitors?per_page=100', expect.anything());
  });
});

// ─── Deletes — masters / materials / clients (GH #207) ──────────────────────

describe('deleteMaster', () => {
  it('calls DELETE /api/v1/masters/:id with no body (dry-run / instant path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteMaster('m-1');
    expect(api).toHaveBeenCalledWith('/api/v1/masters/m-1', expect.anything(), {
      method: 'DELETE',
    });
  });
});

describe('deleteMaterial', () => {
  it('calls DELETE /api/v1/materials/:id with no body (dry-run / instant path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteMaterial('mat-1');
    expect(api).toHaveBeenCalledWith('/api/v1/materials/mat-1', expect.anything(), {
      method: 'DELETE',
    });
  });
});

describe('deleteClient', () => {
  it('calls DELETE /api/v1/clients/:id with no body (dry-run / instant path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteClient('c-1');
    expect(api).toHaveBeenCalledWith('/api/v1/clients/c-1', expect.anything(), {
      method: 'DELETE',
    });
  });
});

// ─── Archive / restore / resolveDelete (GH #207) ────────────────────────────

describe('archiveMaster', () => {
  it('calls POST /api/v1/masters/:id/archive and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'm-1', archived: true });
    const result = await archiveMaster('m-1');
    expect(api).toHaveBeenCalledWith('/api/v1/masters/m-1/archive', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'm-1', archived: true });
  });
});

describe('restoreMaster', () => {
  it('calls POST /api/v1/masters/:id/restore and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'm-1', archived: false });
    const result = await restoreMaster('m-1');
    expect(api).toHaveBeenCalledWith('/api/v1/masters/m-1/restore', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'm-1', archived: false });
  });
});

describe('resolveDeleteMaster', () => {
  it('calls DELETE /api/v1/masters/:id with resolutions body (execute path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteMaster('m-1', {});
    expect(api).toHaveBeenCalledWith('/api/v1/masters/m-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ resolutions: {} }),
    });
  });
});

describe('archiveLocation', () => {
  it('calls POST /api/v1/locations/:id/archive and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1', archived: true });
    const result = await archiveLocation('l-1');
    expect(api).toHaveBeenCalledWith('/api/v1/locations/l-1/archive', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'l-1', archived: true });
  });
});

describe('restoreLocation', () => {
  it('calls POST /api/v1/locations/:id/restore and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1', archived: false });
    const result = await restoreLocation('l-1');
    expect(api).toHaveBeenCalledWith('/api/v1/locations/l-1/restore', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'l-1', archived: false });
  });
});

describe('resolveDeleteLocation', () => {
  it('calls DELETE /api/v1/locations/:id with resolutions body (execute path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteLocation('l-1', {});
    expect(api).toHaveBeenCalledWith('/api/v1/locations/l-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ resolutions: {} }),
    });
  });
});

describe('archiveService', () => {
  it('calls POST /api/v1/services/:id/archive and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 's-1', archived: true });
    const result = await archiveService('s-1');
    expect(api).toHaveBeenCalledWith('/api/v1/services/s-1/archive', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 's-1', archived: true });
  });
});

describe('restoreService', () => {
  it('calls POST /api/v1/services/:id/restore and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 's-1', archived: false });
    const result = await restoreService('s-1');
    expect(api).toHaveBeenCalledWith('/api/v1/services/s-1/restore', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 's-1', archived: false });
  });
});

describe('resolveDeleteService', () => {
  it('calls DELETE /api/v1/services/:id with resolutions body (execute path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteService('s-1', {});
    expect(api).toHaveBeenCalledWith('/api/v1/services/s-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ resolutions: {} }),
    });
  });
});

describe('archiveMaterial', () => {
  it('calls POST /api/v1/materials/:id/archive and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'mat-1', archived: true });
    const result = await archiveMaterial('mat-1');
    expect(api).toHaveBeenCalledWith('/api/v1/materials/mat-1/archive', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'mat-1', archived: true });
  });
});

describe('restoreMaterial', () => {
  it('calls POST /api/v1/materials/:id/restore and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'mat-1', archived: false });
    const result = await restoreMaterial('mat-1');
    expect(api).toHaveBeenCalledWith('/api/v1/materials/mat-1/restore', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'mat-1', archived: false });
  });
});

describe('resolveDeleteMaterial', () => {
  it('calls DELETE /api/v1/materials/:id with resolutions body (execute path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteMaterial('mat-1', {});
    expect(api).toHaveBeenCalledWith('/api/v1/materials/mat-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ resolutions: {} }),
    });
  });
});

describe('archiveClient', () => {
  it('calls POST /api/v1/clients/:id/archive and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', archived: true });
    const result = await archiveClient('c-1');
    expect(api).toHaveBeenCalledWith('/api/v1/clients/c-1/archive', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'c-1', archived: true });
  });
});

describe('restoreClient', () => {
  it('calls POST /api/v1/clients/:id/restore and returns the parsed entity', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', archived: false });
    const result = await restoreClient('c-1');
    expect(api).toHaveBeenCalledWith('/api/v1/clients/c-1/restore', expect.anything(), {
      method: 'POST',
    });
    expect(result).toEqual({ id: 'c-1', archived: false });
  });
});

describe('resolveDeleteClient', () => {
  it('calls DELETE /api/v1/clients/:id with resolutions body (execute path, NOT POST)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteClient('c-1', { records: 'nullify', visitors: 'cascade' });
    expect(api).toHaveBeenCalledWith('/api/v1/clients/c-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ resolutions: { records: 'nullify', visitors: 'cascade' } }),
    });
  });
});

describe('resolveDeleteRecord', () => {
  it('calls DELETE /api/v1/records/:id with resolutions body (execute path, NOT POST)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteRecord('r-1', { visits: 'cascade', payments: 'cascade' });
    expect(api).toHaveBeenCalledWith('/api/v1/records/r-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ resolutions: { visits: 'cascade', payments: 'cascade' } }),
    });
  });
});

// ─── listQuery status param (GH #195) ───────────────────────────────────────

describe('listQuery status param', () => {
  it('serializes status=archived into the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({ status: 'archived' });
    expect(api).toHaveBeenCalledWith('/api/v1/masters?status=archived', expect.anything());
  });

  it('serializes status=all into the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({ status: 'all' });
    expect(api).toHaveBeenCalledWith('/api/v1/masters?status=all', expect.anything());
  });

  it('serializes status=active into the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({ status: 'active' });
    expect(api).toHaveBeenCalledWith('/api/v1/masters?status=active', expect.anything());
  });

  it('omits status when null', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({ status: null });
    expect(api).toHaveBeenCalledWith('/api/v1/masters', expect.anything());
  });

  it('omits status when not provided', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({});
    expect(api).toHaveBeenCalledWith('/api/v1/masters', expect.anything());
  });
});

// ─── listQuery sort params (GH #205) ────────────────────────────────────────

describe('listQuery sort params', () => {
  it('serializes sort_by and sort_order into the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 50 });
    await getMasters({ page: 2, per_page: 50, sort_by: 'name', sort_order: 'desc' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/masters?page=2&per_page=50&sort_by=name&sort_order=desc',
      expect.anything(),
    );
  });

  it('omits sort params when not provided', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({});
    expect(api).toHaveBeenCalledWith('/api/v1/masters', expect.anything());
  });
});

// ─── Dictionary bare /all endpoints (GH #205) ───────────────────────────────

describe('getAllMasters', () => {
  it('calls GET /api/v1/masters/all and returns the parsed bare array', async () => {
    const master = { id: 'm-1', first_name: 'Анна', last_name: 'Иванова' };
    vi.mocked(api).mockResolvedValue([master]);
    const result = await getAllMasters();
    expect(api).toHaveBeenCalledWith('/api/v1/masters/all', expect.anything());
    expect(result).toEqual([master]);
  });

  it('serializes status=all into the URL', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAllMasters({ status: 'all' });
    expect(api).toHaveBeenCalledWith('/api/v1/masters/all?status=all', expect.anything());
  });
});

describe('getAllLocations', () => {
  it('calls GET /api/v1/locations/all', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAllLocations();
    expect(api).toHaveBeenCalledWith('/api/v1/locations/all', expect.anything());
  });
});

describe('getAllServices', () => {
  it('calls GET /api/v1/services/all', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAllServices();
    expect(api).toHaveBeenCalledWith('/api/v1/services/all', expect.anything());
  });
});

describe('getAllMaterials', () => {
  it('calls GET /api/v1/materials/all', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAllMaterials();
    expect(api).toHaveBeenCalledWith('/api/v1/materials/all', expect.anything());
  });
});

describe('getAllTags', () => {
  it('calls GET /api/v1/tags/all with no params', async () => {
    const tag = { id: 't-1', tag: 'VIP' };
    vi.mocked(api).mockResolvedValue([tag]);
    const result = await getAllTags();
    expect(api).toHaveBeenCalledWith('/api/v1/tags/all', expect.anything());
    expect(result).toEqual([tag]);
  });
});
