import type { Master, Studio, Service, Activity, Client, Visitor, Record, Visit, Payment } from '@memo/domain';

// ─── Masters ─────────────────────────────────────────────────────────────

export const MASTERS: Master[] = [
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

// Alias for booking components (locations = studios)
export const LOCATIONS = STUDIOS;

export const STUDIO_MAP: Record<string, string> = {
  alpika: 'Альпика',
  grand: 'Гранд Отель Поляна',
  p1389: 'Поляна 1389',
};

// ─── Services ─────────────────────────────────────────────────────────────

export const SERVICES: Service[] = [
  { id: 's1', name: 'Картина маслом',       duration: 2.5, maxCapacity: 8,  minAge: '12', maxAge: '99', defaultAdultPrice: 3500, defaultChildPrice: 2500, defaultIndividualPrice: 5000 },
  { id: 's2', name: 'Картина акрилом',      duration: 2,   maxCapacity: 10, minAge: '6',  maxAge: '99', defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
  { id: 's3', name: 'Мини-картина акрилом', duration: 1.5, maxCapacity: 8,  minAge: '6',  maxAge: '99', defaultAdultPrice: 2000, defaultChildPrice: 1500, defaultIndividualPrice: 3000 },
  { id: 's4', name: 'Акварель',             duration: 2.5, maxCapacity: 6,  minAge: '6-12', maxAge: '99', defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
  { id: 's5', name: 'Ручная лепка',         duration: 1.5, maxCapacity: 6,  minAge: '5',  maxAge: '99', defaultAdultPrice: 2200, defaultChildPrice: 1800, defaultIndividualPrice: 3500 },
  { id: 's6', name: 'Роспись одежды',       duration: 2,   maxCapacity: 10, minAge: '8',  maxAge: '99', defaultAdultPrice: 3200, defaultChildPrice: 2500, defaultIndividualPrice: 4500 },
  { id: 's7', name: 'Морской пейзаж',       duration: 3,   maxCapacity: 8,  minAge: '12', maxAge: '99', defaultAdultPrice: 3800, defaultChildPrice: 2800, defaultIndividualPrice: 5500 },
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

// ─── Booking Reference Activities ─────────────────────────────────────────
// These are activities referenced by booking records.
// They exist as a separate map so RECORDS can link to them by stable IDs.

export const BOOKING_ACTIVITIES: Activity[] = [
  { id: 'act1', day: 0, masterId: 'm1', startTime: 10, duration: 2, serviceId: 's5', serviceName: 'Керамика ручной работы', minAge: '6', locationId: 'alpika', occupied: 5, capacity: 8, isPrivate: false },
  { id: 'act2', day: 1, masterId: 'm2', startTime: 11, duration: 1.5, serviceId: 's4', serviceName: 'Рисование акварелью', minAge: '8', locationId: 'grand', occupied: 3, capacity: 6, isPrivate: false },
  { id: 'act3', day: 1, masterId: 'm1', startTime: 14, duration: 2, serviceId: 's5', serviceName: 'Керамика ручной работы', minAge: '6', locationId: 'grand', occupied: 1, capacity: 1, isPrivate: true },
  { id: 'act5', day: 2, masterId: 'm3', startTime: 10, duration: 2, serviceId: 's5', serviceName: 'Керамика ручной работы', minAge: '6', locationId: 'alpika', occupied: 4, capacity: 8, isPrivate: false },
  { id: 'act7', day: 3, masterId: 'm4', startTime: 12, duration: 2, serviceId: 's1', serviceName: 'Живопись маслом', minAge: '12', locationId: 'p1389', occupied: 6, capacity: 10, isPrivate: false },
  { id: 'act8', day: 4, masterId: 'm1', startTime: 9, duration: 2, serviceId: 's2', serviceName: 'Рисование акрилом', minAge: '10', locationId: 'grand', occupied: 1, capacity: 1, isPrivate: true },
  { id: 'act10', day: 5, masterId: 'm5', startTime: 15, duration: 2, serviceId: 's5', serviceName: 'Ручная лепка', minAge: '5', locationId: 'alpika', occupied: 5, capacity: 10, isPrivate: false },
];

// ─── Booking Mock Data ────────────────────────────────────────────────────

export const CLIENTS: Client[] = [
  { id: 'cl1', name: 'Анна Смирнова', phone: '+7 (916) 123-45-67', createdAt: '2025-01-15' },
  { id: 'cl2', name: 'Ольга Кузнецова', phone: '+7 (925) 987-65-43', createdAt: '2025-02-03' },
  { id: 'cl3', name: 'Дмитрий Попов', phone: '+7 (903) 555-12-34', createdAt: '2025-03-10' },
  { id: 'cl4', name: 'Елена Васильева', phone: '+7 (977) 444-33-22', createdAt: '2025-03-22' },
  { id: 'cl5', name: 'Сергей Новиков', phone: '+7 (926) 111-22-33', createdAt: '2025-04-05' },
  { id: 'cl6', name: 'Марина Фёдорова', phone: '+7 (915) 777-88-99', createdAt: '2025-04-18' },
  { id: 'cl7', name: 'Павел Морозов', phone: '+7 (999) 222-33-44', createdAt: '2025-05-01' },
];

export const VISITORS: Visitor[] = [
  { id: 'v1', clientId: 'cl1', name: 'Анна Смирнова', isAdult: true },
  { id: 'v2', clientId: 'cl1', name: 'Маша Смирнова', age: 8, isAdult: false },
  { id: 'v3', clientId: 'cl2', name: 'Ольга Кузнецова', isAdult: true },
  { id: 'v4', clientId: 'cl2', name: 'Петя Кузнецов', age: 10, isAdult: false },
  { id: 'v5', clientId: 'cl3', name: 'Дмитрий Попов', isAdult: true },
  { id: 'v6', clientId: 'cl4', name: 'Елена Васильева', isAdult: true },
  { id: 'v7', clientId: 'cl4', name: 'Катя Васильева', age: 6, isAdult: false },
  { id: 'v8', clientId: 'cl4', name: 'Лиза Васильева', age: 9, isAdult: false },
  { id: 'v9', clientId: 'cl5', name: 'Сергей Новиков', isAdult: true },
  { id: 'v10', clientId: 'cl6', name: 'Марина Фёдорова', isAdult: true },
  { id: 'v11', clientId: 'cl6', name: 'Игорь Фёдоров', age: 12, isAdult: false },
  { id: 'v12', clientId: 'cl7', name: 'Павел Морозов', isAdult: true },
];

export const RECORDS: Record[] = [
  { id: 'rec1', activityId: 'act1', clientId: 'cl1', status: 'waiting', createdAt: '2025-05-01', comment: 'День рождения Маши' },
  { id: 'rec2', activityId: 'act1', clientId: 'cl4', status: 'waiting', createdAt: '2025-05-02' },
  { id: 'rec3', activityId: 'act2', clientId: 'cl3', status: 'visited', createdAt: '2025-05-03' },
  { id: 'rec4', activityId: 'act2', clientId: 'cl5', status: 'cancelled', createdAt: '2025-05-03', comment: 'Болезнь' },
  { id: 'rec5', activityId: 'act3', clientId: 'cl1', status: 'visited', createdAt: '2025-05-04' },
  { id: 'rec6', activityId: 'act5', clientId: 'cl2', status: 'visited', createdAt: '2025-05-05' },
  { id: 'rec7', activityId: 'act5', clientId: 'cl6', status: 'missed', createdAt: '2025-05-05' },
  { id: 'rec8', activityId: 'act7', clientId: 'cl4', status: 'waiting', createdAt: '2025-05-06' },
  { id: 'rec9', activityId: 'act7', clientId: 'cl7', status: 'waiting', createdAt: '2025-05-06' },
  { id: 'rec10', activityId: 'act10', clientId: 'cl1', status: 'visited', createdAt: '2025-05-07' },
  { id: 'rec11', activityId: 'act10', clientId: 'cl3', status: 'cancelled', createdAt: '2025-05-07' },
  { id: 'rec12', activityId: 'act8', clientId: 'cl2', status: 'waiting', createdAt: '2025-05-08' },
];

export const VISITS: Visit[] = [
  { id: 'vis1', recordId: 'rec1', visitorId: 'v1', isPrimary: false, priceCharged: 2500, status: 'visited' },
  { id: 'vis2', recordId: 'rec1', visitorId: 'v2', isPrimary: false, priceCharged: 1800, status: 'visited' },
  { id: 'vis3', recordId: 'rec2', visitorId: 'v6', isPrimary: false, priceCharged: 2500, status: 'visited' },
  { id: 'vis4', recordId: 'rec2', visitorId: 'v7', isPrimary: false, priceCharged: 1800, status: 'visited' },
  { id: 'vis5', recordId: 'rec2', visitorId: 'v8', isPrimary: false, priceCharged: 1800, status: 'visited' },
  { id: 'vis6', recordId: 'rec3', visitorId: 'v5', isPrimary: false, priceCharged: 2800, status: 'visited' },
  { id: 'vis7', recordId: 'rec5', visitorId: 'v1', isPrimary: true, priceCharged: 8200, status: 'visited' },
  { id: 'vis8', recordId: 'rec5', visitorId: 'v2', isPrimary: false, priceCharged: 1800, status: 'visited' },
  { id: 'vis9', recordId: 'rec6', visitorId: 'v3', isPrimary: false, priceCharged: 2500, status: 'visited' },
  { id: 'vis10', recordId: 'rec6', visitorId: 'v4', isPrimary: false, priceCharged: 1800, status: 'visited' },
  { id: 'vis11', recordId: 'rec8', visitorId: 'v6', isPrimary: false, priceCharged: 3500, status: 'visited' },
  { id: 'vis12', recordId: 'rec9', visitorId: 'v12', isPrimary: false, priceCharged: 3500, status: 'waiting' },
  { id: 'vis13', recordId: 'rec10', visitorId: 'v1', isPrimary: false, priceCharged: 3000, status: 'visited' },
  { id: 'vis14', recordId: 'rec10', visitorId: 'v2', isPrimary: false, priceCharged: 2200, status: 'visited' },
  { id: 'vis15', recordId: 'rec12', visitorId: 'v3', isPrimary: true, priceCharged: 8200, status: 'waiting' },
  { id: 'vis16', recordId: 'rec12', visitorId: 'v4', isPrimary: false, priceCharged: 2000, status: 'waiting' },
];

export const PAYMENTS: Payment[] = [
  { id: 'pay1', recordId: 'rec1', amount: 4300, paid: true, method: 'card', createdAt: '2025-05-01' },
  { id: 'pay2', recordId: 'rec2', amount: 6100, paid: true, method: 'transfer', createdAt: '2025-05-02' },
  { id: 'pay3', recordId: 'rec3', amount: 2800, paid: true, method: 'card', createdAt: '2025-05-03' },
  { id: 'pay4', recordId: 'rec5', amount: 10000, paid: true, method: 'cash', createdAt: '2025-05-04' },
  { id: 'pay5', recordId: 'rec6', amount: 4300, paid: false, createdAt: '2025-05-05' },
  { id: 'pay6', recordId: 'rec8', amount: 3500, paid: true, method: 'card', createdAt: '2025-05-06' },
  { id: 'pay7', recordId: 'rec9', amount: 3500, paid: false, createdAt: '2025-05-06' },
  { id: 'pay8', recordId: 'rec10', amount: 5200, paid: true, method: 'transfer', createdAt: '2025-05-07' },
  { id: 'pay9', recordId: 'rec12', amount: 10200, paid: true, method: 'card', createdAt: '2025-05-08' },
];
