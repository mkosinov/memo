/**
 * Shared mock data for frontend tests.
 *
 * Import these constants instead of defining per-file mocks.
 * All data is minimal but realistic — enough to test most UI paths.
 */
import type { Artist, Service, Activity, Location } from '@memo/domain';
import type {
  RecordResponse,
  ClientResponse,
  ClientWithStats,
  VisitorResponse,
  VisitResponse,
  PaymentResponse,
  LocationResponse,
} from '@memo/api-client';

// Tariff shape (mirrors API TariffResponse, used by SettingsTab via type cast)
interface Tariff {
  id: string;
  service_id: string;
  title: string;
  price: number;
  description: string | null;
}

// Service with tariffs — SettingsTab casts Service to this shape
type ServiceWithTariffs = Service & { tariffs: Tariff[] };

// ─── Domain types ─────────────────────────────────────────────────────────

export const mockArtists: Artist[] = [
  { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
];

export const mockServices: ServiceWithTariffs[] = [
  {
    id: 's1',
    name: 'Картина маслом',
    duration: 2.5,
    maxCapacity: 8,
    minAge: '12',
    maxAge: '99',
    defaultAdultPrice: 3500,
    defaultChildPrice: 2500,
    defaultIndividualPrice: 5000,
    tariffs: [
      { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
      { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
    ],
  },
  {
    id: 's2',
    name: 'Картина акрилом',
    duration: 2,
    maxCapacity: 10,
    minAge: '6',
    maxAge: '99',
    defaultAdultPrice: 2800,
    defaultChildPrice: 2000,
    defaultIndividualPrice: 4000,
    tariffs: [
      { id: 't3', service_id: 's2', title: 'Взрослый', price: 2800, description: null },
    ],
  },
];

export const mockLocations: Location[] = [
  { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж' },
  { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
];

export const mockActivity: Activity = {
  id: 'ev_1',
  day: 5,
  masterId: 'm1',
  startTime: 14,
  duration: 2.5,
  serviceId: 's1',
  serviceName: 'Картина маслом',
  minAge: '12',
  locationId: 'grand',
  occupied: 3,
  capacity: 8,
  isPrivate: false,
};

// ─── API response types ───────────────────────────────────────────────────

export const mockClient: ClientResponse = {
  id: 'c1',
  name: 'Анна Иванова',
  phone: '+7 (900) 123-45-67',
  email: null,
  channel: 'telegram',
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  is_active: true,
};

export const mockClientWithStats: ClientWithStats = {
  ...mockClient,
  visits_count: 5,
  last_visit: '2026-05-15T14:00:00',
  total_paid: 17500,
  missed_visits: 1,
};

export const mockVisitor: VisitorResponse = {
  id: 'vis1',
  client_id: 'c1',
  name: 'Анна Иванова',
  age: 30,
  created_at: '',
  updated_at: '',
  is_active: true,
};

export const mockVisit: VisitResponse = {
  id: 'v1',
  record_id: 'r1',
  visitor_id: 'vis1',
  price: 3500,
  status: 'waiting',
  created_at: '',
  updated_at: '',
  is_active: true,
};

export const mockRecord: RecordResponse = {
  id: 'r1',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  comment: null,
  custom_price: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  is_active: true,
  visits: [mockVisit],
};

export const mockPayment: PaymentResponse = {
  id: 'p1',
  record_id: 'r1',
  amount: 3500,
  method: 'card',
  created_at: '',
  updated_at: '',
  is_active: true,
};

// ─── Tariffs (used by SettingsTab, NewBookingTab, ClientTab) ──────────────

export const mockTariffs = [
  { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
  { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
];

// ─── LocationResponse (API shape) ────────────────────────────────────────

export const mockLocationResponse: LocationResponse = {
  id: 'loc-1',
  name: 'Студия на Невском',
  address: 'Невский пр. 28',
  description: 'Уютная студия',
  capacity: 10,
  yandex_map_url: 'https://yandex.ru/maps/...',
  review_url: null,
  record_info: 'Запись по телефону',
  image_url: 'https://example.com/studio.jpg',
  location_hint: 'Вход со двора',
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

export const mockLocationResponseArchived: LocationResponse = {
  id: 'loc-2',
  name: 'Гранд Отель Поляна',
  address: 'Гранд Отель, лобби',
  description: null,
  capacity: 20,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  location_hint: null,
  is_active: false,
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
