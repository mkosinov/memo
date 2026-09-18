/**
 * Shared mock data for frontend tests.
 *
 * Import these constants instead of defining per-file mocks.
 * All data is minimal but realistic — enough to test most UI paths.
 */
import type { Master, Service, Location, ScheduleAdminDTO } from '@memo/domain';
import type {
  RecordResponse,
  ClientResponse,
  ClientWithStats,
  VisitorResponse,
  VisitResponse,
  PaymentResponse,
  LocationResponse,
  ServiceResponse,
  MasterViewResponse,
  StaffResponse,
  PositionResponse,
  MyProfile,
} from '@memo/api-client';

// ─── Domain types ─────────────────────────────────────────────────────────

export const mockMasters: Master[] = [
  { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
];

export const mockServices: Service[] = [
  {
    id: 's1',
    name: 'Картина маслом',
    durationMinutes: 150,
    minAge: '12',
    maxAge: '99',
    defaultAdultPrice: 3500,
    defaultChildPrice: 2500,
    defaultIndividualPrice: 5000,
    tariffs: [
      { id: 't1', title: 'Взрослый', price: 3500, description: null },
      { id: 't2', title: 'Детский', price: 2500, description: null },
    ],
  },
  {
    id: 's2',
    name: 'Картина акрилом',
    durationMinutes: 120,
    minAge: '6',
    maxAge: '99',
    defaultAdultPrice: 2800,
    defaultChildPrice: 2000,
    defaultIndividualPrice: 4000,
    tariffs: [
      { id: 't3', title: 'Взрослый', price: 2800, description: null },
    ],
  },
];

export const mockLocations: Location[] = [
  { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж' },
  { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
];

/**
 * Factory for ScheduleAdminDTO fixtures (GH #142 — integer minutes from
 * midnight, no decimal-hour fields). Pass any field via `overrides`.
 */
export function createMockScheduleItem(
  overrides: Partial<ScheduleAdminDTO> & { id: string } = { id: 'ev_1' },
): ScheduleAdminDTO {
  return {
    day: 0,
    masterId: 'm1',
    serviceId: 's1',
    locationId: 'alpika',
    masterName: 'Ольга Середа',
    masterColor: '#5B8C7A',
    serviceTitle: 'Картина маслом',
    date: '2026-06-15',
    time: '10:00',
    startMinutes: 600,
    durationMinutes: 120,
    locationName: 'Альпика',
    minAge: '12',
    occupied: 3,
    capacity: 8,
    isPrivate: false,
    comment: '',
    priceMin: 0,
    priceMax: 0,
    ...overrides,
  };
}

export const mockActivity: ScheduleAdminDTO = createMockScheduleItem({
  id: 'ev_1',
  day: 5,
  date: '2026-06-13', // Saturday — matches day index 5 (Mon=0)
  time: '14:00',
  startMinutes: 840,
  durationMinutes: 150,
  locationId: 'grand',
  locationName: 'Гранд Отель Поляна',
  maxAge: '99',
});

// ─── API response types ───────────────────────────────────────────────────

export const mockClient: ClientResponse = {
  id: 'c1',
  name: 'Анна Иванова',
  phone: '+7 (900) 123-45-67',
  email: null,
  channel: 'telegram',
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  archived: false,
};

export const mockClientWithStats: ClientWithStats = {
  ...mockClient,
  records_count: 5,
  last_record: '2026-05-15T14:00:00',
  total_paid: 17500,
  missed_records: 1,
};

export const mockVisitor: VisitorResponse = {
  id: 'vis1',
  client_id: 'c1',
  name: 'Анна Иванова',
  age: 30,
  created_at: '',
  updated_at: '',
};

export const mockVisit: VisitResponse = {
  id: 'v1',
  record_id: 'r1',
  visitor_id: 'vis1',
  price: 3500,
  custom_price: null,
  status: 'waiting',
  created_at: '',
  updated_at: '',
};

export const mockRecord: RecordResponse = {
  id: 'r1',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'visited',
  seats: 1,
  comment: null,
  custom_price: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  visits: [mockVisit],
};

export const mockPayment: PaymentResponse = {
  id: 'p1',
  record_id: 'r1',
  amount: 3500,
  method: 'card',
  created_at: '',
  updated_at: '',
};

// ─── Tariffs (used by SettingsTab, NewRecordTab, ClientTab) ───────────────

export const mockTariffs = [
  { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
  { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
];

// ─── LocationResponse (API shape) ────────────────────────────────────────

export const mockLocationResponse: LocationResponse = {
  id: 'loc-1',
  title: 'Студия на Невском',
  address: 'Невский пр. 28',
  description: 'Уютная студия',
  capacity: 10,
  yandex_map_url: 'https://yandex.ru/maps/...',
  review_url: null,
  record_info: 'Запись по телефону',
  image_url: 'https://example.com/studio.jpg',
  location_hint: 'Вход со двора',
  sort_order: 0,
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

export const mockLocationResponseArchived: LocationResponse = {
  id: 'loc-2',
  title: 'Гранд Отель Поляна',
  address: 'Гранд Отель, лобби',
  description: null,
  capacity: 20,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  location_hint: null,
  sort_order: 1,
  archived: true,
  created_at: '2024-01-10T10:00:00Z',
  updated_at: '2024-05-01T12:00:00Z',
};

/** Factory for creating LocationResponse objects with overrides. */
export function createMockLocationResponse(
  overrides: Partial<LocationResponse> = {},
): LocationResponse {
  return {
    ...mockLocationResponse,
    ...overrides,
  };
}

// ─── ServiceResponse (API shape, GH #267 schedule dictionary consumers) ───

export const mockServiceResponse: ServiceResponse = {
  id: 's1',
  title: 'Картина маслом',
  description: '',
  image_url: '',
  specialty: '',
  min_age: 12,
  max_age: 99,
  duration: 150,
  record_info: '',
  tariffs: [
    { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
    { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
  ],
  tags: [],
  materials: [],
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

/** Factory for creating ServiceResponse objects with overrides. */
export function createMockServiceResponse(
  overrides: Partial<ServiceResponse> = {},
): ServiceResponse {
  return {
    ...mockServiceResponse,
    ...overrides,
  };
}

// ─── MasterViewResponse (read-only /masters view, GH #266) ────────────────
// The view returns ACTING masters only (masters.is_active = true), so there is
// no `position` field — positions live on the staff card (StaffResponse).
// `archived` (GH #267) mirrors masters.is_active: the paginated list stays
// acting-only (always false here); /all with status=all|archived can differ.
// Consumers no longer client-filter by archived (S2: an archived master
// simply leaves the list server-side).

export const mockMasterResponse: MasterViewResponse = {
  id: 'm1',
  first_name: 'Ольга',
  last_name: 'Середа',
  color: '#5B8C7A',
  specialty: 'живопись',
  avatar_url: 'https://example.com/avatar.jpg',
  sort_order: 0,
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

/** A second acting master (distinct color) — for multi-row view assertions. */
export const mockMasterResponse2: MasterViewResponse = {
  id: 'm2',
  first_name: 'Юлия',
  last_name: 'Большакова',
  color: '#6B7E9C',
  specialty: 'керамика',
  avatar_url: null,
  sort_order: 1,
  archived: false,
  created_at: '2024-01-10T10:00:00Z',
  updated_at: '2024-05-01T12:00:00Z',
};

/** An ARCHIVED master row (status=all slice, GH #267) — feeds DayView archived columns. */
export const mockMasterResponseArchived: MasterViewResponse = {
  id: 'm-arch',
  first_name: 'Пётр',
  last_name: 'Архивов',
  color: '#9A5870',
  specialty: 'графика',
  avatar_url: null,
  sort_order: 5,
  archived: true,
  created_at: '2023-03-01T10:00:00Z',
  updated_at: '2024-02-01T12:00:00Z',
};

/** Factory for creating MasterViewResponse objects with overrides. */
export function createMockMasterResponse(
  overrides: Partial<MasterViewResponse> = {},
): MasterViewResponse {
  return {
    ...mockMasterResponse,
    ...overrides,
  };
}

// ─── StaffResponse (composite staff card, GH #266 «Сотрудники» screen) ────
// `archived` = the PERSON flag (staff.is_active inverted); `master.archived` =
// the schedule flag (masters.is_active inverted) — three independent flags D3.
// `has_user` drives the «Архивировать учётку» dismissal-checkbox visibility (D6).

export const mockStaffResponse: StaffResponse = {
  id: 'm1',
  first_name: 'Ольга',
  last_name: 'Середа',
  avatar_url: 'https://example.com/avatar.jpg',
  sort_order: 0,
  master: {
    specialty: 'живопись',
    color: '#5B8C7A',
    archived: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
  },
  position_ids: ['master'],
  has_user: false,
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

export const mockStaffResponseArchived: StaffResponse = {
  id: 'm2',
  first_name: 'Юлия',
  last_name: 'Большакова',
  avatar_url: null,
  sort_order: 1,
  master: {
    specialty: 'керамика',
    color: '#6B7E9C',
    archived: true,
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-05-01T12:00:00Z',
  },
  position_ids: ['master'],
  has_user: true,
  archived: true,
  created_at: '2024-01-10T10:00:00Z',
  updated_at: '2024-05-01T12:00:00Z',
};

/** A staff card WITHOUT a master section (e.g. СММ) — S1: invisible in /masters. */
export const mockStaffResponseNoMaster: StaffResponse = {
  id: 's-smm',
  first_name: 'Светлана',
  last_name: 'СММова',
  avatar_url: null,
  sort_order: 9,
  master: null,
  position_ids: ['smm'],
  has_user: false,
  archived: false,
  created_at: '2024-02-01T10:00:00Z',
  updated_at: '2024-02-01T10:00:00Z',
};

/** Factory for creating StaffResponse objects with overrides. */
export function createMockStaffResponse(
  overrides: Partial<StaffResponse> = {},
): StaffResponse {
  return {
    ...mockStaffResponse,
    ...overrides,
  };
}

// ─── PositionResponse (positions dictionary, GH #266 D4) ──────────────────
// The seed dictionary: built-ins «master»/«admin» carry FIXED string ids and
// is_system (title editable, deletion forbidden server-side), the
// user-defined «СММ» is a plain deletable row. Consumers: StaffTable (id →
// title cells), StaffModal (checkboxes), and the /positions directory screen.

/** Built-in «master» — fixed id, is_system, title freely editable (D4). */
export const mockPositionMaster: PositionResponse = {
  id: 'master',
  title: 'Мастер',
  is_system: true,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:00:00Z',
};

/** Built-in «admin» — the second fixed anchor (D4). */
export const mockPositionAdmin: PositionResponse = {
  id: 'admin',
  title: 'Администратор',
  is_system: true,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:00:00Z',
};

/** User-defined «СММ» — seed row with a free lifecycle (uuid ids in real data). */
export const mockPositionSmm: PositionResponse = {
  id: 'smm',
  title: 'СММ',
  is_system: false,
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:00:00Z',
};

/** The whole seed dictionary — the shape /positions/all returns. */
export const mockPositions: PositionResponse[] = [
  mockPositionMaster,
  mockPositionAdmin,
  mockPositionSmm,
];

/** Factory for creating PositionResponse objects with overrides. */
export function createMockPositionResponse(
  overrides: Partial<PositionResponse> = {},
): PositionResponse {
  return {
    ...mockPositionSmm,
    ...overrides,
  };
}

// ─── MyProfile (GH #262 «Мои данные» — GET/PUT /api/v1/my flat shape) ────────
// Public half from the staff card / master section; private half from the
// lazily created user_profiles row. `has_staff`/`has_master` drive the field
// visibility rules (D2/D4/D7). All fields mirror MyProfileSchema.

/** A master with a linked staff card — the full «Мои данные» form (S3/S4). */
export const mockMyProfileMaster: MyProfile = {
  role: 'master',
  has_staff: true,
  has_master: true,
  first_name: 'Ольга',
  last_name: 'Середа',
  avatar_url: '/api/v1/files/avatar/o.png',
  specialties: ['живопись', 'графика'],
  patronymic: 'Ивановна',
  birth_date: '1990-05-13',
  residence_address: 'Невский пр. 28',
  birth_place: 'Ленинград',
  passport_series_number: '40 123456',
  passport_issued_date: '2010-06-01',
  passport_issued_by: 'УФМС по СПб',
  registration_address: 'ул. Рубинштейна 1',
};

/** A staff member WITHOUT a master section (e.g. СММ) — has_master: false. */
export const mockMyProfileStaffNoMaster: MyProfile = {
  ...mockMyProfileMaster,
  role: 'admin',
  has_master: false,
  specialties: null,
};

/** A user with no staff card (D7/S6) — names/specialties/portrait hidden. */
export const mockMyProfileNoCard: MyProfile = {
  ...mockMyProfileMaster,
  role: 'admin',
  has_staff: false,
  has_master: false,
  first_name: null,
  last_name: null,
  avatar_url: null,
  specialties: null,
};

/** Factory for creating MyProfile objects with overrides. */
export function createMockMyProfile(
  overrides: Partial<MyProfile> = {},
): MyProfile {
  return {
    ...mockMyProfileMaster,
    ...overrides,
  };
}
