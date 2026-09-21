import { describe, it, expect } from 'vitest';
import { resolveDefaultTariff, type TariffLike } from '@/lib/tariff-resolver';

function t(id: string, audience: TariffLike['audience']): TariffLike {
  return { id, audience };
}

/**
 * Audience-less element (legacy caller passing bare {id, price}): can never
 * match kid/adult → the first-in-list fallback (docstring contract). The
 * element may sit at ANY position — fallback is by position, not by shape.
 */
function bare(id: string): TariffLike {
  return { id };
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

  // ── Audience-less elements (legacy {id, price} callers) ──────────────────

  it('audience-less elements never group-match — first in list wins regardless of age', () => {
    // The docstring promise: "no group info → first in list" (legacy
    // behaviour). Age only matters when a group marker exists.
    const bareList = [bare('b1'), bare('b2')];
    expect(resolveDefaultTariff(bareList, 6)?.id).toBe('b1');
    expect(resolveDefaultTariff(bareList, 14)?.id).toBe('b1');
    expect(resolveDefaultTariff(bareList, 'adult')?.id).toBe('b1');
    expect(resolveDefaultTariff(bareList, null)?.id).toBe('b1');
  });

  it('a marked tariff later in the list still wins over an audience-less first element', () => {
    // Bare elements are not "all" — they match NOTHING. The kid at index 1
    // is the first kid for a kids age; with no adult in the list, an adult
    // age falls back to the FIRST element (the bare one) — legacy behaviour.
    const mixed = [bare('bare-first'), t('kid-1', 'kid')];
    expect(resolveDefaultTariff(mixed, 6)?.id).toBe('kid-1');
    expect(resolveDefaultTariff(mixed, 14)?.id).toBe('bare-first');
    expect(resolveDefaultTariff(mixed, null)?.id).toBe('bare-first');
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
