/**
 * #480 §3.5 — cross-package enum parity. After the Wave-5 dead-code cleanup
 * @memo/domain keeps exactly two live dictionaries that mirror api-client
 * contract enums: `VisitStatus` (visit_status.ts) and `TariffSchema.audience`.
 * These pins guard both directions — set equality at runtime, assignability
 * at type level (a diverging literal fails tsc here, not just the assertion).
 */
import { describe, it, expect } from 'vitest';
import { TariffSchema } from '@memo/domain';
import type { Tariff, VisitStatus } from '@memo/domain';
import { VisitStatusSchema, TariffAudienceSchema } from '@memo/api-client';
import type { TariffAudience } from '@memo/api-client';

describe('#480 §3.5 cross-package parity: @memo/domain ↔ @memo/api-client', () => {
  it('VisitStatus (domain) is set-equal to VisitStatusSchema.options (api-client)', () => {
    // api-client ⊆ domain: tsc fails if a schema literal leaves the domain union.
    const fromApiClient: VisitStatus[] = VisitStatusSchema.options;
    // domain ⊆ api-client: Record keyed by the union forces every member listed.
    const exhaustive: Record<VisitStatus, true> = {
      waiting: true,
      visited: true,
      missed: true,
      cancelled: true,
    };
    expect(new Set(fromApiClient)).toEqual(new Set(Object.keys(exhaustive)));
  });

  it('TariffSchema.audience (domain) is set-equal to TariffAudienceSchema.options (api-client)', () => {
    // domain ⊆ api-client and api-client ⊆ domain — both directions via tsc.
    const fromDomain: TariffAudience[] = TariffSchema.shape.audience.options;
    const fromApiClient: Tariff['audience'][] = TariffAudienceSchema.options;
    expect(new Set(fromDomain)).toEqual(new Set(fromApiClient));
  });
});
