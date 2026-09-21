import { describe, it, expect } from 'vitest';
import * as domain from './index';
import type { ScheduleAdminDTO } from './schedule';

const tariff = { id: 't1', title: 'Базовый', price: 2500, description: null, audience: 'all' };

const baseService = {
  id: 's1',
  name: 'Мастер-класс',
  minAge: '6',
  maxAge: '12',
  durationMinutes: 90,
  tariffs: [tariff],
};

describe('TariffSchema', () => {
  it('is exported', () => {
    expect(domain.TariffSchema).toBeDefined();
  });

  it('accepts a tariff with null description', () => {
    const parsed = domain.TariffSchema.parse(tariff);
    expect(parsed).toEqual(tariff);
  });

  it('accepts a tariff with string description', () => {
    const parsed = domain.TariffSchema.parse({ ...tariff, description: 'Описание' });
    expect(parsed.description).toBe('Описание');
  });

  it('rejects a tariff missing price', () => {
    const { price: _price, ...rest } = tariff;
    expect(domain.TariffSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a tariff missing title', () => {
    const { title: _title, ...rest } = tariff;
    expect(domain.TariffSchema.safeParse(rest).success).toBe(false);
  });

  // ─── GH #284: tariff audience ───

  it('accepts kid/adult/all audience values (GH #284)', () => {
    expect(domain.TariffSchema.parse({ ...tariff, audience: 'kid' }).audience).toBe('kid');
    expect(domain.TariffSchema.parse({ ...tariff, audience: 'adult' }).audience).toBe('adult');
    expect(domain.TariffSchema.parse({ ...tariff, audience: 'all' }).audience).toBe('all');
  });

  it('rejects a tariff missing audience (transformers must carry it — PUT round-trip)', () => {
    const { audience: _audience, ...rest } = tariff;
    expect(domain.TariffSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an unknown audience value', () => {
    expect(domain.TariffSchema.safeParse({ ...tariff, audience: 'senior' }).success).toBe(false);
  });
});

describe('ServiceSchema (minutes canon)', () => {
  it('accepts a service with durationMinutes and tariffs', () => {
    expect(() => domain.ServiceSchema.parse(baseService)).not.toThrow();
  });

  it('requires durationMinutes', () => {
    const { durationMinutes: _dm, ...rest } = baseService;
    expect(domain.ServiceSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-integer durationMinutes', () => {
    expect(
      domain.ServiceSchema.safeParse({ ...baseService, durationMinutes: 90.5 }).success,
    ).toBe(false);
  });

  it('rejects negative durationMinutes', () => {
    expect(
      domain.ServiceSchema.safeParse({ ...baseService, durationMinutes: -1 }).success,
    ).toBe(false);
  });

  it('accepts zero durationMinutes', () => {
    expect(
      domain.ServiceSchema.safeParse({ ...baseService, durationMinutes: 0 }).success,
    ).toBe(true);
  });

  it('no longer has a duration (hours) field', () => {
    expect((domain.ServiceSchema.shape as Record<string, unknown>).duration).toBeUndefined();
  });

  it('requires tariffs array', () => {
    const { tariffs: _tariffs, ...rest } = baseService;
    expect(domain.ServiceSchema.safeParse(rest).success).toBe(false);
  });

  it('validates tariffs items', () => {
    expect(
      domain.ServiceSchema.safeParse({ ...baseService, tariffs: [{ id: 'x' }] }).success,
    ).toBe(false);
  });

  it('keeps legacy price twins (spec §4.1)', () => {
    const shape = domain.ServiceSchema.shape as Record<string, unknown>;
    expect(shape.defaultAdultPrice).toBeDefined();
    expect(shape.defaultChildPrice).toBeDefined();
    expect(shape.defaultIndividualPrice).toBeDefined();
    expect(shape.adultPrice).toBeDefined();
    expect(shape.childPrice).toBeDefined();
    expect(shape.individualPrice).toBeDefined();
  });
});

describe('ActivitySchema removed', () => {
  it('ActivitySchema is not exported', () => {
    expect((domain as Record<string, unknown>)['ActivitySchema']).toBeUndefined();
  });
});

describe('ScheduleAdminDTO (type-level; enforced by tsc)', () => {
  it('uses startMinutes instead of startTime', () => {
    const dto = {
      id: 'a1',
      masterId: 'm1',
      serviceId: 's1',
      locationId: 'l1',
      masterName: 'Мастер',
      serviceTitle: 'Услуга',
      date: '2026-06-01',
      time: '10:30',
      durationMinutes: 90,
      occupied: 0,
      capacity: 10,
      locationName: 'Студия',
      priceMin: 100,
      priceMax: 200,
      day: 0,
      startMinutes: 630,
      isPrivate: false,
      masterColor: '#004D56',
      minAge: '6',
      comment: '',
    } satisfies ScheduleAdminDTO;
    expect(dto.startMinutes).toBe(630);
  });
});
