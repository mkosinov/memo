import { describe, it, expect } from 'vitest';
import { joinActivities } from '../join-schedule';
import { toScheduleView } from '../to-schedule-vm';

// Mock data matching the real API response shapes
const mockMaster = {
  id: 'm1',
  first_name: 'Ольга',
  last_name: 'Середа',
  color: '#5B8C7A',
  position: 'мастер',
  specialty: 'живопись',
  avatar_url: null,
  is_active: true,
  created_at: '',
  updated_at: '',
};

const mockService = {
  id: 's1',
  title: 'Картина маслом',
  description: 'Масляная живопись',
  image_url: '/img.jpg',
  specialty: 'живопись',
  min_age: 12,
  max_age: 99,
  duration: 150,
  record_info: '',
  is_active: true,
  created_at: '',
  updated_at: '',
  material_hint: 'Масло, холст 40×50',
  tariffs: [
    { id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 3500 },
  ],
  tags: [{ id: 'tag2', tag: 'хит' }],
};

const mockLocation = {
  id: 'alpika',
  name: 'Альпика',
  address: 'ул. Альпика, 1',
  description: null,
  capacity: 10,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  is_active: true,
  created_at: '',
  updated_at: '',
  location_hint: '1 этаж, светлая студия',
};

const mockActivity = {
  id: 'ev_0',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'alpika',
  start: '2026-06-01T10:00:00',
  duration: 150,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  is_active: true,
  occupied: 2,
  created_at: '',
  updated_at: '',
};

describe('Full pipeline: API responses → ScheduleView', () => {
  it('produces correctly formatted ScheduleView from API data', () => {
    const index = joinActivities(
      [mockActivity],
      new Map([['s1', mockService]]),
      new Map([['m1', mockMaster]]),
      new Map([['alpika', mockLocation]]),
    );

    const dto = index.byId.get('ev_0')!;
    expect(dto).toBeDefined();

    const view = toScheduleView(dto);

    expect(view.title).toBe('Картина маслом');
    expect(view.tags).toEqual(['хит']);
    expect(view.masterName).toBe('Ольга Середа');
    expect(view.priceMin).toBe(3500);
    expect(view.priceMax).toBe(3500);
    expect(view.duration).toBe('2 ч 30 мин');
    expect(view.priceHint).toBe('Взрослый: 3500₽');
    expect(view.materialHint).toBe('Масло, холст 40×50');
    expect(view.locationHint).toBe('1 этаж, светлая студия');
    expect(view.tagColors).toEqual(['#D4789A']);
  });

  it('handles multiple activities with location-based filtering', () => {
    const activities = [
      { ...mockActivity, id: 'ev_0', start: '2026-06-01T10:00:00' },
      { ...mockActivity, id: 'ev_1', start: '2026-06-01T14:00:00' },
      { ...mockActivity, id: 'ev_2', start: '2026-06-02T10:00:00', location_id: 'grand' },
    ];

    const services = new Map([['s1', mockService]]);
    const masters = new Map([['m1', mockMaster]]);
    const locations = new Map([
      ['alpika', mockLocation],
      ['grand', { ...mockLocation, id: 'grand', name: 'Гранд Отель', location_hint: 'Лобби' }],
    ]);

    const index = joinActivities(activities, services, masters, locations);

    // Date filtering via index
    expect(index.byLocation['all'].byDate.get('2026-06-01')!.length).toBe(2);
    expect(index.byLocation['all'].byDate.get('2026-06-02')!.length).toBe(1);

    // Location filtering via index
    expect(index.byLocation['grand'].byDate.get('2026-06-02')!.length).toBe(1);
    expect(index.byLocation['alpika'].byDate.get('2026-06-01')!.length).toBe(2);
  });

  it('handles nullish optional fields gracefully', () => {
    const serviceNoHint = { ...mockService, material_hint: null };
    const locationNoHint = { ...mockLocation, location_hint: null };

    const index = joinActivities(
      [mockActivity],
      new Map([['s1', serviceNoHint]]),
      new Map([['m1', mockMaster]]),
      new Map([['alpika', locationNoHint]]),
    );

    const view = toScheduleView(index.byId.get('ev_0')!);
    expect(view.materialHint).toBeUndefined();
    expect(view.locationHint).toBeUndefined();
    expect(view.material).toBe('');
  });
});
