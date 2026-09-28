/**
 * Shared `expected` builder for the deferred-delete conveyor (#345 Task 6).
 *
 * Single source of the helper formerly duplicated in useDeleteRecord (#285
 * D9а) and useTagsMutations (#318 D6); the new staff/client hooks (#345)
 * consume it too. `expected` = id-sets per entity snapshotted from the FULL
 * dependency tree the dialog received (the render caps item lines at 10 +
 * «и ещё N» — the payload carries EVERY id; auto-resolved nodes carry no
 * items and are skipped: the server resolves them itself).
 */
import type { DependencyNode } from '@memo/api-client';

export function expectedFromDependencies(
  dependencies: DependencyNode[],
): Record<string, string[]> {
  const expected: Record<string, string[]> = {};
  for (const node of dependencies) {
    if (!node.items) continue;
    expected[node.entity] = node.items.map((item) => item.id);
  }
  return expected;
}
