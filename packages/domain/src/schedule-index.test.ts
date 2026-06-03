import { describe, it, expect } from 'vitest';
import { buildSchedule, resolveById, ScheduleIndex } from './schedule-index';

interface TestItem {
  id: string;
  masterId: string;
  locationId: string;
  title: string;
}

function dateKey(item: TestItem): string {
  // Use a fixed date for simplicity
  return '2026-06-01';
}

describe('buildSchedule', () => {
  it('builds an index from an empty array', () => {
    const result = buildSchedule<TestItem>([], { getDateKey: dateKey });
    expect(result.byId.size).toBe(0);
    expect(result.byDate.size).toBe(0);
    expect(result.byMasterId.size).toBe(0);
    expect(result.byLocation['all']).toBeDefined();
  });

  it('stores items in byId map keyed by id', () => {
    const items: TestItem[] = [
      { id: 'act1', masterId: 'm1', locationId: 'loc1', title: 'Activity 1' },
    ];
    const result = buildSchedule(items, { getDateKey: dateKey });
    expect(result.byId.get('act1')).toEqual(items[0]);
  });

  it('groups item IDs by date in byDate', () => {
    const items: TestItem[] = [
      { id: 'act1', masterId: 'm1', locationId: 'loc1', title: 'A1' },
      { id: 'act2', masterId: 'm2', locationId: 'loc2', title: 'A2' },
    ];
    const result = buildSchedule(items, { getDateKey: () => '2026-06-01' });
    expect(result.byDate.get('2026-06-01')).toEqual(['act1', 'act2']);
  });

  it('groups item IDs by masterId in byMasterId', () => {
    const items: TestItem[] = [
      { id: 'act1', masterId: 'm1', locationId: 'loc1', title: 'A1' },
      { id: 'act2', masterId: 'm1', locationId: 'loc1', title: 'A2' },
      { id: 'act3', masterId: 'm2', locationId: 'loc2', title: 'A3' },
    ];
    const result = buildSchedule(items, { getDateKey: dateKey });
    expect(result.byMasterId.get('m1')).toEqual(['act1', 'act2']);
    expect(result.byMasterId.get('m2')).toEqual(['act3']);
  });

  it('groups items under "all" location in byLocation', () => {
    const items: TestItem[] = [
      { id: 'act1', masterId: 'm1', locationId: 'loc1', title: 'A1' },
      { id: 'act2', masterId: 'm2', locationId: 'loc2', title: 'A2' },
    ];
    const result = buildSchedule(items, { getDateKey: dateKey });
    expect(result.byLocation['all'].byDate.get('2026-06-01')).toEqual(['act1', 'act2']);
  });

  it('creates per-location byDate indexes', () => {
    const items: TestItem[] = [
      { id: 'act1', masterId: 'm1', locationId: 'loc1', title: 'A1' },
      { id: 'act2', masterId: 'm2', locationId: 'loc2', title: 'A2' },
    ];
    const result = buildSchedule(items, { getDateKey: dateKey });
    expect(result.byLocation['loc1'].byDate.get('2026-06-01')).toEqual(['act1']);
    expect(result.byLocation['loc2'].byDate.get('2026-06-01')).toEqual(['act2']);
  });

  it('indexes by service key when getServiceKey is provided', () => {
    const items: TestItem[] = [
      { id: 'act1', masterId: 'm1', locationId: 'loc1', title: 'A1' },
      { id: 'act2', masterId: 'm2', locationId: 'loc2', title: 'A2' },
    ];
    const result = buildSchedule(items, {
      getDateKey: dateKey,
      getServiceKey: () => 'svc1',
    });
    expect(result.byLocation['all'].byServiceId.get('svc1')).toEqual(['act1', 'act2']);
    expect(result.byLocation['loc1'].byServiceId.get('svc1')).toEqual(['act1']);
    expect(result.byLocation['loc2'].byServiceId.get('svc1')).toEqual(['act2']);
  });
});

describe('resolveById', () => {
  it('resolves an array of IDs to their objects', () => {
    const byId = new Map<string, TestItem>([
      ['a', { id: 'a', masterId: 'm1', locationId: 'loc1', title: 'A' }],
      ['b', { id: 'b', masterId: 'm2', locationId: 'loc2', title: 'B' }],
    ]);
    const result = resolveById(['a', 'b'], byId);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('A');
    expect(result[1].title).toBe('B');
  });

  it('filters out IDs not found in byId', () => {
    const byId = new Map<string, TestItem>([
      ['a', { id: 'a', masterId: 'm1', locationId: 'loc1', title: 'A' }],
    ]);
    const result = resolveById(['a', 'missing'], byId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('returns empty array when no IDs match', () => {
    const byId = new Map<string, TestItem>();
    const result = resolveById(['x', 'y'], byId);
    expect(result).toEqual([]);
  });
});
