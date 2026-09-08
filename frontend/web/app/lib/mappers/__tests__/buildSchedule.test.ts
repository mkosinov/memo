import { describe, it, expect } from 'vitest';
import { buildWebSchedule, type WebScheduleDTO } from '../buildSchedule';
import type { ActivityResponse, ServiceResponse, MasterResponse, LocationResponse } from '@memo/api-client';

function makeActivity(overrides?: Partial<ActivityResponse>): ActivityResponse {
  return {
    id: 'act-1',
    master_id: 'master-1',
    service_id: 'service-1',
    location_id: 'loc-1',
    start: '2026-06-01T10:00:00',
    duration: 120,
    capacity: 10,
    is_private: false,
    comment: null,
    record_info: null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    is_active: true,
    occupied: 3,
    ...overrides,
  };
}

function makeService(overrides?: Partial<ServiceResponse>): ServiceResponse {
  return {
    id: 'service-1',
    title: 'Морской пейзаж',
    description: 'Напишем морской пейзаж маслом',
    image_url: 'https://example.com/service.jpg',
    specialty: 'painting',
    min_age: 12,
    max_age: 99,
    duration: 120,
    record_info: 'Запись обязательна',
    materials: [
      { id: 'mat-1', title: 'Акварель', description: 'Акварельные краски', note: null },
      { id: 'mat-2', title: 'Масло', description: 'Масляные краски', note: 'Густые масляные краски' },
    ],
    tariffs: [{ id: 'tariff-1', service_id: 'service-1', title: 'Взрослый', description: null, price: 3500 }],
    tags: [{ id: 'tag-1', tag: 'масло' }, { id: 'tag-2', tag: 'пейзаж' }],
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as ServiceResponse;
}

function makeMaster(overrides?: Partial<MasterResponse>): MasterResponse {
  return {
    id: 'master-1',
    first_name: 'Ольга',
    last_name: 'Середа',
    color: '#C49A2E',
    position: 'Художник',
    specialty: 'painting',
    avatar_url: 'https://example.com/avatar.jpg',
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as MasterResponse;
}

function makeLocation(overrides?: Partial<LocationResponse>): LocationResponse {
  return {
    id: 'loc-1',
    name: 'Альпика',
    address: 'ул. Тестовая, 1',
    description: 'Уютная студия',
    capacity: 20,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    location_hint: 'Вход со двора',
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as LocationResponse;
}

describe('buildWebSchedule', () => {
  it('returns ScheduleIndex with byId Map and byLocation record', () => {
    const activities = [makeActivity()];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    expect(result).toHaveProperty('byId');
    expect(result).toHaveProperty('byLocation');
    expect(result.byId).toBeInstanceOf(Map);
    expect(typeof result.byLocation).toBe('object');
  });

  it('maps all fields from activity, service, master, location into WebScheduleDTO', () => {
    const activities = [makeActivity()];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);
    const dto = result.byId.get('act-1') as WebScheduleDTO;

    expect(dto.id).toBe('act-1');
    expect(dto.masterId).toBe('master-1');
    expect(dto.serviceId).toBe('service-1');
    expect(dto.locationId).toBe('loc-1');
    expect(dto.masterName).toBe('Ольга Середа');
    expect(dto.serviceTitle).toBe('Морской пейзаж');
    expect(dto.date).toBe('2026-06-01');
    expect(dto.time).toBe('10:00');
    expect(dto.durationMinutes).toBe(120);
    expect(dto.occupied).toBe(3);
    expect(dto.capacity).toBe(10);
    expect(dto.locationName).toBe('Альпика');
    expect(dto.locationAddress).toBe('ул. Тестовая, 1');
    expect(dto.locationHint).toBe('Вход со двора');
    expect(dto.priceMin).toBe(3500);
    expect(dto.priceMax).toBe(3500);
    expect(dto.priceHint).toBe('Взрослый: 3500₽');
    expect(dto.image_url).toBe('https://example.com/service.jpg');
    expect(dto.tags).toEqual(['масло', 'пейзаж']);
    expect(dto.masterAvatar).toBe('https://example.com/avatar.jpg');
    // Web-only fields
    expect(dto.size).toBe('');
    expect(dto.photos).toEqual([]);
  });

  describe('materials from links (GH #223 §9)', () => {
    it('derives materialDetails: link note when present, else material description, joined with newline', () => {
      const result = buildWebSchedule(
        [makeActivity()],
        new Map([['service-1', makeService()]]),
        new Map([['master-1', makeMaster()]]),
        new Map([['loc-1', makeLocation()]]),
      );
      const dto = result.byId.get('act-1') as WebScheduleDTO;

      expect(dto.materialDetails).toBe('Акварельные краски\nГустые масляные краски');
    });

    it('uses description for materials without note (note ?? description fallback)', () => {
      const service = makeService({
        materials: [
          { id: 'mat-1', title: 'Масло', description: 'Масляные краски — классика', note: null },
        ],
      });
      const result = buildWebSchedule(
        [makeActivity()],
        new Map([['service-1', service]]),
        new Map([['master-1', makeMaster()]]),
        new Map([['loc-1', makeLocation()]]),
      );
      const dto = result.byId.get('act-1') as WebScheduleDTO;

      expect(dto.materialDetails).toBe('Масляные краски — классика');
    });

    it('derives material as the first linked material title (materials ordered by title from API)', () => {
      const result = buildWebSchedule(
        [makeActivity()],
        new Map([['service-1', makeService()]]),
        new Map([['master-1', makeMaster()]]),
        new Map([['loc-1', makeLocation()]]),
      );
      const dto = result.byId.get('act-1') as WebScheduleDTO;

      expect(dto.material).toBe('Акварель');
    });

    it('no materials: material is empty string and materialDetails is undefined', () => {
      const service = makeService({ materials: [] });
      const result = buildWebSchedule(
        [makeActivity()],
        new Map([['service-1', service]]),
        new Map([['master-1', makeMaster()]]),
        new Map([['loc-1', makeLocation()]]),
      );
      const dto = result.byId.get('act-1') as WebScheduleDTO;

      expect(dto.material).toBe('');
      expect(dto.materialDetails).toBeUndefined();
    });

    it('treats whitespace-only note as present text (server normalizes notes to NULL; mapper renders as-is)', () => {
      const service = makeService({
        materials: [
          { id: 'mat-1', title: 'Гуашь', description: 'Плотные матовые краски', note: 'Для детей — вся краска на столе' },
        ],
      });
      const result = buildWebSchedule(
        [makeActivity()],
        new Map([['service-1', service]]),
        new Map([['master-1', makeMaster()]]),
        new Map([['loc-1', makeLocation()]]),
      );
      const dto = result.byId.get('act-1') as WebScheduleDTO;

      expect(dto.material).toBe('Гуашь');
      expect(dto.materialDetails).toBe('Для детей — вся краска на столе');
    });
  });

  it('skips activity when service is missing', () => {
    const activities = [makeActivity()];
    const services = new Map<string, ServiceResponse>();
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    expect(result.byId.size).toBe(0);
  });

  it('skips activity when master is missing', () => {
    const activities = [makeActivity()];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map<string, MasterResponse>();
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    expect(result.byId.size).toBe(0);
  });

  it('skips activity when location is missing', () => {
    const activities = [makeActivity()];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map<string, LocationResponse>();

    const result = buildWebSchedule(activities, services, masters, locations);

    expect(result.byId.size).toBe(0);
  });

  it('builds byLocation["all"] with all activities', () => {
    const activities = [
      makeActivity({ id: 'act-1', location_id: 'loc-1', start: '2026-06-01T10:00:00' }),
      makeActivity({ id: 'act-2', location_id: 'loc-2', start: '2026-06-02T14:00:00' }),
    ];
    const services = new Map([
      ['service-1', makeService()],
    ]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([
      ['loc-1', makeLocation()],
      ['loc-2', makeLocation({ id: 'loc-2', name: 'Гранд Отель' })],
    ]);

    const result = buildWebSchedule(activities, services, masters, locations);

    const allIdx = result.byLocation['all'];
    expect(allIdx).toBeDefined();
    expect(allIdx.byDate.get('2026-06-01')).toContain('act-1');
    expect(allIdx.byDate.get('2026-06-02')).toContain('act-2');
  });

  it('builds per-location byDate index', () => {
    const activities = [
      makeActivity({ id: 'act-1', location_id: 'loc-1', start: '2026-06-01T10:00:00' }),
      makeActivity({ id: 'act-2', location_id: 'loc-1', start: '2026-06-02T14:00:00' }),
      makeActivity({ id: 'act-3', location_id: 'loc-2', start: '2026-06-01T11:00:00' }),
    ];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([
      ['loc-1', makeLocation()],
      ['loc-2', makeLocation({ id: 'loc-2', name: 'Гранд Отель' })],
    ]);

    const result = buildWebSchedule(activities, services, masters, locations);

    const loc1Idx = result.byLocation['loc-1'];
    expect(loc1Idx.byDate.get('2026-06-01')).toEqual(['act-1']);
    expect(loc1Idx.byDate.get('2026-06-02')).toEqual(['act-2']);

    const loc2Idx = result.byLocation['loc-2'];
    expect(loc2Idx.byDate.get('2026-06-01')).toEqual(['act-3']);
  });

  it('builds per-location byServiceId index using serviceTitle', () => {
    const act1 = makeActivity({ id: 'act-1', start: '2026-06-01T10:00:00' });
    const act2 = makeActivity({ id: 'act-2', start: '2026-06-02T14:00:00' });
    const act3 = makeActivity({
      id: 'act-3',
      service_id: 'service-2',
      start: '2026-06-03T10:00:00',
    });

    const activities = [act1, act2, act3];
    const services = new Map([
      ['service-1', makeService()],
      ['service-2', makeService({ id: 'service-2', title: 'Горный пейзаж' })],
    ]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    const locIdx = result.byLocation['loc-1'];
    expect(locIdx.byServiceId.get('Морской пейзаж')).toEqual(['act-1', 'act-2']);
    expect(locIdx.byServiceId.get('Горный пейзаж')).toEqual(['act-3']);
  });

  it('computes next_times for activities with same service at same location', () => {
    const activities = [
      makeActivity({ id: 'act-1', start: '2099-06-01T10:00:00' }),
      makeActivity({ id: 'act-2', start: '2099-06-01T14:00:00' }),
    ];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    const dto1 = result.byId.get('act-1') as WebScheduleDTO;
    expect((dto1 as unknown as Record<string, unknown>).nextTimes).toBeDefined();
    expect((dto1 as unknown as Record<string, unknown>).nextTimes).toHaveLength(1);
    expect((dto1 as unknown as Record<string, unknown>).nextTimes).toEqual([{ id: 'act-2', date: '2099-06-01', time: '14:00' }]);

    const dto2 = result.byId.get('act-2') as WebScheduleDTO;
    expect((dto2 as unknown as Record<string, unknown>).nextTimes).toBeUndefined();
  });

  it('sorts next_times by date then time', () => {
    const activities = [
      makeActivity({ id: 'act-2', start: '2099-06-02T10:00:00' }),
      makeActivity({ id: 'act-3', start: '2099-06-01T14:00:00' }),
      makeActivity({ id: 'act-1', start: '2099-06-01T10:00:00' }),
    ];
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    const dto1 = result.byId.get('act-1') as WebScheduleDTO;
    expect((dto1 as unknown as Record<string, unknown>).nextTimes).toBeDefined();
    expect(((dto1 as unknown as Record<string, unknown>).nextTimes as Array<{id: string}>).map(n => n.id)).toEqual(['act-3', 'act-2']);
  });

  it('limits next_times to 6 entries', () => {
    const activities = Array.from({ length: 8 }, (_, i) =>
      makeActivity({
        id: `act-${i + 1}`,
        start: `2099-06-${String(i + 1).padStart(2, '0')}T10:00:00`,
      })
    );
    const services = new Map([['service-1', makeService()]]);
    const masters = new Map([['master-1', makeMaster()]]);
    const locations = new Map([['loc-1', makeLocation()]]);

    const result = buildWebSchedule(activities, services, masters, locations);

    const firstDto = result.byId.get('act-1') as WebScheduleDTO;
    expect(((firstDto as unknown as Record<string, unknown>).nextTimes as unknown[])).toHaveLength(6);
  });

  it('handles empty activities array', () => {
    const result = buildWebSchedule(
      [],
      new Map([['service-1', makeService()]]),
      new Map([['master-1', makeMaster()]]),
      new Map([['loc-1', makeLocation()]])
    );

    expect(result.byId.size).toBe(0);
    expect(Object.keys(result.byLocation)).toEqual(['all']);
  });

  it('handles nullish optional fields gracefully', () => {
    const activities = [makeActivity()];
    const services = new Map([['service-1', makeService({
      materials: [],
      tariffs: [],
      tags: [],
    })]]);
    const masters = new Map([['master-1', makeMaster({ avatar_url: null })]]);
    const locations = new Map([['loc-1', makeLocation({ address: null, location_hint: null })]]);

    const result = buildWebSchedule(activities, services, masters, locations);
    const dto = result.byId.get('act-1') as WebScheduleDTO;

    expect(dto.material).toBe('');
    expect(dto.materialDetails).toBeUndefined();
    expect(dto.priceMin).toBe(0);
    expect(dto.priceMax).toBe(0);
    expect(dto.masterAvatar).toBeUndefined();
    expect(dto.locationAddress).toBeUndefined();
    expect(dto.locationHint).toBeUndefined();
    expect(dto.priceHint).toBe('');
    expect(dto.tags).toEqual([]);
  });
});
