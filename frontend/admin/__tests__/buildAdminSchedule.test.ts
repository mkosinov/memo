import { describe, it, expect } from 'vitest';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

const MONDAY = new Date('2026-06-01T00:00:00'); // Monday

const mockMaster: MasterResponse = {
  id: 'm1',
  first_name: 'Анна',
  last_name: 'Иванова',
  color: '#FF5733',
  avatar_url: null,
  position: 'master',
  specialty: 'ceramics',
  archived: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockService: ServiceResponse = {
  id: 's1',
  title: 'Гончарный круг',
  description: '',
  image_url: '',
  specialty: 'ceramics',
  min_age: 6,
  max_age: 99,
  duration: 120,
  record_info: '',
  material_hint: 'глина',
  tariffs: [{ id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 2500 }],
  tags: [{ id: 'tag1', tag: 'глина' }],
  materials: [],
  archived: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockLocation: LocationResponse = {
  id: 'l1',
  name: 'Основной зал',
  address: 'ул. Примерная, 1',
  description: null,
  capacity: 10,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  location_hint: null,
  archived: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const makeActivity = (overrides: Partial<ActivityResponse> = {}): ActivityResponse => ({
  id: 'a1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'l1',
  start: '2026-06-01T10:00:00',
  duration: 120,
  occupied: 2,
  capacity: 6,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

describe('buildAdminSchedule', () => {
  it('returns items and index', () => {
    const { items, index } = buildAdminSchedule(
      [makeActivity()],
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('a1');
    expect(items[0].startMinutes).toBe(600); // 10:00 = 600 minutes from midnight
  });

  it('computes day and startMinutes correctly', () => {
    const { items } = buildAdminSchedule(
      [makeActivity({ start: '2026-06-03T14:30:00' })], // Wednesday
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );
    expect(items[0].day).toBe(2);  // Wednesday = day 2
    expect(items[0].startMinutes).toBe(870); // 14:30 = 14*60+30
  });

  it('flows service tariffs into price fields (2 tariffs → priceMin/priceMax/priceHint)', () => {
    const twoTariffService: ServiceResponse = {
      ...mockService,
      tariffs: [
        { id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 2500 },
        { id: 't2', service_id: 's1', title: 'Детский', description: null, price: 1500 },
      ],
    };
    expect(twoTariffService.tariffs).toHaveLength(2);
    const { items } = buildAdminSchedule(
      [makeActivity()],
      [mockMaster],
      [twoTariffService],
      [mockLocation],
      MONDAY,
    );
    expect(items[0].priceMin).toBe(1500);
    expect(items[0].priceMax).toBe(2500);
    expect(items[0].priceHint).toBe('Взрослый: 2500₽, Детский: 1500₽');
  });

  it('keeps single-tariff price parity (priceMin = priceMax = tariff price)', () => {
    const { items } = buildAdminSchedule(
      [makeActivity()],
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );
    expect(items[0].priceMin).toBe(2500);
    expect(items[0].priceMax).toBe(2500);
    expect(items[0].priceHint).toBe('Взрослый: 2500₽');
  });

  it('skips activities with missing reference data', () => {
    const { items } = buildAdminSchedule(
      [makeActivity({ master_id: 'nonexistent' })],
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );
    expect(items).toHaveLength(0);
  });

  it('builds byDate index via generic buildSchedule', () => {
    const act1 = makeActivity({ id: 'a1', start: '2026-06-01T10:00:00' });
    const act2 = makeActivity({ id: 'a2', start: '2026-06-02T10:00:00' });
    const { index } = buildAdminSchedule(
      [act1, act2],
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );
    const mondayIds = index.byDate.get('2026-06-01');
    expect(mondayIds).toHaveLength(1);
    expect(mondayIds![0]).toBe('a1');
  });

  it('resolves admin-specific fields', () => {
    const { items } = buildAdminSchedule(
      [makeActivity({ is_private: true, comment: 'test comment' })],
      [mockMaster],
      [mockService],
      [mockLocation],
      MONDAY,
    );
    expect(items[0].isPrivate).toBe(true);
    expect(items[0].masterColor).toBe('#FF5733');
    expect(items[0].minAge).toBe('6');
    expect(items[0].comment).toBe('test comment');
  });
});
