import { describe, it, expect } from 'vitest';
import {
  transformMaster,
  transformService,
  transformLocation,
} from '@/lib/transformers';
import type { MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

// ─── MasterResponse fixtures ────────────────────────────────────────────────

const masterFixture: MasterResponse = {
  id: 'master-1',
  first_name: 'Анна',
  last_name: 'Иванова',
  color: '#FF6B6B',
  position: 'мастер',
  specialty: 'живопись',
  avatar_url: 'https://example.com/avatar.jpg',
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

// ─── LocationResponse fixtures ──────────────────────────────────────────────

const locationFixture: LocationResponse = {
  id: 'loc-1',
  name: 'Студия на Невском',
  address: 'Невский пр. 28',
  description: 'Уютная студия',
  capacity: 10,
  yandex_map_url: 'https://yandex.ru/maps/...',
  review_url: 'https://yandex.ru/reviews/...',
  record_info: 'Запись по телефону',
  image_url: 'https://example.com/studio.jpg',
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

// ─── ServiceResponse fixtures ───────────────────────────────────────────────

const serviceFixture: ServiceResponse = {
  id: 'service-1',
  title: 'Мастер-класс по живописи',
  description: 'Научитесь писать маслом',
  image_url: 'https://example.com/painting.jpg',
  specialty: 'живопись',
  min_age: 6,
  max_age: 99,
  duration: 180,
  record_info: 'Запись за 24 часа',
  tariffs: [{ id: 'tariff-1', service_id: 'service-1', title: 'Взрослый', description: 'Билет для взрослого', price: 2500 }],
  tags: [{ id: 'tag-1', tag: 'масло' }],
  materials: [],
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

// ─── transformMaster ────────────────────────────────────────────────────────

describe('transformMaster', () => {
  it('combines last_name and first_name into name', () => {
    const result = transformMaster(masterFixture);
    expect(result.name).toBe('Иванова Анна');
  });

  it('uses first_name for shortName', () => {
    const result = transformMaster(masterFixture);
    expect(result.shortName).toBe('Анна');
  });

  it('maps color and id', () => {
    const result = transformMaster(masterFixture);
    expect(result.color).toBe('#FF6B6B');
    expect(result.id).toBe('master-1');
  });
});

// ─── transformLocation ──────────────────────────────────────────────────────

describe('transformLocation', () => {
  it('maps name and address', () => {
    const result = transformLocation(locationFixture);
    expect(result.name).toBe('Студия на Невском');
    expect(result.address).toBe('Невский пр. 28');
  });

  it('converts null address to undefined', () => {
    const withNullAddress: LocationResponse = { ...locationFixture, address: null };
    const result = transformLocation(withNullAddress);
    expect(result.address).toBeUndefined();
  });

  it('maps capacity to defaultCapacity', () => {
    const result = transformLocation(locationFixture);
    expect(result.defaultCapacity).toBe(10);
  });

  it('maps id', () => {
    const result = transformLocation(locationFixture);
    expect(result.id).toBe('loc-1');
  });

  it('leaves emoji undefined', () => {
    const result = transformLocation(locationFixture);
    expect(result.emoji).toBeUndefined();
  });
});

// ─── transformService ───────────────────────────────────────────────────────

describe('transformService', () => {
  it('maps title to name', () => {
    const result = transformService(serviceFixture);
    expect(result.name).toBe('Мастер-класс по живописи');
  });

  it('sets durationMinutes from raw duration (integer minutes passthrough)', () => {
    const result = transformService(serviceFixture);
    expect(result.durationMinutes).toBe(180);
  });

  it('does not expose a float-hours duration key', () => {
    const result = transformService(serviceFixture) as Record<string, unknown>;
    expect(result).not.toHaveProperty('duration');
  });

  it('passes tariffs through', () => {
    const result = transformService(serviceFixture);
    expect(result.tariffs).toHaveLength(1);
    expect(result.tariffs[0]).toMatchObject({ id: 'tariff-1', title: 'Взрослый', price: 2500 });
  });

  it('defaults tariffs to [] when raw.tariffs is undefined', () => {
    const noTariffsField = { ...serviceFixture, tariffs: undefined } as unknown as ServiceResponse;
    const result = transformService(noTariffsField);
    expect(result.tariffs).toEqual([]);
  });

  it('formats minAge as string without + suffix', () => {
    const result = transformService(serviceFixture);
    expect(result.minAge).toBe('6');
  });

  it('extracts defaultAdultPrice from first tariff', () => {
    const result = transformService(serviceFixture);
    expect(result.defaultAdultPrice).toBe(2500);
  });

  it('uses 0 for defaultAdultPrice when tariffs is empty', () => {
    const noTariffs: ServiceResponse = { ...serviceFixture, tariffs: [] };
    const result = transformService(noTariffs);
    expect(result.defaultAdultPrice).toBe(0);
  });

  it('maps description', () => {
    const result = transformService(serviceFixture);
    expect(result.description).toBe('Научитесь писать маслом');
  });

  it('maps id', () => {
    const result = transformService(serviceFixture);
    expect(result.id).toBe('service-1');
  });
});
