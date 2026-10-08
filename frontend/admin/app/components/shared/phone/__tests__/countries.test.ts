import { describe, it, expect } from 'vitest';
import { PHONE_COUNTRIES, DEFAULT_PHONE_COUNTRY } from '../countries';

// GH #414 Task 1: curated 9-country dictionary (spec §Список стран) —
// RU first, then Russian-alphabetical; RU/KZ share the +7 calling code,
// so uniqueness holds for ISO codes only, never for calling codes.

describe('PHONE_COUNTRIES (spec §Список стран)', () => {
  it('is the curated v1 list of 9 countries', () => {
    expect(PHONE_COUNTRIES).toHaveLength(9);
  });

  it('RU first, the rest in Russian-alphabetical order', () => {
    expect(PHONE_COUNTRIES.map((c) => c.iso)).toEqual([
      'RU', // Россия — default, always first
      'BY', // Беларусь
      'DE', // Германия
      'KZ', // Казахстан
      'LV', // Латвия
      'LT', // Литва
      'PL', // Польша
      'UA', // Украина
      'EE', // Эстония
    ]);
  });

  it('ISO codes are unique (the dictionary key)', () => {
    const isos = PHONE_COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(isos.length);
  });

  it('every entry has a Russian name, a digits-only calling code and a placeholder', () => {
    for (const c of PHONE_COUNTRIES) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.callingCode).toMatch(/^\d+$/);
      expect(c.placeholder.length).toBeGreaterThan(0);
    }
  });

  it('RU and KZ share the +7 calling code (one reduction key by design)', () => {
    const ru = PHONE_COUNTRIES.find((c) => c.iso === 'RU');
    const kz = PHONE_COUNTRIES.find((c) => c.iso === 'KZ');
    expect(ru?.callingCode).toBe('7');
    expect(kz?.callingCode).toBe('7');
  });

  it('default country is RU (the selector default, spec §Виджет PhoneField)', () => {
    expect(DEFAULT_PHONE_COUNTRY).toBe('RU');
  });
});
