/**
 * Shared `expected` builder for the deferred-delete conveyor (#345 Task 6).
 * Extracted verbatim from the duplicated helpers in useDeleteRecord (#285
 * D9а) and useTagsMutations (#318 D6) — both now import this module; the
 * helper's contract is asserted here directly (the hook suites cover it
 * end-to-end via their commit payloads).
 */
import { describe, it, expect } from 'vitest';
import type { DependencyNode } from '@memo/api-client';
import { expectedFromDependencies } from '../lib/expectedFromDependencies';

describe('expectedFromDependencies (#345 shared module)', () => {
  it('builds id-sets per entity from nodes carrying items — the FULL tree', () => {
    const deps: DependencyNode[] = [
      {
        entity: 'records', auto: false, relation: 'Запись',
        count: 2, allowed_actions: ['nullify'],
        items: [
          { id: 'r-1', label: '12.05 10:00' },
          { id: 'r-2', label: '13.05 12:00' },
        ],
      },
      {
        entity: 'visitors', auto: false, relation: 'Посетитель',
        count: 1, allowed_actions: ['cascade'],
        items: [{ id: 'v-1', label: 'Анна' }],
      },
    ];

    expect(expectedFromDependencies(deps)).toEqual({
      records: ['r-1', 'r-2'],
      visitors: ['v-1'],
    });
  });

  it('skips nodes without items (auto-resolved entities: staff tree, *_tags joins)', () => {
    const deps: DependencyNode[] = [
      { entity: 'users', auto: true, relation: 'Пользователь', count: 1, allowed_actions: ['cascade'] },
      { entity: 'masters', auto: true, relation: 'Мастер', count: 1, allowed_actions: ['cascade'] },
      { entity: 'client_tags', auto: true, relation: 'Тег', count: 5, allowed_actions: ['cascade'] },
      {
        entity: 'records', auto: false, relation: 'Запись',
        count: 1, allowed_actions: ['nullify'],
        items: [{ id: 'r-1', label: 'Запись' }],
      },
    ];

    // Only the items-bearing node lands in `expected`.
    expect(expectedFromDependencies(deps)).toEqual({ records: ['r-1'] });
  });

  it('empty tree → {}', () => {
    expect(expectedFromDependencies([])).toEqual({});
  });
});
