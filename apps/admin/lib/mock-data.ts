import type { Artist, Studio, Service, Activity } from '@memo/domain';

// ─── Artists ──────────────────────────────────────────────────────────────

export const ARTISTS: Artist[] = [
  { id: 'm1', name: 'Ольга Середа',       shortName: 'Ольга',      color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова',    shortName: 'Юлия',       color: '#6B7E9C' },
  { id: 'm3', name: 'Анастасия П.',       shortName: 'Анастасия',  color: '#A07060' },
  { id: 'm4', name: 'Дарья Тюльпина',     shortName: 'Дарья',      color: '#7A6E9C' },
  { id: 'm5', name: 'Александра В.',      shortName: 'Александра', color: '#8A7840' },
  { id: 'm7', name: 'Ирина Горох',        shortName: 'Ирина',      color: '#9A5870' },
];

// ─── Studios ──────────────────────────────────────────────────────────────

export const STUDIOS: Studio[] = [
  { id: 'alpika', name: 'Альпика',            address: 'Альпика, 1 этаж' },
  { id: 'grand',  name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
  { id: 'p1389',  name: 'Поляна 1389',        address: 'Поляна 1389, 2 этаж' },
];

export const STUDIO_MAP: Record<string, string> = {
  alpika: 'Альпика',
  grand: 'Гранд Отель Поляна',
  p1389: 'Поляна 1389',
};

// ─── Services ─────────────────────────────────────────────────────────────

export const SERVICES: Service[] = [
  { id: 's1', name: 'Картина маслом',       duration: 2.5, maxCapacity: 8,  minAge: '12+', defaultAdultPrice: 3500, defaultChildPrice: 2500, defaultIndividualPrice: 5000 },
  { id: 's2', name: 'Картина акрилом',      duration: 2,   maxCapacity: 10, minAge: '6+',  defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
  { id: 's3', name: 'Мини-картина акрилом', duration: 1.5, maxCapacity: 8,  minAge: '6+',  defaultAdultPrice: 2000, defaultChildPrice: 1500, defaultIndividualPrice: 3000 },
  { id: 's4', name: 'Акварель',             duration: 2.5, maxCapacity: 6,  minAge: '6-12', defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
  { id: 's5', name: 'Ручная лепка',         duration: 1.5, maxCapacity: 6,  minAge: '5+',  defaultAdultPrice: 2200, defaultChildPrice: 1800, defaultIndividualPrice: 3500 },
  { id: 's6', name: 'Роспись одежды',       duration: 2,   maxCapacity: 10, minAge: '8+',  defaultAdultPrice: 3200, defaultChildPrice: 2500, defaultIndividualPrice: 4500 },
  { id: 's7', name: 'Морской пейзаж',       duration: 3,   maxCapacity: 8,  minAge: '12+', defaultAdultPrice: 3800, defaultChildPrice: 2800, defaultIndividualPrice: 5500 },
];

// Map service name → service id for raw event data
const SERVICE_NAME_TO_ID: Record<string, string> = {
  'Картина маслом': 's1',
  'Картина акрилом': 's2',
  'Мини-картина акрилом': 's3',
  'Акварель': 's4',
  'Ручная лепка': 's5',
  'Роспись одежды': 's6',
  'Морской пейзаж': 's7',
  // Shorthand names used in raw events
  'Мини-картина': 's3',
  'Индивидуальный МК': 's1',
  'Индивидуальный урок': 's1',
  'Индив. керамика': 's5',
};

// ─── Raw Activity Data ────────────────────────────────────────────────────

interface RawActivity {
  day: number;
  master: string;
  start: number;
  dur: number;
  service: string;
  age: string;
  loc: string;
  occ: number;
  cap: number;
  priv: boolean;
}

const RAW_EVENTS: RawActivity[] = [
  // ПН (day 0)
  { day: 0, master: 'm1', start: 10,   dur: 3,   service: 'Морской пейзаж',       age: '6-12',  loc: 'grand',  occ: 3, cap: 8,  priv: false },
  { day: 0, master: 'm2', start: 12,   dur: 1.5, service: 'Ручная лепка',         age: '5+',    loc: 'alpika', occ: 4, cap: 6,  priv: false },
  { day: 0, master: 'm4', start: 14,   dur: 2,   service: 'Индивидуальный МК',    age: '12+',   loc: 'grand',  occ: 1, cap: 1,  priv: true  },
  { day: 0, master: 'm3', start: 16,   dur: 2,   service: 'Картина акрилом',      age: '6+',    loc: 'p1389',  occ: 5, cap: 10, priv: false },
  // ВТ (day 1)
  { day: 1, master: 'm3', start: 11,   dur: 2,   service: 'Картина акрилом',      age: '6+',    loc: 'alpika', occ: 7, cap: 10, priv: false },
  { day: 1, master: 'm1', start: 15,   dur: 1.5, service: 'Мини-картина акрилом', age: '6+',    loc: 'grand',  occ: 3, cap: 8,  priv: false },
  { day: 1, master: 'm5', start: 17,   dur: 2.5, service: 'Картина маслом',       age: '12+',   loc: 'p1389',  occ: 5, cap: 8,  priv: false },
  // СР (day 2)
  { day: 2, master: 'm2', start: 10.5, dur: 2,   service: 'Роспись одежды',       age: '8+',    loc: 'alpika', occ: 9, cap: 10, priv: false },
  { day: 2, master: 'm7', start: 13,   dur: 1.5, service: 'Мини-картина',         age: '6+',    loc: 'grand',  occ: 2, cap: 8,  priv: false },
  { day: 2, master: 'm4', start: 16,   dur: 2.5, service: 'Акварель',             age: '6-12',  loc: 'p1389',  occ: 4, cap: 6,  priv: false },
  // ЧТ (day 3)
  { day: 3, master: 'm1', start: 11,   dur: 3,   service: 'Морской пейзаж',       age: '12+',   loc: 'grand',  occ: 6, cap: 8,  priv: false },
  { day: 3, master: 'm3', start: 14.5, dur: 2,   service: 'Картина акрилом',      age: '6+',    loc: 'alpika', occ: 4, cap: 10, priv: false },
  { day: 3, master: 'm5', start: 18,   dur: 1.5, service: 'Индивидуальный урок',  age: '12+',   loc: 'p1389',  occ: 1, cap: 1,  priv: true  },
  // ПТ (day 4)
  { day: 4, master: 'm2', start: 10,   dur: 2.5, service: 'Ручная лепка',         age: '5+',    loc: 'alpika', occ: 5, cap: 6,  priv: false },
  { day: 4, master: 'm7', start: 12,   dur: 2,   service: 'Картина акрилом',      age: '6+',    loc: 'grand',  occ: 8, cap: 10, priv: false },
  { day: 4, master: 'm1', start: 15,   dur: 2.5, service: 'Картина маслом',       age: '12+',   loc: 'grand',  occ: 7, cap: 8,  priv: false },
  { day: 4, master: 'm4', start: 18,   dur: 1.5, service: 'Мини-картина',         age: '6+',    loc: 'p1389',  occ: 6, cap: 8,  priv: false },
  // СБ (day 5)
  { day: 5, master: 'm1', start: 10,   dur: 3,   service: 'Морской пейзаж',       age: '12+',   loc: 'grand',  occ: 8, cap: 8,  priv: false },
  { day: 5, master: 'm2', start: 10,   dur: 1.5, service: 'Мини-картина',         age: '6+',    loc: 'alpika', occ: 7, cap: 8,  priv: false },
  { day: 5, master: 'm3', start: 12,   dur: 2,   service: 'Картина акрилом',      age: '6+',    loc: 'alpika', occ: 9, cap: 10, priv: false },
  { day: 5, master: 'm5', start: 13,   dur: 2.5, service: 'Картина маслом',       age: '12+',   loc: 'p1389',  occ: 6, cap: 8,  priv: false },
  { day: 5, master: 'm7', start: 15.5, dur: 1.5, service: 'Мини-картина',         age: '6+',    loc: 'grand',  occ: 4, cap: 8,  priv: false },
  { day: 5, master: 'm4', start: 16,   dur: 2.5, service: 'Акварель',             age: '6-12',  loc: 'p1389',  occ: 5, cap: 6,  priv: false },
  { day: 5, master: 'm3', start: 14.5, dur: 1.5, service: 'Индив. керамика',      age: '12+',   loc: 'alpika', occ: 1, cap: 1,  priv: true  },
  // ВС (day 6)
  { day: 6, master: 'm1', start: 11,   dur: 2.5, service: 'Картина маслом',       age: '12+',   loc: 'grand',  occ: 5, cap: 8,  priv: false },
  { day: 6, master: 'm2', start: 11,   dur: 1.5, service: 'Ручная лепка',         age: '5+',    loc: 'alpika', occ: 3, cap: 6,  priv: false },
  { day: 6, master: 'm7', start: 14,   dur: 2,   service: 'Картина акрилом',      age: '6+',    loc: 'grand',  occ: 6, cap: 10, priv: false },
  { day: 6, master: 'm5', start: 16.5, dur: 2,   service: 'Роспись одежды',       age: '8+',    loc: 'p1389',  occ: 4, cap: 8,  priv: false },
];

// ─── Get Static Events ────────────────────────────────────────────────────

/**
 * Returns 28 static activities for the schedule.
 * These events use day-of-week indices (0=Mon..6=Sun) rather than absolute dates,
 * so the same set is returned regardless of which week is requested.
 */
export function getStaticEvents(): Activity[] {
  return RAW_EVENTS.map((e, i) => ({
    id: `ev_${i}`,
    day: e.day,
    masterId: e.master,
    startTime: e.start,
    duration: e.dur,
    serviceId: SERVICE_NAME_TO_ID[e.service] || e.service,
    serviceName: e.service,
    minAge: e.age,
    locationId: e.loc,
    occupied: e.occ,
    capacity: e.cap,
    isPrivate: e.priv,
  }));
}
