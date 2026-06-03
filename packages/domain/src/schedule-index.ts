/**
 * Generic index for Schedule items.
 * Indexes store string[] (IDs) NOT full objects — byId is the single source of truth.
 */
export interface ScheduleIndex<T> {
  byId: Map<string, T>;
  byDate: Map<string, string[]>;         // date (YYYY-MM-DD) → activityIds
  byMasterId: Map<string, string[]>;     // masterId → activityIds
  byLocation: Record<string, {
    byDate: Map<string, string[]>;
    byServiceId: Map<string, string[]>;
  }>;
}

/**
 * Build a ScheduleIndex from an array of items.
 *
 * @param items - Array of items with id, masterId, locationId
 * @param options.getDateKey - Function to extract YYYY-MM-DD date from item
 * @param options.getServiceKey - Optional function to extract service key (for web byServiceId index)
 * @returns ScheduleIndex<T>
 */
export function buildSchedule<T extends { id: string; masterId: string; locationId: string }>(
  items: T[],
  options: {
    getDateKey: (item: T) => string;
    getServiceKey?: (item: T) => string;
  },
): ScheduleIndex<T> {
  const byId = new Map<string, T>();
  const byDate = new Map<string, string[]>();
  const byMasterId = new Map<string, string[]>();
  const byLocation: Record<string, { byDate: Map<string, string[]>; byServiceId: Map<string, string[]> }> = {};

  // Always initialize "all" key
  byLocation['all'] = { byDate: new Map(), byServiceId: new Map() };

  const addTo = (map: Map<string, string[]>, key: string, id: string) => {
    const arr = map.get(key) ?? [];
    arr.push(id);
    map.set(key, arr);
  };

  for (const item of items) {
    byId.set(item.id, item);

    const dateKey = options.getDateKey(item);
    addTo(byDate, dateKey, item.id);
    addTo(byMasterId, item.masterId, item.id);
    addTo(byLocation['all'].byDate, dateKey, item.id);

    // Per-location index (lazy init)
    if (!byLocation[item.locationId]) {
      byLocation[item.locationId] = { byDate: new Map(), byServiceId: new Map() };
    }
    addTo(byLocation[item.locationId].byDate, dateKey, item.id);

    // Service key (for web)
    if (options.getServiceKey) {
      const svcKey = options.getServiceKey(item);
      addTo(byLocation['all'].byServiceId, svcKey, item.id);
      addTo(byLocation[item.locationId].byServiceId, svcKey, item.id);
    }
  }

  return { byId, byDate, byMasterId, byLocation };
}

/**
 * Resolve an array of IDs to their full objects via the byId map.
 * Filters out any IDs not found in byId (data integrity safety).
 */
export function resolveById<T>(ids: string[], byId: Map<string, T>): T[] {
  return ids.map(id => byId.get(id)).filter((x): x is T => x !== undefined);
}
