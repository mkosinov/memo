import { describe, it, expect } from 'vitest';
import {
  transformActivity,
  transformMaster,
  transformService,
  transformLocation,
} from '@/lib/transformers';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

// ─── MasterResponse fixtures ────────────────────────────────────────────────

const masterFixture: MasterResponse = {
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
  is_active: true,
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
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

// ─── ActivityResponse fixtures ──────────────────────────────────────────────

const activityFixture: ActivityResponse = {
  id: 'activity-1',
  master_id: 'master-1',
  service_id: 'service-1',
  location_id: 'loc-1',
  start: '2024-12-25T14:00:00Z', // Wednesday → day 2 (Mon=0)
  duration: 180,
  capacity: 10,
  is_private: false,
  comment: 'Принести свои кисти',
  record_info: null,
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  is_active: true,
  occupied: 3,
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

  it('converts duration from minutes to hours', () => {
    const result = transformService(serviceFixture);
    expect(result.duration).toBe(3); // 180 / 60
  });

  it('sets durationMinutes from raw duration', () => {
    const result = transformService(serviceFixture);
    expect(result.durationMinutes).toBe(180);
  });

  it('formats minAge as string without + suffix', () => {
    const result = transformService(serviceFixture);
    expect(result.minAge).toBe('6');
  });

  it('uses max_age as maxCapacity proxy', () => {
    const result = transformService(serviceFixture);
    expect(result.maxCapacity).toBe(99);
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

// ─── transformActivity ──────────────────────────────────────────────────────

describe('transformActivity', () => {
  it('computes day from ISO start (Wed 2024-12-25 → day=2)', () => {
    const result = transformActivity(activityFixture);
    // 2024-12-25 is Wednesday. getDay()=3, normalized: (3+6)%7 = 2 (Mon=0)
    expect(result.day).toBe(2);
  });

  it('computes startTime as float hours from ISO start', () => {
    const result = transformActivity(activityFixture);
    // 14:00 UTC → 14 hours
    expect(result.startTime).toBe(14);
  });

  it('computes startTime with minutes', () => {
    const withMinutes: ActivityResponse = { ...activityFixture, start: '2024-12-25T10:30:00Z' };
    const result = transformActivity(withMinutes);
    expect(result.startTime).toBe(10.5);
  });

  it('converts duration from minutes to hours', () => {
    const result = transformActivity(activityFixture);
    expect(result.duration).toBe(3); // 180 / 60
  });

  it('maps master_id to masterId', () => {
    const result = transformActivity(activityFixture);
    expect(result.masterId).toBe('master-1');
  });

  it('maps service_id to serviceId', () => {
    const result = transformActivity(activityFixture);
    expect(result.serviceId).toBe('service-1');
  });

  it('maps location_id to locationId', () => {
    const result = transformActivity(activityFixture);
    expect(result.locationId).toBe('loc-1');
  });

  it('maps is_private to isPrivate', () => {
    const result = transformActivity(activityFixture);
    expect(result.isPrivate).toBe(false);
  });

  it('converts null comment to undefined', () => {
    const withNullComment: ActivityResponse = { ...activityFixture, comment: null };
    const result = transformActivity(withNullComment);
    expect(result.comment).toBeUndefined();
  });

  it('passes non-null comment through', () => {
    const result = transformActivity(activityFixture);
    expect(result.comment).toBe('Принести свои кисти');
  });

  it('maps capacity and occupied', () => {
    const result = transformActivity(activityFixture);
    expect(result.capacity).toBe(10);
    expect(result.occupied).toBe(3);
  });

  it('maps id', () => {
    const result = transformActivity(activityFixture);
    expect(result.id).toBe('activity-1');
  });

  it('handles Monday correctly (day=0)', () => {
    // 2024-12-23 is Monday. getDay()=1, normalized: (1+6)%7 = 0
    const mondayActivity: ActivityResponse = { ...activityFixture, start: '2024-12-23T09:00:00Z' };
    const result = transformActivity(mondayActivity);
    expect(result.day).toBe(0);
  });

  it('handles Sunday correctly (day=6)', () => {
    // 2024-12-29 is Sunday. getDay()=0, normalized: (0+6)%7 = 6
    const sundayActivity: ActivityResponse = { ...activityFixture, start: '2024-12-29T09:00:00Z' };
    const result = transformActivity(sundayActivity);
    expect(result.day).toBe(6);
  });
});
