import { describe, it, expect } from 'vitest';
import { toScheduleItems, toScheduleIndex } from '@/lib/buildSchedule';
import type { ScheduleItem } from '@/lib/buildSchedule';
import type { Activity, Service } from '@memo/domain';

const MONDAY = new Date('2025-04-07T00:00:00Z');

const mockServices: Service[] = [
  {
    id: 's1',
    name: 'Картина маслом',
    duration: 2.5,
    maxCapacity: 8,
    minAge: '12',
    defaultAdultPrice: 3500,
    description: 'Рисование масляными красками',
  },
  {
    id: 's2',
    name: 'Картина акрилом',
    duration: 2,
    maxCapacity: 10,
    minAge: '6',
    defaultAdultPrice: 2800,
    description: 'Рисование акриловыми красками',
  },
];

const mockActivities: Activity[] = [
  {
    id: 'a1',
    day: 0,
    masterId: 'm1',
    startTime: 10,
    duration: 2,
    serviceId: 's1',
    locationId: 'loc_1',
    occupied: 3,
    capacity: 8,
    isPrivate: false,
  },
  {
    id: 'a2',
    day: 1,
    masterId: 'm2',
    startTime: 14,
    duration: 1.5,
    serviceId: 's2',
    locationId: 'loc_2',
    occupied: 4,
    capacity: 6,
    isPrivate: false,
  },
];

describe('toScheduleItems', () => {
  it('sets serviceName and minAge from matching service', () => {
    const result = toScheduleItems(mockActivities, mockServices);
    const a1 = result.find(a => a.id === 'a1')!;
    expect(a1.serviceName).toBe('Картина маслом');
    expect(a1.minAge).toBe('12');
  });

  it('preserves existing serviceName on activity when available', () => {
    const withName: Activity[] = [
      {
        ...mockActivities[0],
        serviceName: 'Кастомное название',
      },
    ];
    const result = toScheduleItems(withName, mockServices);
    expect(result[0].serviceName).toBe('Кастомное название');
  });

  it('falls back to service name when activity has no serviceName', () => {
    const noName: Activity[] = [
      {
        ...mockActivities[0],
        serviceName: undefined,
      },
    ];
    const result = toScheduleItems(noName, mockServices);
    expect(result[0].serviceName).toBe('Картина маслом');
  });

  it('falls back to empty string when no matching service found', () => {
    const unknownSvc: Activity[] = [
      {
        ...mockActivities[0],
        serviceId: 'unknown',
        serviceName: undefined,
      },
    ];
    const result = toScheduleItems(unknownSvc, mockServices);
    expect(result[0].serviceName).toBe('');
    expect(result[0].minAge).toBe('');
  });

  it('returns all activities (does not filter any out)', () => {
    const result = toScheduleItems(mockActivities, mockServices);
    expect(result).toHaveLength(2);
  });

  it('preserves all other Activity fields', () => {
    const result = toScheduleItems(mockActivities, mockServices);
    const a1 = result.find(a => a.id === 'a1')!;
    expect(a1.id).toBe('a1');
    expect(a1.day).toBe(0);
    expect(a1.masterId).toBe('m1');
    expect(a1.startTime).toBe(10);
    expect(a1.duration).toBe(2);
    expect(a1.serviceId).toBe('s1');
    expect(a1.locationId).toBe('loc_1');
    expect(a1.occupied).toBe(3);
    expect(a1.capacity).toBe(8);
    expect(a1.isPrivate).toBe(false);
  });

  it('handles empty activities array', () => {
    const result = toScheduleItems([], mockServices);
    expect(result).toEqual([]);
  });

  it('handles empty services array', () => {
    const result = toScheduleItems(mockActivities, []);
    expect(result).toHaveLength(2);
    expect(result[0].serviceName).toBe('');
    expect(result[0].minAge).toBe('');
  });

  it('handles minAge fallback when activity has existing minAge', () => {
    const withMinAge: Activity[] = [
      {
        ...mockActivities[0],
        minAge: '8',
      },
    ];
    const result = toScheduleItems(withMinAge, mockServices);
    expect(result[0].minAge).toBe('8');
  });

  it('returns ScheduleItem type (serviceName and minAge are required strings)', () => {
    const result = toScheduleItems(mockActivities, mockServices);
    const a1 = result.find(a => a.id === 'a1')!;
    // Both serviceName and minAge must be strings (not undefined)
    expect(typeof a1.serviceName).toBe('string');
    expect(typeof a1.minAge).toBe('string');
  });
});

describe('toScheduleIndex', () => {
  const enriched = toScheduleItems(mockActivities, mockServices);

  it('returns a ScheduleIndex with byId mapping ids to ScheduleItem', () => {
    const idx = toScheduleIndex(enriched, MONDAY);
    expect(idx.byId.get('a1')?.id).toBe('a1');
    expect(idx.byId.get('a1')?.serviceName).toBe('Картина маслом');
    expect(idx.byId.get('a2')?.id).toBe('a2');
    expect(idx.byId.get('a2')?.serviceName).toBe('Картина акрилом');
  });

  it('index.byDate groups activities by ISO date (YYYY-MM-DD)', () => {
    const idx = toScheduleIndex(enriched, MONDAY);
    expect(idx.index.byDate.get('2025-04-07')).toHaveLength(1);
    expect(idx.index.byDate.get('2025-04-07')?.[0].id).toBe('a1');
    expect(idx.index.byDate.get('2025-04-08')).toHaveLength(1);
    expect(idx.index.byDate.get('2025-04-08')?.[0].id).toBe('a2');
  });

  it('index.byArtistId groups activities by masterId', () => {
    const idx = toScheduleIndex(enriched, MONDAY);
    expect(idx.index.byArtistId.get('m1')).toHaveLength(1);
    expect(idx.index.byArtistId.get('m1')?.[0].id).toBe('a1');
    expect(idx.index.byArtistId.get('m2')).toHaveLength(1);
    expect(idx.index.byArtistId.get('m2')?.[0].id).toBe('a2');
  });

  it('index.byLocationId groups activities by locationId', () => {
    const idx = toScheduleIndex(enriched, MONDAY);
    expect(idx.index.byLocationId.get('loc_1')).toHaveLength(1);
    expect(idx.index.byLocationId.get('loc_1')?.[0].id).toBe('a1');
    expect(idx.index.byLocationId.get('loc_2')).toHaveLength(1);
    expect(idx.index.byLocationId.get('loc_2')?.[0].id).toBe('a2');
  });

  it('byLocation has "all" key referencing the full index', () => {
    const idx = toScheduleIndex(enriched, MONDAY);
    expect(idx.byLocation['all']).toBeDefined();
    // 'all' index should contain all activities
    expect(idx.byLocation['all'].byDate.get('2025-04-07')?.[0].id).toBe('a1');
    expect(idx.byLocation['all'].byDate.get('2025-04-08')?.[0].id).toBe('a2');
  });

  it('byLocation has per-location indices filtered to that location', () => {
    // Add a third activity at loc_1 to verify filtering
    const threeEnriched: ScheduleItem[] = [
      ...enriched,
      {
        ...mockActivities[0],
        id: 'a3',
        day: 2,
        locationId: 'loc_1',
        serviceName: 'Картина маслом',
        minAge: '12',
      },
    ];
    const idx = toScheduleIndex(threeEnriched, MONDAY);
    // loc_1 index should have 2 activities (a1, a3)
    expect(idx.byLocation['loc_1'].byLocationId.get('loc_1')).toHaveLength(2);
    // loc_2 index should have 1 activity (a2)
    expect(idx.byLocation['loc_2'].byLocationId.get('loc_2')).toHaveLength(1);
    // loc_2 should NOT have a3
    const loc2Ids = idx.byLocation['loc_2'].byLocationId.get('loc_2')?.map(a => a.id) ?? [];
    expect(loc2Ids).not.toContain('a3');
  });

  it('handles empty enriched activities array', () => {
    const idx = toScheduleIndex([], MONDAY);
    expect(idx.byId.size).toBe(0);
    expect(idx.index.byDate.size).toBe(0);
    expect(idx.index.byArtistId.size).toBe(0);
    expect(idx.index.byLocationId.size).toBe(0);
    expect(Object.keys(idx.byLocation)).toEqual(['all']);
  });

  it('byLocation "all" index is same object as top-level index', () => {
    const idx = toScheduleIndex(enriched, MONDAY);
    expect(idx.byLocation['all']).toBe(idx.index);
  });

  it('multiple activities on same date appear in byDate array', () => {
    const multiDay: ScheduleItem[] = [
      {
        ...mockActivities[0],
        id: 'a3',
        day: 0,
        locationId: 'loc_1',
        serviceName: 'Картина маслом',
        minAge: '12',
      },
      ...enriched,
    ];
    const idx = toScheduleIndex(multiDay, MONDAY);
    expect(idx.index.byDate.get('2025-04-07')).toHaveLength(2);
    expect(idx.index.byDate.get('2025-04-07')?.map(a => a.id).sort()).toEqual(['a1', 'a3']);
  });

  it('multiple activities by same artist appear in byArtistId array', () => {
    const multiArtist: ScheduleItem[] = [
      {
        ...mockActivities[0],
        id: 'a3',
        day: 2,
        masterId: 'm1',
        locationId: 'loc_1',
        serviceName: 'Картина маслом',
        minAge: '12',
      },
      ...enriched,
    ];
    const idx = toScheduleIndex(multiArtist, MONDAY);
    expect(idx.index.byArtistId.get('m1')).toHaveLength(2);
    expect(idx.index.byArtistId.get('m1')?.map(a => a.id).sort()).toEqual(['a1', 'a3']);
  });
});
