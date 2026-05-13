import { Artist, Location, Service, Activity, Client, Visitor, BookingRecord, Visit, Payment } from './types';

export const ARTISTS: Artist[] = [
  { id: 'a1', name: 'Иван Иванов', color: '#667eea', role: 'artist' },
  { id: 'a2', name: 'Мария Петрова', color: '#f5576c', role: 'artist' },
  { id: 'a3', name: 'Алексей Сидоров', color: '#43e97b', role: 'artist' },
  { id: 'a4', name: 'Елена Козлова', color: '#fa709a', role: 'artist' },
  { id: 'a5', name: 'Дмитрий Волков', color: '#fee140', role: 'artist' },
];

export const LOCATIONS: Location[] = [
  { id: 'l1', name: 'Главный офис', defaultCapacity: 20 },
  { id: 'l2', name: 'Филиал 1', defaultCapacity: 15 },
  { id: 'l3', name: 'Студия на Арбате', defaultCapacity: 10 },
];

export const SERVICES: Service[] = [
  { id: 's1', name: 'МК: Керамика', adultPrice: 2500, childPrice: 1800, individualPrice: 8200, maxCapacity: 20, durationMinutes: 120 },
  { id: 's2', name: 'МК: Рисование акварелью', adultPrice: 2800, childPrice: 2000, individualPrice: 8200, maxCapacity: 15, durationMinutes: 180 },
  { id: 's3', name: 'МК: Скетчинг', adultPrice: 2200, childPrice: 1500, individualPrice: 8200, maxCapacity: 15, durationMinutes: 120 },
  { id: 's4', name: 'МК: Лепка из глины', adultPrice: 3000, childPrice: 2200, individualPrice: 8200, maxCapacity: 12, durationMinutes: 150 },
  { id: 's5', name: 'МК: Живопись маслом', adultPrice: 3500, childPrice: 2500, individualPrice: 8200, maxCapacity: 10, durationMinutes: 180 },
];

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

const weekStart = getMonday(new Date());

export const INITIAL_ACTIVITIES: Activity[] = [
  {
    id: 'act1',
    isPublic: true,
    serviceId: 's1',
    locationId: 'l1',
    artistId: 'a1',
    date: weekStart,
    startTime: '10:00',
    endTime: '12:00',
    capacity: 20,
    priceAdult: 2500,
    priceChild: 1800,
    priceIndividual: 8200,
    hasRecords: true,
  },
  {
    id: 'act2',
    isPublic: true,
    serviceId: 's2',
    locationId: 'l1',
    artistId: 'a2',
    date: addDays(weekStart, 2),
    startTime: '14:00',
    endTime: '17:00',
    capacity: 15,
    priceAdult: 2800,
    priceChild: 2000,
    priceIndividual: 8200,
    hasRecords: true,
  },
  {
    id: 'act3',
    isPublic: false,
    serviceId: 's1',
    locationId: 'l1',
    artistId: 'a1',
    date: addDays(weekStart, 2),
    startTime: '19:00',
    endTime: '21:00',
    capacity: 1,
    priceAdult: 2500,
    priceChild: 1800,
    priceIndividual: 8200,
    hasRecords: false,
    clientName: 'Анна Смирнова',
  },
  {
    id: 'act4',
    isPublic: true,
    serviceId: 's3',
    locationId: 'l2',
    artistId: 'a2',
    date: addDays(weekStart, 3),
    startTime: '18:00',
    endTime: '20:00',
    capacity: 15,
    priceAdult: 2200,
    priceChild: 1500,
    priceIndividual: 8200,
    hasRecords: false,
  },
  {
    id: 'act5',
    isPublic: true,
    serviceId: 's1',
    locationId: 'l1',
    artistId: 'a1',
    date: addDays(weekStart, 5),
    startTime: '11:00',
    endTime: '15:00',
    capacity: 20,
    priceAdult: 2500,
    priceChild: 1800,
    priceIndividual: 8200,
    hasRecords: true,
  },
  {
    id: 'act6',
    isPublic: true,
    serviceId: 's4',
    locationId: 'l3',
    artistId: 'a3',
    date: addDays(weekStart, 1),
    startTime: '10:00',
    endTime: '12:30',
    capacity: 12,
    priceAdult: 3000,
    priceChild: 2200,
    priceIndividual: 8200,
    hasRecords: false,
  },
  {
    id: 'act7',
    isPublic: true,
    serviceId: 's5',
    locationId: 'l1',
    artistId: 'a4',
    date: addDays(weekStart, 4),
    startTime: '11:00',
    endTime: '14:00',
    capacity: 10,
    priceAdult: 3500,
    priceChild: 2500,
    priceIndividual: 8200,
    hasRecords: true,
  },
  {
    id: 'act8',
    isPublic: false,
    serviceId: 's2',
    locationId: 'l2',
    artistId: 'a5',
    date: addDays(weekStart, 4),
    startTime: '16:00',
    endTime: '19:00',
    capacity: 1,
    priceAdult: 2800,
    priceChild: 2000,
    priceIndividual: 8200,
    hasRecords: false,
    clientName: 'Ольга Кузнецова',
  },
  {
    id: 'act9',
    isPublic: true,
    serviceId: 's3',
    locationId: 'l1',
    artistId: 'a3',
    date: addDays(weekStart, 5),
    startTime: '16:00',
    endTime: '18:00',
    capacity: 15,
    priceAdult: 2200,
    priceChild: 1500,
    priceIndividual: 8200,
    hasRecords: false,
  },
  {
    id: 'act10',
    isPublic: true,
    serviceId: 's4',
    locationId: 'l2',
    artistId: 'a4',
    date: addDays(weekStart, 6),
    startTime: '12:00',
    endTime: '14:30',
    capacity: 12,
    priceAdult: 3000,
    priceChild: 2200,
    priceIndividual: 8200,
    hasRecords: true,
  },
  {
    id: 'act11',
    isPublic: true,
    serviceId: 's2',
    locationId: 'l3',
    artistId: 'a5',
    date: weekStart,
    startTime: '15:00',
    endTime: '18:00',
    capacity: 10,
    priceAdult: 2800,
    priceChild: 2000,
    priceIndividual: 8200,
    hasRecords: false,
  },
];

export { addDays, addMinutes, getMonday };

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

export const RECORDS: BookingRecord[] = [
  { id: 'rec1', activityId: 'act1', clientId: 'cl1', status: 'CONFIRMED', createdAt: '2025-05-01', comment: 'День рождения Маши' },
  { id: 'rec2', activityId: 'act1', clientId: 'cl4', status: 'CONFIRMED', createdAt: '2025-05-02' },
  { id: 'rec3', activityId: 'act2', clientId: 'cl3', status: 'CONFIRMED', createdAt: '2025-05-03' },
  { id: 'rec4', activityId: 'act2', clientId: 'cl5', status: 'CANCELLED', createdAt: '2025-05-03', comment: 'Болезнь' },
  { id: 'rec5', activityId: 'act3', clientId: 'cl1', status: 'CONFIRMED', createdAt: '2025-05-04' },
  { id: 'rec6', activityId: 'act5', clientId: 'cl2', status: 'CONFIRMED', createdAt: '2025-05-05' },
  { id: 'rec7', activityId: 'act5', clientId: 'cl6', status: 'NO_SHOW', createdAt: '2025-05-05' },
  { id: 'rec8', activityId: 'act7', clientId: 'cl4', status: 'CONFIRMED', createdAt: '2025-05-06' },
  { id: 'rec9', activityId: 'act7', clientId: 'cl7', status: 'CONFIRMED', createdAt: '2025-05-06' },
  { id: 'rec10', activityId: 'act10', clientId: 'cl1', status: 'CONFIRMED', createdAt: '2025-05-07' },
  { id: 'rec11', activityId: 'act10', clientId: 'cl3', status: 'CANCELLED', createdAt: '2025-05-07' },
  { id: 'rec12', activityId: 'act8', clientId: 'cl2', status: 'CONFIRMED', createdAt: '2025-05-08' },
];

export const VISITS: Visit[] = [
  // rec1: act1 (group, Керамика) — Анна + Маша
  { id: 'vis1', recordId: 'rec1', visitorId: 'v1', isPrimary: false, priceCharged: 2500, visited: true },
  { id: 'vis2', recordId: 'rec1', visitorId: 'v2', isPrimary: false, priceCharged: 1800, visited: true },
  // rec2: act1 (group, Керамика) — Елена + Катя + Лиза
  { id: 'vis3', recordId: 'rec2', visitorId: 'v6', isPrimary: false, priceCharged: 2500, visited: true },
  { id: 'vis4', recordId: 'rec2', visitorId: 'v7', isPrimary: false, priceCharged: 1800, visited: true },
  { id: 'vis5', recordId: 'rec2', visitorId: 'v8', isPrimary: false, priceCharged: 1800, visited: true },
  // rec3: act2 (group, Рисование) — Дмитрий
  { id: 'vis6', recordId: 'rec3', visitorId: 'v5', isPrimary: false, priceCharged: 2800, visited: true },
  // rec5: act3 (private, Керамика) — Анна + Маша (isPrimary pays 8200)
  { id: 'vis7', recordId: 'rec5', visitorId: 'v1', isPrimary: true, priceCharged: 8200, visited: true },
  { id: 'vis8', recordId: 'rec5', visitorId: 'v2', isPrimary: false, priceCharged: 1800, visited: true },
  // rec6: act5 (group, Керамика) — Ольга + Петя
  { id: 'vis9', recordId: 'rec6', visitorId: 'v3', isPrimary: false, priceCharged: 2500, visited: true },
  { id: 'vis10', recordId: 'rec6', visitorId: 'v4', isPrimary: false, priceCharged: 1800, visited: true },
  // rec8: act7 (group, Живопись) — Елена
  { id: 'vis11', recordId: 'rec8', visitorId: 'v6', isPrimary: false, priceCharged: 3500, visited: true },
  // rec9: act7 (group, Живопись) — Павел
  { id: 'vis12', recordId: 'rec9', visitorId: 'v12', isPrimary: false, priceCharged: 3500, visited: true },
  // rec10: act10 (group, Лепка) — Анна + Маша
  { id: 'vis13', recordId: 'rec10', visitorId: 'v1', isPrimary: false, priceCharged: 3000, visited: true },
  { id: 'vis14', recordId: 'rec10', visitorId: 'v2', isPrimary: false, priceCharged: 2200, visited: true },
  // rec12: act8 (private, Рисование) — Ольга + Петя (isPrimary pays 8200)
  { id: 'vis15', recordId: 'rec12', visitorId: 'v3', isPrimary: true, priceCharged: 8200, visited: true },
  { id: 'vis16', recordId: 'rec12', visitorId: 'v4', isPrimary: false, priceCharged: 2000, visited: true },
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