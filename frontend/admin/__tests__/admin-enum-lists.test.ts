/**
 * #480 §3.4 — composition and ORDER pins for the admin's explicit enum
 * lists (UI order ≠ declaration order, so they stay hand-written) and for
 * schema-derived UI lists. These pin TODAY's composition/order byte-for-byte;
 * set-completeness against `XSchema.options` is Task 5's suite, not here.
 */
import { describe, it, expect } from 'vitest';
import { RECORDS_STATUS_VALUES } from '../app/(main)/records/useRecordsUrlState';
import { VISIT_STATUS_ORDER } from '../app/components/shared/config/VISIT_STATUS_CONFIG';
import { SERVICE_FIELDS } from '../app/(main)/services/components/serviceFields';
import type {
  SelectFieldConfig,
  ServiceFieldConfig,
} from '../app/(main)/services/components/serviceFields';

describe('explicit UI-order lists stay byte-identical (#480 §3.4)', () => {
  it('RECORDS_STATUS_VALUES — the filter cycle order', () => {
    expect(RECORDS_STATUS_VALUES).toEqual(['waiting', 'visited', 'cancelled', 'missed']);
  });

  it('VISIT_STATUS_ORDER — the badge display order (Неявка last)', () => {
    expect(VISIT_STATUS_ORDER).toEqual(['waiting', 'visited', 'cancelled', 'missed']);
  });
});

describe('schema-derived UI lists keep their composition and order', () => {
  it('SERVICE_FIELDS tariff audience options — kid/adult/all with ru labels', () => {
    const tariffs = SERVICE_FIELDS.find(
      (f): f is Extract<ServiceFieldConfig, { type: 'nested-list' }> => f.type === 'nested-list' && f.key === 'tariffs',
    );
    expect(tariffs).toBeDefined();
    const audience = tariffs!.itemFields.find(
      (f): f is SelectFieldConfig => f.type === 'select' && f.key === 'audience',
    );
    expect(audience).toBeDefined();
    expect(audience!.options).toEqual([
      { value: 'kid', label: 'детский' },
      { value: 'adult', label: 'взрослый' },
      { value: 'all', label: 'единый' },
    ]);
  });
});
