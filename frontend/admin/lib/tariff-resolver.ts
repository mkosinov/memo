/**
 * Default tariff resolver (GH #284) — the single owner of the autofill rule.
 *
 * Rule (spec §2.3–2.4):
 *   - age inside «Дети» (3–11)        → first tariff with audience="kid";
 *   - everything else (12–17, 'adult',
 *     null, undefined)                → first tariff with audience="adult";
 *   - no match in the target group    → the FIRST tariff in the list
 *     (legacy behaviour; the fallback may cross groups and may return an
 *     "all" tariff);
 *   - "all" is NEVER a targeted substitute — it can only surface via the
 *     first-in-list fallback;
 *   - empty tariff list               → null (no tariff);
 *   - "first" = API order of the tariffs array;
 *   - pure: repeated calls with the same age return the same tariff
 *     (idempotent), input is never mutated.
 */

import { isKidsAge } from '@/lib/age-groups';

/**
 * Narrow structural type — enough for the resolver, decoupled from full Tariff.
 * `audience` is optional: elements without it (legacy callers passing bare
 * {id, price}) can never match kid/adult and fall back to the first in list —
 * the legacy behaviour the spec prescribes when no group info exists.
 * The resolver is generic over the element type, so the caller keeps `price`.
 */
export interface TariffLike {
  id: string;
  audience?: 'kid' | 'adult' | 'all';
}

/** Age as selected in the UI: a number 3–17, the 'adult' sentinel, or empty. */
export type SelectedAge = number | 'adult' | null | undefined;

export function resolveDefaultTariff<T extends TariffLike>(
  tariffs: T[],
  age: SelectedAge,
): T | null {
  const first = tariffs[0];
  if (!first) return null;

  const wanted: NonNullable<TariffLike['audience']> =
    typeof age === 'number' && isKidsAge(age) ? 'kid' : 'adult';
  const match = tariffs.find((t) => t.audience === wanted);
  return match ?? first;
}
