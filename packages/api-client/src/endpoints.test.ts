import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMasters, getMaster, getLocations, getServices, getActivities, getActivity, createActivity, updateActivity, deleteActivity, getWebPhotos } from './endpoints';

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
