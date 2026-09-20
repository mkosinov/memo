import { describe, it, expect } from 'vitest';
import { resolveDefaultTariff, type TariffLike } from '@/lib/tariff-resolver';

function t(id: string, audience: TariffLike['audience']): TariffLike {
  return { id, audience };
}

describe('resolveDefaultTariff (GH #284)', () => {
  // ── Kids branch: age ∈ 3–11 → first audience="kid" ────────────────────────

  it('returns the first kid tariff for a kids age (3)', () => {
    const tariffs = [t('a', 'adult'), t('b', 'kid'), t('c', 'kid')];
    expect(resolveDefaultTariff(tariffs, 3)?.id).toBe('b');
  });

  it('returns the first kid tariff for the upper kids bound (11)', () => {
    const tariffs = [t('a', 'adult'), t('b', 'kid')];
    expect(resolveDefaultTariff(tariffs, 11)?.id).toBe('b');
  });

  it('picks the FIRST kid tariff when several match (API order)', () => {
    const tariffs = [t('x', 'kid'), t('y', 'kid'), t('z', 'adult')];
    expect(resolveDefaultTariff(tariffs, 7)?.id).toBe('x');
  });

  // ── Adult branch: everything else → first audience="adult" ────────────────

  it('returns the first adult tariff for a teen age (12 — the boundary)', () => {
    const tariffs = [t('a', 'kid'), t('b', 'adult'), t('c', 'adult')];
    expect(resolveDefaultTariff(tariffs, 12)?.id).toBe('b');
  });

  it('returns the first adult tariff for a teen age (17)', () => {
    const tariffs = [t('a', 'kid'), t('b', 'adult')];
    expect(resolveDefaultTariff(tariffs, 17)?.id).toBe('b');
  });

  it('returns the first adult tariff for the adult sentinel', () => {
    const tariffs = [t('a', 'kid'), t('b', 'adult')];
    expect(resolveDefaultTariff(tariffs, 'adult')?.id).toBe('b');
  });

  it.each([
    ['null age', null],
    ['undefined age', undefined],
  ])('returns the first adult tariff for %s', (_name, age) => {
    const tariffs = [t('a', 'kid'), t('b', 'adult')];
    expect(resolveDefaultTariff(tariffs, age)?.id).toBe('b');
  });

  it('never substitutes an "all" tariff in the targeted group', () => {
    const tariffs = [t('only-all', 'all')];
    // kid age: no kid tariff → fallback; adult age: no adult tariff → fallback.
    // Both go through the "first in list" fallback, NOT the all tariff as a
    // group match — asserted here by ordering: first in list is 'first' either way.
    const ordered = [t('first', 'adult'), t('second', 'all')];
    expect(resolveDefaultTariff(ordered, 7)?.id).toBe('first');
  });

  // ── Fallback: no match in the target group → first tariff in list ─────────

  it('falls back to the first tariff in list when a kid age has no kid tariff (cross-group)', () => {
    const tariffs = [t('adult-only', 'adult')];
    expect(resolveDefaultTariff(tariffs, 5)?.id).toBe('adult-only');
  });

  it('falls back to the first tariff in list when an adult age has no adult tariff (cross-group)', () => {
    const tariffs = [t('kid-only', 'kid')];
    expect(resolveDefaultTariff(tariffs, 'adult')?.id).toBe('kid-only');
  });

  it('fallback may return an "all" tariff', () => {
    const tariffs = [t('all-tariff', 'all')];
    expect(resolveDefaultTariff(tariffs, 5)?.id).toBe('all-tariff');
    expect(resolveDefaultTariff(tariffs, 'adult')?.id).toBe('all-tariff');
  });

  it('fallback preserves API order (first element, not re-sorted)', () => {
    const tariffs = [t('z-first', 'all'), t('a-second', 'kid')];
    // Teen age: no adult tariff → fallback takes the first element as-is.
    expect(resolveDefaultTariff(tariffs, 15)?.id).toBe('z-first');
  });

  // ── Empty list ────────────────────────────────────────────────────────────

  it('returns null for an empty tariff list (any age)', () => {
    expect(resolveDefaultTariff([], 5)).toBeNull();
    expect(resolveDefaultTariff([], 'adult')).toBeNull();
    expect(resolveDefaultTariff([], null)).toBeNull();
  });

  // ── Idempotency: same age → same tariff ───────────────────────────────────

  it('is idempotent: repeated calls with the same age return the same tariff', () => {
    const tariffs = [t('a', 'adult'), t('b', 'kid')];
    const first = resolveDefaultTariff(tariffs, 7);
    const second = resolveDefaultTariff(tariffs, 7);
    expect(second).toBe(first);
    expect(second?.id).toBe('b');
  });

  it('does not mutate the input list', () => {
    const tariffs = [t('a', 'adult'), t('b', 'kid')];
    const snapshot = [...tariffs];
    resolveDefaultTariff(tariffs, 7);
    expect(tariffs).toEqual(snapshot);
  });
});
