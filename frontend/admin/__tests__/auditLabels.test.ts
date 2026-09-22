import { describe, it, expect } from 'vitest';
import { ACTION_LABELS, ENTITY_LABELS, ROLE_LABELS, formatChangesValue } from '../app/(main)/audit/auditLabels';

// The journal's action vocabulary (spec §4/§8 — every action the backend
// accumulator can stage) and the entity vocabulary (ENTITY_SIGNATURES keys
// in backend src/events/audit.py — all 16 canonical #239 names). The spec
// §7 requires the RUSSIAN label dictionary on the frontend to cover BOTH
// completely: an unknown key would render a raw English slug in the table.
const ALL_ACTIONS = [
  'create',
  'update',
  'patch',
  'delete',
  'archive',
  'restore',
  'reorder',
] as const;

const ALL_ENTITIES = [
  'clients',
  'visitors',
  'services',
  'locations',
  'materials',
  'tags',
  'positions',
  'activities',
  'records',
  'visits',
  'payments',
  'photos',
  'staff',
  'users',
  'masters',
  'user_settings',
] as const;

describe('ACTION_LABELS covers every journal action (GH #344 §7)', () => {
  it.each(ALL_ACTIONS)('has a non-empty Russian label for "%s"', (action) => {
    const label = ACTION_LABELS[action];
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    // Cyrillic — a label must be human Russian, not a raw slug.
    expect(label).toMatch(/[А-Яа-яЁё]/);
  });

  it('labels the spec §7 verbs', () => {
    expect(ACTION_LABELS.create).toBe('создал');
    expect(ACTION_LABELS.update).toBe('изменил');
    expect(ACTION_LABELS.patch).toBe('изменил');
    expect(ACTION_LABELS.delete).toBe('удалил');
    expect(ACTION_LABELS.archive).toBe('заархивировал');
    expect(ACTION_LABELS.restore).toBe('восстановил');
    expect(ACTION_LABELS.reorder).toBe('переставил');
  });
});

describe('ENTITY_LABELS covers every ENTITY_SIGNATURES key (GH #344 §7)', () => {
  it.each(ALL_ENTITIES)('has a non-empty Russian label for "%s"', (entity) => {
    const label = ENTITY_LABELS[entity];
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/[А-Яа-яЁё]/);
  });
});

describe('ROLE_LABELS', () => {
  it('labels the two user roles', () => {
    expect(ROLE_LABELS.admin).toBe('Администратор');
    expect(ROLE_LABELS.master).toBe('Мастер');
  });
});

describe('formatChangesValue (GH #344 §7 «поле: было → стало»)', () => {
  it('renders masked phone/email strings VERBATIM (no second-guessing)', () => {
    expect(formatChangesValue('+7 (9**) ***-45-67')).toBe('+7 (9**) ***-45-67');
    expect(formatChangesValue('i***@example.com')).toBe('i***@example.com');
  });

  it('renders null as the empty dash', () => {
    expect(formatChangesValue(null)).toBe('—');
  });

  it('renders booleans in Russian', () => {
    expect(formatChangesValue(true)).toBe('да');
    expect(formatChangesValue(false)).toBe('нет');
  });

  it('renders numbers as-is', () => {
    expect(formatChangesValue(3500)).toBe('3500');
  });

  it('renders lists bracketed, comma-separated', () => {
    expect(formatChangesValue(['t1', 't2'])).toBe('[t1, t2]');
  });
});
