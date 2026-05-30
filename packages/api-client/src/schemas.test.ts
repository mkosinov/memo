import { describe, it, expect } from 'vitest';
import {
  MasterResponseSchema,
  type MasterResponse,
  LocationResponseSchema,
  type LocationResponse,
  TariffResponseSchema,
  TagResponseSchema,
  ServiceResponseSchema,
  type ServiceResponse,
  ActivityCreateSchema,
  type ActivityCreate,
  ActivityResponseSchema,
  type ActivityResponse,
} from './schemas';

// ─── MasterResponse ────────────────────────────────────────────────────────

const validMaster = {
  id: 'master-1',
  first_name: 'Анна',
  last_name: 'Иванова',
  color: '#FF6B6B',
  position: 'мастер',
  specialty: 'живопись',
  avatar_url: 'https://example.com/avatar.jpg',
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('MasterResponseSchema', () => {
  it('parses a valid master response', () => {
    const result = MasterResponseSchema.parse(validMaster);
    expect(result.id).toBe('master-1');
    expect(result.first_name).toBe('Анна');
    expect(result.last_name).toBe('Иванова');
    expect(result.color).toBe('#FF6B6B');
    expect(result.position).toBe('мастер');
    expect(result.specialty).toBe('живопись');
    expect(result.avatar_url).toBe('https://example.com/avatar.jpg');
    expect(result.is_active).toBe(true);
  });

  it('parses master with nullable avatar_url', () => {
    const data = { ...validMaster, avatar_url: null };
    const result = MasterResponseSchema.parse(data);
    expect(result.avatar_url).toBeNull();
  });

  it('rejects missing required field', () => {
    const { first_name, ...without } = validMaster;
    expect(() => MasterResponseSchema.parse(without)).toThrow();
  });
});

// ─── LocationResponse ──────────────────────────────────────────────────────

const validLocation = {
  id: 'loc-1',
  name: 'Студия на Невском',
  address: 'Невский пр. 28',
  description: 'Уютная студия',
  capacity: 10,
  yandex_map_url: 'https://yandex.ru/maps/...',
  review_url: 'https://yandex.ru/reviews/...',
  record_info: 'Запись по телефону',
  image_url: 'https://example.com/studio.jpg',
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('LocationResponseSchema', () => {
  it('parses a valid location response', () => {
    const result = LocationResponseSchema.parse(validLocation);
    expect(result.id).toBe('loc-1');
    expect(result.name).toBe('Студия на Невском');
    expect(result.capacity).toBe(10);
  });

  it('parses location with nullable fields', () => {
    const data = { ...validLocation, address: null, description: null };
    const result = LocationResponseSchema.parse(data);
    expect(result.address).toBeNull();
    expect(result.description).toBeNull();
  });

  it('rejects missing name', () => {
    const { name, ...without } = validLocation;
    expect(() => LocationResponseSchema.parse(without)).toThrow();
  });
});

// ─── ServiceResponse ────────────────────────────────────────────────────────

const validTariff = {
  id: 'tariff-1',
  service_id: 'service-1',
  title: 'Взрослый',
  description: 'Билет для взрослого',
  price: 2500,
};

const validTag = {
  id: 'tag-1',
  tag: 'масло',
};

const validService = {
  id: 'service-1',
  title: 'Мастер-класс по живописи',
  description: 'Научитесь писать маслом',
  image_url: 'https://example.com/painting.jpg',
  specialty: 'живопись',
  min_age: 6,
  max_age: 99,
  duration: 180,
  record_info: 'Запись за 24 часа',
  tariffs: [validTariff],
  tags: [validTag],
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('ServiceResponseSchema', () => {
  it('parses a valid service response with nested tariffs and tags', () => {
    const result = ServiceResponseSchema.parse(validService);
    expect(result.id).toBe('service-1');
    expect(result.title).toBe('Мастер-класс по живописи');
    expect(result.min_age).toBe(6);
    expect(result.max_age).toBe(99);
    expect(result.duration).toBe(180);
    expect(result.tariffs).toHaveLength(1);
    expect(result.tariffs[0].title).toBe('Взрослый');
    expect(result.tariffs[0].price).toBe(2500);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].tag).toBe('масло');
  });

  it('parses service with empty tariffs and tags', () => {
    const data = { ...validService, tariffs: [], tags: [] };
    const result = ServiceResponseSchema.parse(data);
    expect(result.tariffs).toHaveLength(0);
    expect(result.tags).toHaveLength(0);
  });
});

// ─── ActivityCreate ─────────────────────────────────────────────────────────

const validActivityCreate = {
  master_id: 'master-1',
  service_id: 'service-1',
  location_id: 'loc-1',
  start: '2024-12-25T14:00:00Z',
  duration: 180,
  capacity: 10,
  is_private: false,
  comment: 'Комментарий',
  record_info: 'Запись обязательна',
};

describe('ActivityCreateSchema', () => {
  it('parses a valid activity create request', () => {
    const result = ActivityCreateSchema.parse(validActivityCreate);
    expect(result.master_id).toBe('master-1');
    expect(result.service_id).toBe('service-1');
    expect(result.start).toBe('2024-12-25T14:00:00Z');
    expect(result.duration).toBe(180);
    expect(result.is_private).toBe(false);
  });

  it('accepts minimal input without optional fields', () => {
    const minimal = {
      master_id: 'master-1',
      service_id: 'service-1',
      location_id: 'loc-1',
      start: '2024-12-25T14:00:00Z',
      duration: 180,
      capacity: 10,
    };
    const result = ActivityCreateSchema.parse(minimal);
    expect(result.is_private).toBeUndefined();
    expect(result.comment).toBeUndefined();
    expect(result.record_info).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    const { master_id, ...without } = validActivityCreate;
    expect(() => ActivityCreateSchema.parse(without)).toThrow();
  });
});

// ─── ActivityResponse ───────────────────────────────────────────────────────

const validActivityResponse = {
  ...validActivityCreate,
  id: 'activity-1',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  is_active: true,
  occupied: 3,
};

describe('ActivityResponseSchema', () => {
  it('parses a valid activity response', () => {
    const result = ActivityResponseSchema.parse(validActivityResponse);
    expect(result.id).toBe('activity-1');
    expect(result.occupied).toBe(3);
    expect(result.is_active).toBe(true);
  });

  it('rejects activity without occupied', () => {
    const { occupied: _, ...dataWithoutOccupied } = validActivityResponse;
    expect(() => ActivityResponseSchema.parse(dataWithoutOccupied)).toThrow();
  });
});

// ─── Type exports compile check ────────────────────────────────────────────

describe('Type exports', () => {
  it('MasterResponse is a valid type', () => {
    const m: MasterResponse = validMaster;
    expect(m.first_name).toBe('Анна');
  });

  it('LocationResponse is a valid type', () => {
    const l: LocationResponse = validLocation;
    expect(l.name).toBe('Студия на Невском');
  });

  it('ServiceResponse is a valid type', () => {
    const s: ServiceResponse = validService;
    expect(s.title).toBe('Мастер-класс по живописи');
  });

  it('ActivityCreate is a valid type', () => {
    const a: ActivityCreate = validActivityCreate;
    expect(a.master_id).toBe('master-1');
  });

  it('ActivityResponse is a valid type', () => {
    const a: ActivityResponse = validActivityResponse;
    expect(a.occupied).toBe(3);
  });
});
