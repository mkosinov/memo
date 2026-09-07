/**
 * Partition a flat bag of schedule overrides into the three split contexts
 * (GH #141) — data / view / settings.
 *
 * Tests keep calling their render helper with one flat object (the old
 * `createMockScheduleContext({...})` call shape); this router sends each key to
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

const DATA_KEYS: readonly string[] = [
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
];

const VIEW_KEYS: readonly string[] = [
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
];

const SETTINGS_KEYS: readonly string[] = [
  'cellHeight',
  'setCellHeight',
  'gridFrequency',
  'setGridFrequency',
  'workingHoursStart',
  'setWorkingHoursStart',
  'workingHoursEnd',
  'setWorkingHoursEnd',
];

export function splitScheduleOverrides(overrides: ScheduleOverrides = {}): {
  data: Partial<ScheduleDataContextType>;
  view: Partial<ScheduleViewContextType>;
  settings: Partial<GridSettingsContextType>;
} {
  const data: Record<string, unknown> = {};
  const view: Record<string, unknown> = {};
  const settings: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(overrides)) {
    if (DATA_KEYS.includes(key)) data[key] = value;
    else if (VIEW_KEYS.includes(key)) view[key] = value;
    else if (SETTINGS_KEYS.includes(key)) settings[key] = value;
    else throw new Error(`splitScheduleOverrides: unknown schedule override key "${key}"`);
  }

  return {
    data: data as Partial<ScheduleDataContextType>,
    view: view as Partial<ScheduleViewContextType>,
    settings: settings as Partial<GridSettingsContextType>,
  };
}
