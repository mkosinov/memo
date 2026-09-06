import { describe, it, expect } from 'vitest';
import {
  RecordSchema,
  RecordStatusSchema,
  Record as DomainRecord,
  RecordStatus,
} from './index';

describe('Record (renamed from BookingRecord)', () => {
  it('exports RecordSchema', () => {
    expect(RecordSchema).toBeDefined();
  });

  it('exports RecordStatusSchema', () => {
    expect(RecordStatusSchema).toBeDefined();
  });

  it('RecordStatus has lowercase values: pending, confirmed, cancelled, no_show', () => {
    const values = RecordStatusSchema.options;
    expect(values).toEqual(['pending', 'confirmed', 'cancelled', 'no_show']);
  });

  it('RecordSchema accepts a valid record with lowercase status', () => {
    const record = {
      id: 'rec1',
      activityId: 'act1',
      clientId: 'cl1',
      status: 'confirmed',
      createdAt: '2025-01-01',
    };
    const result = RecordSchema.parse(record);
    expect(result.status).toBe('confirmed');
  });

  it('RecordSchema rejects an UPPERCASE status', () => {
    const record = {
      id: 'rec1',
      activityId: 'act1',
      clientId: 'cl1',
      status: 'CONFIRMED',
      createdAt: '2025-01-01',
    };
    expect(() => RecordSchema.parse(record)).toThrow();
  });

  it('RecordSchema rejects an unknown status', () => {
    const record = {
      id: 'rec1',
      activityId: 'act1',
      clientId: 'cl1',
      status: 'unknown',
      createdAt: '2025-01-01',
    };
    expect(() => RecordSchema.parse(record)).toThrow();
  });

  it('Record type is assignable from a valid object', () => {
    const r: DomainRecord = {
      id: 'rec1',
      activityId: 'act1',
      clientId: null,
      status: 'pending',
      createdAt: '2025-01-01',
    };
    expect(r.status).toBe('pending');
  });

  it('RecordStatus type accepts only lowercase values', () => {
    const s: RecordStatus = 'cancelled';
    expect(s).toBe('cancelled');
  });
});

describe('Old names should not exist', () => {
  it('BookingRecordSchema is not exported', async () => {
    const mod = await import('./index');
    expect((mod as Record<string, unknown>)['BookingRecordSchema']).toBeUndefined();
  });

  it('BookingStatusSchema is not exported', async () => {
    const mod = await import('./index');
    expect((mod as Record<string, unknown>)['BookingStatusSchema']).toBeUndefined();
  });

  it('BookingRecord type is not exported', async () => {
    const mod = await import('./index');
    expect((mod as Record<string, unknown>)['BookingRecord']).toBeUndefined();
  });

  it('BookingStatus type is not exported', async () => {
    const mod = await import('./index');
    expect((mod as Record<string, unknown>)['BookingStatus']).toBeUndefined();
  });
});
