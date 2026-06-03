import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMasters, getMaster, getLocations, getServices, getActivities, getActivity, createActivity, updateActivity, deleteActivity, getWebPhotos, getRecords, getClients, getPayments, createRecord, updateRecord, deleteRecord, createPayment, updatePayment, deletePayment, createVisitor, updateVisitor, deleteVisitor, searchClientByPhone, updateVisitStatus } from './endpoints';

// Mock the api function from client
vi.mock('./client', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
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

// ─── Locations ──────────────────────────────────────────────────────────────

describe('getLocations', () => {
  it('calls /api/v1/locations with array schema', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getLocations();
    expect(api).toHaveBeenCalledWith('/api/v1/locations', expect.anything());
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
