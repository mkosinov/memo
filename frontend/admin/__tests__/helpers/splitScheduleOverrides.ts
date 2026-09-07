/**
 * Partition a flat bag of schedule overrides into the three split contexts
 * (GH #141) — data / view / settings.
 *
 * Tests keep calling their render helper with one flat object (the old
 * single-context shape); this router sends each key to
 * the factory that now owns it. An unknown key THROWS rather than being
 * silently dropped, so a typo or a newly-added context field cannot quietly
 * weaken a test.
 */
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';
import type { ScheduleViewContextType } from '@/contexts/schedule/ScheduleViewContext';
import type { GridSettingsContextType } from '@/contexts/schedule/GridSettingsContext';

export type ScheduleOverrides = Partial<ScheduleDataContextType> &
  Partial<ScheduleViewContextType> &
  Partial<GridSettingsContextType>;

// Each array is pinned to the context interface that owns it: `satisfies` makes
// a stale/typo'd key a COMPILE error (T9 quality review), while a context field
// added later and not routed here surfaces as the runtime throw below.
const DATA_KEYS = [
  'activities',
  'scheduleIndex',
  'masters',
  'services',
  'locations',
  'loading',
  'error',
  'addActivity',
  'updateActivity',
  'deleteActivity',
  'copyLastWeek',
  'gridStartMinutes',
  'gridEndMinutes',
] as const satisfies readonly (keyof ScheduleDataContextType)[];

const VIEW_KEYS = [
  'viewMode',
  'setViewMode',
  'selectedDay',
  'setSelectedDay',
  'columnMode',
  'setColumnMode',
  'filterMasterIds',
  'filterLocationIds',
  'setFilterMasterIds',
  'setFilterLocationIds',
  'stamp',
  'setStamp',
  'currentWeek',
  'setCurrentWeek',
  'prevPeriod',
  'nextPeriod',
] as const satisfies readonly (keyof ScheduleViewContextType)[];

const SETTINGS_KEYS = [
  'cellHeight',
  'setCellHeight',
  'gridFrequency',
  'setGridFrequency',
  'workingHoursStart',
  'setWorkingHoursStart',
  'workingHoursEnd',
  'setWorkingHoursEnd',
] as const satisfies readonly (keyof GridSettingsContextType)[];

/** Widen the literal tuples for the runtime lookup so unknown keys reach the throw. */
function routesKey(keys: readonly string[], key: string): boolean {
  return keys.includes(key);
}

export function splitScheduleOverrides(overrides: ScheduleOverrides = {}): {
  data: Partial<ScheduleDataContextType>;
  view: Partial<ScheduleViewContextType>;
  settings: Partial<GridSettingsContextType>;
} {
  const data: Record<string, unknown> = {};
  const view: Record<string, unknown> = {};
  const settings: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(overrides)) {
    if (routesKey(DATA_KEYS, key)) data[key] = value;
    else if (routesKey(VIEW_KEYS, key)) view[key] = value;
    else if (routesKey(SETTINGS_KEYS, key)) settings[key] = value;
    else throw new Error(`splitScheduleOverrides: unknown schedule override key "${key}"`);
  }

  return {
    data: data as Partial<ScheduleDataContextType>,
    view: view as Partial<ScheduleViewContextType>,
    settings: settings as Partial<GridSettingsContextType>,
  };
}
