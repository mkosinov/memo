import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import * as endpointsModule from './endpoints';
import { getMasters, getAllMasters, getStaff, getStaffById, getAllStaff, createStaff, updateStaff, patchStaff, archiveStaff, restoreStaff, deleteStaff, resolveDeleteStaff, getPositions, getAllPositions, getPosition, createPosition, updatePosition, patchPosition, deletePosition, getLocations, getServices, getActivities, getActivity, createActivity, updateActivity, dryRunDeleteActivity, deleteActivityWithExpected, copyWeek, getWebPhotos, getPhotos, getClientsPaged, getRecords, getRecordsView, getClientById, getPayments, getPaymentTotals, createRecord, updateRecord, dryRunDeleteRecord, patchRecord, createPayment, updatePayment, deletePayment, createVisitor, updateVisitor, patchVisitor, deleteVisitor, getClientByPhone, updateVisitStatus, getTags, createService, updateService, deleteService, createLocation, updateLocation, deleteLocation, getClientsWithStats, updateClient, patchClient, reorderLocations, patchLocation, patchMaterial, patchService, patchUserSettings, getUserSettings, updateUserSettings, getMaterials, getTag, getVisitors, deleteMaterial, deleteClient, archiveLocation, restoreLocation, resolveDeleteLocation, archiveService, restoreService, resolveDeleteService, archiveMaterial, restoreMaterial, resolveDeleteMaterial, archiveClient, restoreClient, resolveDeleteClient, resolveDeleteRecord, dryRunDeleteTag, resolveDeleteTag, getAllLocations, getAllServices, getAllMaterials, getAllTags, login, logout, getMe, getMyProfile, updateMyProfile, uploadPortrait, changePassword, getAuditLogs, getAuditLogAuthors } from './endpoints';
import { ServiceCreateSchema, LocationCreateSchema, ActivityResponseSchema, PhotoListResponseSchema, ClientListResponseSchema, ClientResponseSchema, RecordViewListResponseSchema, type ServiceUpdate, type LocationUpdate, type ClientUpdate } from './schemas';

// Mock the api function from client
vi.mock('./client', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
      public dependencies?: unknown[],
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { api, ApiError } from './client';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Masters (read-only view, GH #266 D8) ──────────────────────────────────

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

// ─── Staff (GH #266 — full directory CRUD) ─────────────────────────────────

describe('getStaff', () => {
  it('calls /api/v1/staff without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getStaff();
    expect(api).toHaveBeenCalledWith('/api/v1/staff', expect.anything());
  });

  it('calls /api/v1/staff with pagination + status + q params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 50 });
    await getStaff({ page: 2, per_page: 50, status: 'archived', q: 'ив' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/staff?page=2&per_page=50&status=archived&q=%D0%B8%D0%B2',
      expect.anything(),
    );
  });

  it('calls /api/v1/staff with sort params (whitelist: name/specialty/color/avatar/status)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getStaff({ sort_by: 'specialty', sort_order: 'desc' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/staff?sort_by=specialty&sort_order=desc',
      expect.anything(),
    );
  });
});

describe('getAllStaff', () => {
  it('calls /api/v1/staff/all with status param', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAllStaff({ status: 'all' });
    expect(api).toHaveBeenCalledWith('/api/v1/staff/all?status=all', expect.anything());
  });
});

describe('getStaffById', () => {
  it('calls /api/v1/staff/:id (including archived people)', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1' });
    await getStaffById('st-1');
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1', expect.anything());
  });
});

describe('createStaff', () => {
  it('calls POST /api/v1/staff with master block, position_ids and create_user', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1' });
    await createStaff({
      first_name: 'Анна',
      last_name: 'Иванова',
      master: { specialty: 'живопись', color: '#5B8C7A' },
      position_ids: ['master'],
      create_user: { phone: '+79991234567', password: 'secret123' },
    });
    expect(api).toHaveBeenCalledWith('/api/v1/staff', expect.anything(), {
      method: 'POST',
      body: JSON.stringify({
        first_name: 'Анна',
        last_name: 'Иванова',
        master: { specialty: 'живопись', color: '#5B8C7A' },
        position_ids: ['master'],
        create_user: { phone: '+79991234567', password: 'secret123' },
      }),
    });
  });
});

describe('updateStaff', () => {
  it('calls PUT /api/v1/staff/:id with full card body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1' });
    await updateStaff('st-1', {
      first_name: 'Анна',
      last_name: 'Петрова',
      master: { specialty: 'керамика', color: '#AABBCC' },
      position_ids: [],
    });
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1', expect.anything(), {
      method: 'PUT',
      body: JSON.stringify({
        first_name: 'Анна',
        last_name: 'Петрова',
        master: { specialty: 'керамика', color: '#AABBCC' },
        position_ids: [],
      }),
    });
  });
});

describe('patchStaff', () => {
  it('calls PATCH /api/v1/staff/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1' });
    await patchStaff('st-1', { first_name: 'Пётр' });
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1', expect.anything(), {
      method: 'PATCH',
      body: JSON.stringify({ first_name: 'Пётр' }),
    });
  });
});

describe('archiveStaff', () => {
  it('calls POST /api/v1/staff/:id/archive with D6 checkbox body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1', archived: true });
    const result = await archiveStaff('st-1', { archive_master: false, archive_user: true });
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1/archive', expect.anything(), {
      method: 'POST',
      body: JSON.stringify({ archive_master: false, archive_user: true }),
    });
    expect(result.id).toBe('st-1');
  });

  it('NO-BODY call: checkboxes omitted = consent to preselected defaults (D6)', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1', archived: true });
    await archiveStaff('st-1');
    // No checkboxes passed → no body key at all: the request init carries ONLY
    // the method, letting the backend apply both defaults (true/true).
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1/archive', expect.anything(), {
      method: 'POST',
    });
  });
});

describe('restoreStaff', () => {
  it('calls POST /api/v1/staff/:id/restore with no body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'st-1', archived: false });
    await restoreStaff('st-1');
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1/restore', expect.anything(), {
      method: 'POST',
    });
  });
});

// ─── Positions (GH #266 D4 — dictionary CRUD) ──────────────────────────────

describe('getPositions', () => {
  it('calls /api/v1/positions without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPositions();
    expect(api).toHaveBeenCalledWith('/api/v1/positions', expect.anything());
  });
});

describe('getAllPositions', () => {
  it('calls /api/v1/positions/all (no params — plain dictionary)', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAllPositions();
    expect(api).toHaveBeenCalledWith('/api/v1/positions/all', expect.anything());
  });
});

describe('getPosition', () => {
  it('calls /api/v1/positions/:id', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'master' });
    await getPosition('master');
    expect(api).toHaveBeenCalledWith('/api/v1/positions/master', expect.anything());
  });
});

describe('createPosition', () => {
  it('calls POST /api/v1/positions with title', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'p-1' });
    await createPosition({ title: 'СММ' });
    expect(api).toHaveBeenCalledWith('/api/v1/positions', expect.anything(), {
      method: 'POST',
      body: JSON.stringify({ title: 'СММ' }),
    });
  });
});

describe('updatePosition', () => {
  it('calls PUT /api/v1/positions/:id with title', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'master' });
    await updatePosition('master', { title: 'Ведущий мастер' });
    expect(api).toHaveBeenCalledWith('/api/v1/positions/master', expect.anything(), {
      method: 'PUT',
      body: JSON.stringify({ title: 'Ведущий мастер' }),
    });
  });
});

describe('patchPosition', () => {
  it('calls PATCH /api/v1/positions/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'p-1' });
    await patchPosition('p-1', { title: 'SMM-менеджер' });
    expect(api).toHaveBeenCalledWith('/api/v1/positions/p-1', expect.anything(), {
      method: 'PATCH',
      body: JSON.stringify({ title: 'SMM-менеджер' }),
    });
  });
});

describe('deletePosition', () => {
  it('calls DELETE /api/v1/positions/:id with no body (system ones 422 server-side)', async () => {
    await deletePosition('p-1');
    expect(api).toHaveBeenCalledWith('/api/v1/positions/p-1', expect.anything(), {
      method: 'DELETE',
    });
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

  it('threads material_id into the query string (GH #223)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getServices({ material_id: 'm-1' });
    expect(api).toHaveBeenCalledWith('/api/v1/services?material_id=m-1', expect.anything());
  });

  it('composes material_id with status and pagination (GH #223)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 50 });
    await getServices({ status: 'active', material_id: 'm-1', page: 2, per_page: 50 });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/services?page=2&per_page=50&status=active&material_id=m-1',
      expect.anything(),
    );
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

// spec §10.2: GET /photos/web is UNCHANGED — bare array, no pagination envelope.
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

  it('still parses a bare array (GH #211 did not paginate /photos/web)', async () => {
    const photo = {
      id: 'photo-1',
      filename: 'workshop-2024.jpg',
      client_id: null,
      service_id: null,
      activity_id: 'activity-1',
      location_id: null,
      is_public: true,
      tags: [],
      client_name: null,
      created_at: '2024-06-01T12:00:00Z',
      updated_at: '2024-06-01T12:00:00Z',
    };
    vi.mocked(api).mockResolvedValue([photo]);
    const result = await getWebPhotos({ activity_id: 'activity-1' });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});

// GH #211: getPhotos now fetches the paginated server list with filters/sort.
describe('getPhotos', () => {
  it('calls /api/v1/photos without query string when no params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPhotos();
    expect(api).toHaveBeenCalledWith('/api/v1/photos', expect.anything());
  });

  it('parses the response with PhotoListResponseSchema', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPhotos();
    expect(api).toHaveBeenCalledWith('/api/v1/photos', PhotoListResponseSchema);
  });

  it('builds URL with pagination, q, filter, repeated tag_id and sort', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 20 });
    await getPhotos({
      page: 2,
      per_page: 20,
      q: 'керамика',
      client_id: 'c-1',
      tag_id: ['t-1', 't-2'],
      sort_by: 'created_at',
      sort_order: 'desc',
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/photos?page=2&per_page=20&q=%D0%BA%D0%B5%D1%80%D0%B0%D0%BC%D0%B8%D0%BA%D0%B0&client_id=c-1&tag_id=t-1&tag_id=t-2&sort_by=created_at&sort_order=desc',
      expect.anything(),
    );
  });

  it('serializes owner filters (location, activity, service)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPhotos({ location_id: 'l-1', activity_id: 'a-1', service_id: 's-1' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/photos?location_id=l-1&activity_id=a-1&service_id=s-1',
      expect.anything(),
    );
  });

  it('omits undefined and null params from the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPhotos({ page: 1, per_page: 20, client_id: undefined, tag_id: undefined });
    expect(api).toHaveBeenCalledWith('/api/v1/photos?page=1&per_page=20', expect.anything());
  });

  it('omits empty tag_id array (no repeated param emitted)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getPhotos({ page: 1, tag_id: [] });
    expect(api).toHaveBeenCalledWith('/api/v1/photos?page=1', expect.anything());
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

  it('calls /api/v1/activities without dates — dates are optional (GH #212)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getActivities({});
    expect(api).toHaveBeenCalledWith('/api/v1/activities', expect.anything());
  });

  it('serializes service_id and q params (GH #212)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getActivities({ service_id: 's-1', q: 'керамика' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities?service_id=s-1&q=%D0%BA%D0%B5%D1%80%D0%B0%D0%BC%D0%B8%D0%BA%D0%B0',
      expect.anything(),
    );
  });

  it('serializes all params — dates, service_id, q, pagination (GH #212)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 50 });
    await getActivities({
      date_from: '2024-01-01',
      date_to: '2024-01-07',
      service_id: 's-1',
      q: 'керамика',
      page: 2,
      per_page: 50,
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities?date_from=2024-01-01&date_to=2024-01-07&service_id=s-1&q=%D0%BA%D0%B5%D1%80%D0%B0%D0%BC%D0%B8%D0%BA%D0%B0&page=2&per_page=50',
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

// GH #286 (D2, mirror of #285 rev7): dry-run preview of activity deletion —
// DELETE ?dry_run=true, no body. 204 resolves, 409 (recursive tree: records →
// visits/payments, nodes carry items for one-line previews) is thrown by the
// client as ApiError with .dependencies.
describe('dryRunDeleteActivity', () => {
  it('calls DELETE /api/v1/activities/:id?dry_run=true with no body', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await dryRunDeleteActivity('a-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities/a-1?dry_run=true',
      expect.anything(),
      { method: 'DELETE' },
    );
  });

  it('propagates 409 ApiError with dependency tree (incl. node with items)', async () => {
    const tree = [
      {
        entity: 'records', auto: false, relation: 'Запись', count: 1, allowed_actions: ['cascade'],
        items: [{ id: 'uuid-record-1', label: 'Мастер-класс, 12.09, Иван' }],
      },
    ];
    const err = new ApiError(409, 'has_dependencies', 'has_dependencies', tree);
    vi.mocked(api).mockRejectedValue(err);
    let caught: unknown;
    try {
      await dryRunDeleteActivity('a-1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect((caught as ApiError).dependencies).toEqual(tree);
    expect((caught as ApiError).dependencies?.[0]?.items?.[0]?.id).toBe('uuid-record-1');
  });
});

// Execute path (GH #286 D2): `expected` is MANDATORY (bare DELETE without body
// → 422 expected_state_required server-side); id-sets snapshotted from the
// dry-run tree; backend answers 409 stale_dependencies on mismatch.
describe('deleteActivityWithExpected', () => {
  it('calls DELETE /api/v1/activities/:id with {expected} id-sets body', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteActivityWithExpected('a-1', {
      expected: { records: ['r-1'], visits: ['v-1'], payments: ['p-1'] },
    });
    expect(api).toHaveBeenCalledWith('/api/v1/activities/a-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ expected: { records: ['r-1'], visits: ['v-1'], payments: ['p-1'] } }),
    });
  });

  it('clean path: body is {"expected": {}}', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteActivityWithExpected('a-1', { expected: {} });
    expect(api).toHaveBeenCalledWith('/api/v1/activities/a-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ expected: {} }),
    });
  });

  it('passes through 422 ApiError (expected_state_required / stale_dependencies)', async () => {
    const err = new ApiError(422, 'expected state required', 'expected_state_required');
    vi.mocked(api).mockRejectedValue(err);
    await expect(
      deleteActivityWithExpected('a-1', { expected: { records: ['gone'] } }),
    ).rejects.toBe(err);
  });
});

// ─── copyWeek (#242: atomic last-week copy) ─────────────────────────────────

describe('copyWeek', () => {
  it('calls POST /api/v1/activities/copy-week with {week_start, locations}', async () => {
    const result = { copied: 8, skipped_duplicates: 2, skipped_filtered: 1, skipped_no_master: 0 };
    vi.mocked(api).mockResolvedValue(result);
    const params = { week_start: '2026-09-14', locations: ['alpika', 'gorny'] };
    await expect(copyWeek(params)).resolves.toEqual(result);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities/copy-week',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(params),
      }),
    );
  });

  it('propagates ApiError from 422 COPY_WEEK_* codes', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(422, 'Not Monday', 'COPY_WEEK_START_NOT_MONDAY'));
    await expect(copyWeek({ week_start: '2026-09-15', locations: ['alpika'] })).rejects.toMatchObject({
      code: 'COPY_WEEK_START_NOT_MONDAY',
    });
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

  it('serializes q param into the URL (GH #212)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecords({ q: 'иван' });
    expect(api).toHaveBeenCalledWith('/api/v1/records?q=%D0%B8%D0%B2%D0%B0%D0%BD', expect.anything());
  });
});

// ─── Records view (GH #213: composite read endpoint for the records table) ──

describe('getRecordsView', () => {
  it('calls /api/v1/records/view without params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecordsView();
    expect(api).toHaveBeenCalledWith('/api/v1/records/view', expect.anything());
  });

  it('calls /api/v1/records/view with date_from and date_to params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecordsView({ date_from: '2024-01-01', date_to: '2024-01-07' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/view?date_from=2024-01-01&date_to=2024-01-07',
      expect.anything(),
    );
  });

  it('sends all filter, sort and pagination params (parity with getRecords)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecordsView({
      date_from: '2026-08-03',
      date_to: '2026-08-09',
      client_id: 'c-1',
      activity_id: 'a-1',
      location_id: 'l-1',
      service_id: 's-1',
      master_id: 'm-1',
      status: 'waiting',
      q: 'иван',
      sort_by: 'payment',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/view?date_from=2026-08-03&date_to=2026-08-09&client_id=c-1&activity_id=a-1&location_id=l-1&service_id=s-1&master_id=m-1&status=waiting&q=%D0%B8%D0%B2%D0%B0%D0%BD&sort_by=payment&sort_order=desc&page=2&per_page=50',
      expect.anything(),
    );
  });

  it('omits empty/undefined params from the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecordsView({ page: 1, per_page: 10, status: undefined, location_id: undefined });
    expect(api).toHaveBeenCalledWith('/api/v1/records/view?page=1&per_page=10', expect.anything());
  });

  it('parses the response with the paginated RecordView schema', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getRecordsView();
    expect(api).toHaveBeenCalledWith('/api/v1/records/view', RecordViewListResponseSchema);
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

  // GH #232: ids → repeated `id` query keys (backend ≤100 after dedup)
  it('repeats the id query key for each element of ids', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsWithStats({
      page: 1,
      ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?page=1&id=11111111-1111-1111-1111-111111111111&id=22222222-2222-2222-2222-222222222222',
      expect.anything(),
    );
  });

  it('omits the id key entirely when ids is an empty array', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsWithStats({ page: 1, ids: [] });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?page=1',
      expect.anything(),
    );
  });

  it('omits the id key when ids is undefined', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsWithStats({ page: 1, ids: undefined });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?page=1',
      expect.anything(),
    );
  });
});

// ─── Clients Paged (GH #211: light paginated list for photo typeaheads) ─────

describe('getClientsPaged', () => {
  it('calls /api/v1/clients without query string when no params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsPaged({});
    expect(api).toHaveBeenCalledWith('/api/v1/clients', expect.anything());
  });

  it('serializes q, pagination and status params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
    await getClientsPaged({ q: 'анна', per_page: 10, page: 1, status: 'active' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients?q=%D0%B0%D0%BD%D0%BD%D0%B0&per_page=10&page=1&status=active',
      expect.anything(),
    );
  });

  it('serializes phone param (GH #221)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
    await getClientsPaged({ phone: '999123' });
    expect(api).toHaveBeenCalledWith('/api/v1/clients?phone=999123', expect.anything());
  });

  it('omits undefined and null params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsPaged({ q: undefined, status: undefined, page: undefined });
    expect(api).toHaveBeenCalledWith('/api/v1/clients', expect.anything());
  });

  it('parses the response with ClientListResponseSchema', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getClientsPaged({ status: 'active' });
    expect(api).toHaveBeenCalledWith('/api/v1/clients?status=active', ClientListResponseSchema);
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

// dry-run preview (GH #285 rev7): DELETE ?dry_run=true, no body. 204 resolves,
// 409 (dependency tree) is thrown by the client as ApiError with .dependencies.
describe('dryRunDeleteRecord', () => {
  it('calls DELETE /api/v1/records/:id?dry_run=true with no body', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await dryRunDeleteRecord('r-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/records/r-1?dry_run=true',
      expect.anything(),
      { method: 'DELETE' },
    );
  });

  it('propagates 409 ApiError with dependency tree (incl. node with items)', async () => {
    const tree = [
      {
        entity: 'visits', auto: false, relation: 'Визит', count: 2, allowed_actions: ['cascade'],
        items: [{ id: 'uuid-visit-1', label: 'Иван — 12.09 10:00' }],
      },
    ];
    const err = new ApiError(409, 'has_dependencies', 'has_dependencies', tree);
    vi.mocked(api).mockRejectedValue(err);
    let caught: unknown;
    try {
      await dryRunDeleteRecord('r-1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect((caught as ApiError).dependencies).toEqual(tree);
    expect((caught as ApiError).dependencies?.[0]?.items?.[0]?.id).toBe('uuid-visit-1');
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

// ─── Client Phone Lookup (GH #212: /clients/search → /clients/get) ──────────

describe('getClientByPhone', () => {
  it('calls GET /api/v1/clients/get with encoded phone', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', phone: '+79991234567' });
    await getClientByPhone('+79991234567');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/clients/get?phone=%2B79991234567',
      expect.anything(),
    );
  });

  it('propagates 404 as ApiError (CLIENT_NOT_FOUND, not swallowed)', async () => {
    // Mirror of the client.test.ts:23-35 extraction pattern: the booking
    // forms branch on the rejection falling into the create flow.
    vi.mocked(api).mockRejectedValue(
      new ApiError(404, 'Client not found', 'CLIENT_NOT_FOUND'),
    );
    let caught: unknown;
    try {
      await getClientByPhone('+00000000000');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(404);
    expect(err.code).toBe('CLIENT_NOT_FOUND');
    expect(err.message).toBe('Client not found');
  });
});

// ─── Client By ID (GH #213: per-id fetch for ClientQuickCard/modals) ────────

describe('getClientById', () => {
  it('calls GET /api/v1/clients/:id with the canonical client schema', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'c-1', name: 'Иван Петров' });
    const result = await getClientById('c-1');
    expect(api).toHaveBeenCalledWith('/api/v1/clients/c-1', ClientResponseSchema);
    expect(result).toEqual({ id: 'c-1', name: 'Иван Петров' });
  });

  it('propagates 404 as ApiError (CLIENT_NOT_FOUND)', async () => {
    vi.mocked(api).mockRejectedValue(
      new ApiError(404, 'Client not found', 'CLIENT_NOT_FOUND'),
    );
    let caught: unknown;
    try {
      await getClientById('missing-id');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
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
      tariffs: [],
      tag_ids: [],
      materials: [],
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
    const data: z.input<typeof LocationCreateSchema> = { title: 'Новая студия', capacity: 20 };
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
      title: 'Обновлённая',
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

describe('patchLocation', () => {
  it('calls PATCH /api/v1/locations/:id with partial body', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'l-1' });
    await patchLocation('l-1', { title: 'Обновлённая' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/locations/l-1',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Обновлённая' }),
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
  it('calls PATCH /api/v1/user-settings without user_id (session-derived, GH #247 §3.8)', async () => {
    vi.mocked(api).mockResolvedValue({ user_id: 'u-1' });
    await patchUserSettings({ language: 'en' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/user-settings',
      expect.anything(),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ language: 'en' }),
      }),
    );
  });
});

describe('getUserSettings', () => {
  it('calls GET /api/v1/user-settings without user_id (session-derived, GH #247 §3.8)', async () => {
    vi.mocked(api).mockResolvedValue({ user_id: 'u-1' });
    await getUserSettings();
    expect(api).toHaveBeenCalledWith('/api/v1/user-settings', expect.anything());
  });
});

describe('updateUserSettings', () => {
  it('calls PUT /api/v1/user-settings without user_id (session-derived, GH #247 §3.8)', async () => {
    vi.mocked(api).mockResolvedValue({ user_id: 'u-1' });
    await updateUserSettings({ theme: 'dark' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/user-settings',
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ theme: 'dark' }),
      }),
    );
  });
});

// GH #319 §5.6: the POST-create fallback is gone from the frontend and
// deleteUserSettings never had consumers — both client methods are removed.
// Server endpoints stay full CRUD.
describe('user-settings removed client methods (GH #319)', () => {
  it('no longer exports createUserSettings', () => {
    expect('createUserSettings' in endpointsModule).toBe(false);
  });

  it('no longer exports deleteUserSettings', () => {
    expect('deleteUserSettings' in endpointsModule).toBe(false);
  });
});

// ─── Auth (GH #247 spec §3.6/§4.1) ───────────────────────────────────────────

describe('login', () => {
  it('calls POST /api/v1/auth/login with phone and password', async () => {
    vi.mocked(api).mockResolvedValue({
      user: { id: 'u-1', phone: '+79990000001', role: 'admin', master_id: null, email: null },
      permissions: ['*'],
    });
    await login('+79990000001', 'secret123');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.anything(),
      {
        method: 'POST',
        body: JSON.stringify({ phone: '+79990000001', password: 'secret123' }),
      },
    );
  });
});

describe('logout', () => {
  it('calls POST /api/v1/auth/logout', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await logout();
    expect(api).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.anything(),
      { method: 'POST' },
    );
  });
});

describe('getMe', () => {
  it('calls GET /api/v1/auth/me and returns parsed body', async () => {
    const me = {
      user: { id: 'u-1', phone: '+79990000001', role: 'admin', master_id: null, email: null },
      permissions: ['*'],
    };
    vi.mocked(api).mockResolvedValue(me);
    await expect(getMe()).resolves.toEqual(me);
    expect(api).toHaveBeenCalledWith('/api/v1/auth/me', expect.anything());
  });

  it('resolves a 401 to null (guest bootstrap contract, spec §4.1)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(401, 'No session', 'AUTH_UNAUTHORIZED'));
    await expect(getMe()).resolves.toBeNull();
  });

  it('rethrows non-401 ApiErrors', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(500, 'Server error'));
    await expect(getMe()).rejects.toThrow(ApiError);
  });
});

// ─── My profile (GH #262 spec §4 — own data, session-guarded) ─────────────

describe('getMyProfile', () => {
  it('calls GET /api/v1/my', async () => {
    vi.mocked(api).mockResolvedValue({ role: 'admin', has_staff: false, has_master: false });
    await getMyProfile();
    expect(api).toHaveBeenCalledWith('/api/v1/my', expect.anything());
  });
});

describe('updateMyProfile', () => {
  it('calls PUT /api/v1/my with JSON body', async () => {
    vi.mocked(api).mockResolvedValue({ role: 'admin', has_staff: false, has_master: false });
    await updateMyProfile({ patronymic: 'Сергеевна' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/my',
      expect.anything(),
      {
        method: 'PUT',
        body: JSON.stringify({ patronymic: 'Сергеевна' }),
      },
    );
  });
});

describe('uploadPortrait', () => {
  it('calls POST /api/v1/my/portrait with multipart FormData (field "file")', async () => {
    vi.mocked(api).mockResolvedValue({ avatar_url: '/api/v1/files/avatar/x.png' });
    const file = new File([new Uint8Array([1, 2, 3])], 'portrait.png', { type: 'image/png' });
    await uploadPortrait(file);
    expect(api).toHaveBeenCalledWith(
      '/api/v1/my/portrait',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
    const [, , init] = vi.mocked(api).mock.calls[0] as unknown as [string, unknown, RequestInit];
    const body = init.body as FormData;
    expect(body.get('file')).toBe(file);
  });
});

describe('changePassword', () => {
  it('calls POST /api/v1/auth/change-password with the pair', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await changePassword({ current_password: 'old123', new_password: 'new456' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/auth/change-password',
      expect.anything(),
      {
        method: 'POST',
        body: JSON.stringify({ current_password: 'old123', new_password: 'new456' }),
      },
    );
   });
});

describe('getTag', () => {
  it('calls /api/v1/tags/:id with tag schema', async () => {
    vi.mocked(api).mockResolvedValue({ id: 't-1', title: 'VIP' });
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

// ─── Deletes — staff / materials / clients (GH #207; staff replaces masters, #266) ──

describe('deleteStaff', () => {
  it('calls DELETE /api/v1/staff/:id with no body (dry-run / instant path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await deleteStaff('st-1');
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1', expect.anything(), {
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

describe('resolveDeleteStaff', () => {
  it('calls DELETE /api/v1/staff/:id with resolutions body (execute path)', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteStaff('st-1', {});
    expect(api).toHaveBeenCalledWith('/api/v1/staff/st-1', expect.anything(), {
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

// GH #285 rev7: `expected` (id-множества, uuid strings) обязателен — контракт
// «каждое удаление несёт состояние». resolutions остаётся опциональным.
describe('resolveDeleteRecord', () => {
  it('pure path: body is {"expected": {}} without resolutions key', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteRecord('r-1', { expected: {} });
    expect(api).toHaveBeenCalledWith('/api/v1/records/r-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ expected: {} }),
    });
  });

  it('sends both expected and resolutions when provided', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteRecord('r-1', {
      resolutions: { visits: 'cascade' },
      expected: { visits: ['uuid-1', 'uuid-2'] },
    });
    expect(api).toHaveBeenCalledWith('/api/v1/records/r-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({
        expected: { visits: ['uuid-1', 'uuid-2'] },
        resolutions: { visits: 'cascade' },
      }),
    });
  });
});

// ─── Tags delete: dry-run + resolve (GH #318, mirror of records GH #285 rev7) ─

// dry-run preview: DELETE ?dry_run=true, no body. 204 resolves, 409 dependency
// tree is thrown by the client as ApiError with .dependencies.
describe('dryRunDeleteTag', () => {
  it('calls DELETE /api/v1/tags/:id?dry_run=true with no body', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await dryRunDeleteTag('t-1');
    expect(api).toHaveBeenCalledWith(
      '/api/v1/tags/t-1?dry_run=true',
      expect.anything(),
      { method: 'DELETE' },
    );
  });

  it('propagates 409 ApiError with dependency tree (incl. node with items)', async () => {
    const tree = [
      {
        entity: 'records', auto: false, relation: 'Запись', count: 1, allowed_actions: ['nullify'],
        items: [{ id: 'uuid-record-1', label: 'Иван — 12.09 10:00' }],
      },
    ];
    const err = new ApiError(409, 'has_dependencies', 'has_dependencies', tree);
    vi.mocked(api).mockRejectedValue(err);
    let caught: unknown;
    try {
      await dryRunDeleteTag('t-1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect((caught as ApiError).dependencies).toEqual(tree);
    expect((caught as ApiError).dependencies?.[0]?.items?.[0]?.id).toBe('uuid-record-1');
  });
});

// GH #318: body contract mirrors records — {expected, resolutions?}.
// `expected` (uuid id-sets snapshotted from the dry-run tree) is mandatory;
// resolutions (nullify/cascade) optional — pure path sends only expected.
describe('resolveDeleteTag', () => {
  it('pure path: body is {"expected": {}} without resolutions key', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteTag('t-1', { expected: {} });
    expect(api).toHaveBeenCalledWith('/api/v1/tags/t-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({ expected: {} }),
    });
  });

  it('sends both expected and resolutions when provided', async () => {
    vi.mocked(api).mockResolvedValue(undefined);
    await resolveDeleteTag('t-1', {
      resolutions: { records: 'nullify' },
      expected: { records: ['uuid-1', 'uuid-2'] },
    });
    expect(api).toHaveBeenCalledWith('/api/v1/tags/t-1', expect.anything(), {
      method: 'DELETE',
      body: JSON.stringify({
        expected: { records: ['uuid-1', 'uuid-2'] },
        resolutions: { records: 'nullify' },
      }),
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
    const tag = { id: 't-1', title: 'VIP' };
    vi.mocked(api).mockResolvedValue([tag]);
    const result = await getAllTags();
    expect(api).toHaveBeenCalledWith('/api/v1/tags/all', expect.anything());
    expect(result).toEqual([tag]);
  });
});

// ─── listQuery q param — server-side search (GH #212) ──────────────────────

describe('listQuery q param (GH #212)', () => {
  it('serializes q into the URL', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({ q: 'анна' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/masters?q=%D0%B0%D0%BD%D0%BD%D0%B0',
      expect.anything(),
    );
  });

  it('serializes q together with pagination params', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 2, per_page: 50 });
    await getTags({ page: 2, per_page: 50, q: 'vip' });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/tags?page=2&per_page=50&q=vip',
      expect.anything(),
    );
  });

  it('omits q when empty string (server requires min 2 chars)', async () => {
    vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });
    await getMasters({ q: '' });
    expect(api).toHaveBeenCalledWith('/api/v1/masters', expect.anything());
  });
});

// ─── ActivityResponseSchema service_title (GH #212) ────────────────────────

const baseActivity = {
  id: 'a-1',
  master_id: 'm-1',
  service_id: 's-1',
  location_id: 'l-1',
  start: '2024-01-01T10:00:00Z',
  duration: 120,
  capacity: 10,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  occupied: 3,
};

describe('ActivityResponseSchema service_title (GH #212)', () => {
  it('parses service_title present as string', () => {
    const result = ActivityResponseSchema.parse({ ...baseActivity, service_title: 'Керамика' });
    expect(result.service_title).toBe('Керамика');
  });

  it('parses service_title present as null', () => {
    const result = ActivityResponseSchema.parse({ ...baseActivity, service_title: null });
    expect(result.service_title).toBeNull();
  });

  it('parses when service_title is absent (backward-compatible)', () => {
    const result = ActivityResponseSchema.parse(baseActivity);
    expect(result.service_title).toBeUndefined();
  });
});

// ─── Audit log reading API (GH #344, spec §6 — admin-only reads) ───────────

describe('getAuditLogs', () => {
  const emptyPage = { items: [], total: 0, page: 1, per_page: 20 };

  it('calls /api/v1/audit-logs without params', async () => {
    vi.mocked(api).mockResolvedValue(emptyPage);
    await getAuditLogs();
    expect(api).toHaveBeenCalledWith('/api/v1/audit-logs', expect.anything());
  });

  it('sends pagination + all conjunctive filters', async () => {
    vi.mocked(api).mockResolvedValue(emptyPage);
    await getAuditLogs({
      page: 2,
      per_page: 50,
      user_id: 'u-1',
      action: 'update',
      entity: 'clients',
      date_from: '2026-09-01',
      date_to: '2026-09-20',
    });
    expect(api).toHaveBeenCalledWith(
      '/api/v1/audit-logs?page=2&per_page=50&user_id=u-1&action=update&entity=clients&date_from=2026-09-01&date_to=2026-09-20',
      expect.anything(),
    );
  });

  it('omits unset filters entirely', async () => {
    vi.mocked(api).mockResolvedValue(emptyPage);
    await getAuditLogs({ page: 1 });
    expect(api).toHaveBeenCalledWith('/api/v1/audit-logs?page=1', expect.anything());
  });
});

describe('getAuditLogAuthors', () => {
  it('calls /api/v1/audit-logs/authors', async () => {
    vi.mocked(api).mockResolvedValue([]);
    await getAuditLogAuthors();
    expect(api).toHaveBeenCalledWith('/api/v1/audit-logs/authors', expect.anything());
  });
});
