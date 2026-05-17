---
type: skill
scope: project
sections: [artists, studios, services, activities, booking-data]
updated: 2026-05-13
source: sketches/colour-mountains-v4.html, memo-v1/memo-frontend/lib/mock-data.ts
---

# Mock Data — Memo Test Data Patterns

Форматы и данные для разработки и тестирования. Все значения эквивалентны тому что в `colour-mountains-v4.html` и `memo-v1/memo-frontend/lib/mock-data.ts`.

## 1. Artists (Мастера)

```typescript
export const ARTISTS: Artist[] = [
  { id: 'm1', name: 'Ольга Середа',      shortName: 'Ольга',     color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова',    shortName: 'Юлия',     color: '#6B7E9C' },
  { id: 'm3', name: 'Анастасия П.',       shortName: 'Анастасия', color: '#A07060' },
  { id: 'm4', name: 'Дарья Тюльпина',     shortName: 'Дарья',     color: '#7A6E9C' },
  { id: 'm5', name: 'Александра В.',      shortName: 'Александра', color: '#8A7840' },
  { id: 'm7', name: 'Ирина Горох',        shortName: 'Ирина',     color: '#9A5870' },
];
```

## 2. Studios (Студии/Локации)

```typescript
export interface Studio {
  id: string;
  name: string;
  address?: string;
  emoji?: string;
}

export const STUDIOS: Studio[] = [
  { id: 'alpika',  name: 'Альпика',             address: 'Альпика, 1 этаж' },
  { id: 'grand',   name: 'Гранд Отель Поляна',  address: 'Гранд Отель, лобби' },
  { id: 'p1389',   name: 'Поляна 1389',         address: 'Поляна 1389, 2 этаж' },
];

export const STUDIO_MAP: Record<string, string> = {
  alpika: 'Альпика',
  grand: 'Гранд Отель Поляна',
  p1389: 'Поляна 1389',
};
```

## 3. Services (Услуги)

```typescript
export interface Service {
  id: string;
  name: string;
  duration: number;        // hours
  maxCapacity: number;
  minAge: string;          // "5+", "6-12", "12+", etc.
  defaultAdultPrice: number;
  defaultChildPrice: number;
  defaultIndividualPrice: number;
  description?: string;
}

export const SERVICES: Service[] = [
  { id: 's1', name: 'Картина маслом',         duration: 2.5, maxCapacity: 8,  minAge: '12+', defaultAdultPrice: 3500, defaultChildPrice: 2500, defaultIndividualPrice: 5000 },
  { id: 's2', name: 'Картина акрилом',        duration: 2,   maxCapacity: 10, minAge: '6+',  defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
  { id: 's3', name: 'Мини-картина акрилом',   duration: 1.5, maxCapacity: 8,  minAge: '6+',  defaultAdultPrice: 2000, defaultChildPrice: 1500, defaultIndividualPrice: 3000 },
  { id: 's4', name: 'Акварель',               duration: 2.5, maxCapacity: 6,  minAge: '6-12', defaultAdultPrice: 2800, defaultChildPrice: 2000, defaultIndividualPrice: 4000 },
  { id: 's5', name: 'Ручная лепка',           duration: 1.5, maxCapacity: 6,  minAge: '5+',  defaultAdultPrice: 2200, defaultChildPrice: 1800, defaultIndividualPrice: 3500 },
  { id: 's6', name: 'Роспись одежды',         duration: 2,   maxCapacity: 10, minAge: '8+',  defaultAdultPrice: 3200, defaultChildPrice: 2500, defaultIndividualPrice: 4500 },
  { id: 's7', name: 'Морской пейзаж',         duration: 3,   maxCapacity: 8,  minAge: '12+', defaultAdultPrice: 3800, defaultChildPrice: 2800, defaultIndividualPrice: 5500 },
];
```

## 4. Activities (События расписания)

### Формат

```typescript
export interface RawActivity {
  day: number;            // 0=ПН ... 6=ВС
  master: string;         // artist id
  start: number;          // start hour, e.g. 10.5 = 10:30
  dur: number;            // duration in hours
  service: string;        // service name (or id)
  age: string;
  loc: string;            // location id
  occ: number;            // occupied/registered
  cap: number;            // capacity
  priv: boolean;          // is private
}
```

### Пример данных для недели (28 событий)

```typescript
export function generateWeekEvents(weekStart: Date): Activity[] {
  return [
    // ПН (day 0)
    { day:0, master:'m1', start:10, dur:3,   service:'Морской пейзаж',       age:'6-12',  loc:'grand',  occ:3, cap:8,  priv:false },
    { day:0, master:'m2', start:12, dur:1.5, service:'Ручная лепка',         age:'5+',    loc:'alpika', occ:4, cap:6,  priv:false },
    { day:0, master:'m4', start:14, dur:2,   service:'Индивидуальный МК',    age:'12+',   loc:'grand',  occ:1, cap:1,  priv:true  },
    { day:0, master:'m3', start:16, dur:2,   service:'Картина акрилом',      age:'6+',    loc:'p1389',  occ:5, cap:10, priv:false },
    // ВТ (day 1)
    { day:1, master:'m3', start:11, dur:2,   service:'Картина акрилом',      age:'6+',    loc:'alpika', occ:7, cap:10, priv:false },
    { day:1, master:'m1', start:15, dur:1.5, service:'Мини-картина акрилом',  age:'6+',    loc:'grand',  occ:3, cap:8,  priv:false },
    { day:1, master:'m5', start:17, dur:2.5, service:'Картина маслом',       age:'12+',   loc:'p1389',  occ:5, cap:8,  priv:false },
    // СР (day 2)
    { day:2, master:'m2', start:10.5,dur:2,  service:'Роспись одежды',       age:'8+',    loc:'alpika', occ:9, cap:10, priv:false },
    { day:2, master:'m7', start:13, dur:1.5, service:'Мини-картина',          age:'6+',    loc:'grand',  occ:2, cap:8,  priv:false },
    { day:2, master:'m4', start:16, dur:2.5, service:'Акварель',             age:'6-12',  loc:'p1389',  occ:4, cap:6,  priv:false },
    // ЧТ (day 3)
    { day:3, master:'m1', start:11, dur:3,   service:'Морской пейзаж',       age:'12+',   loc:'grand',  occ:6, cap:8,  priv:false },
    { day:3, master:'m3', start:14.5,dur:2,  service:'Картина акрилом',      age:'6+',    loc:'alpika', occ:4, cap:10, priv:false },
    { day:3, master:'m5', start:18, dur:1.5, service:'Индивидуальный урок',  age:'12+',   loc:'p1389',  occ:1, cap:1,  priv:true  },
    // ПТ (day 4)
    { day:4, master:'m2', start:10, dur:2.5, service:'Ручная лепка',         age:'5+',    loc:'alpika', occ:5, cap:6,  priv:false },
    { day:4, master:'m7', start:12, dur:2,   service:'Картина акрилом',      age:'6+',    loc:'grand',  occ:8, cap:10, priv:false },
    { day:4, master:'m1', start:15, dur:2.5, service:'Картина маслом',       age:'12+',   loc:'grand',  occ:7, cap:8,  priv:false },
    { day:4, master:'m4', start:18, dur:1.5, service:'Мини-картина',          age:'6+',    loc:'p1389',  occ:6, cap:8,  priv:false },
    // СБ (day 5)
    { day:5, master:'m1', start:10, dur:3,   service:'Морской пейзаж',       age:'12+',   loc:'grand',  occ:8, cap:8,  priv:false },
    { day:5, master:'m2', start:10, dur:1.5, service:'Мини-картина',          age:'6+',    loc:'alpika', occ:7, cap:8,  priv:false },
    { day:5, master:'m3', start:12, dur:2,   service:'Картина акрилом',      age:'6+',    loc:'alpika', occ:9, cap:10, priv:false },
    { day:5, master:'m5', start:13, dur:2.5, service:'Картина маслом',       age:'12+',   loc:'p1389',  occ:6, cap:8,  priv:false },
    { day:5, master:'m7', start:15.5,dur:1.5,service:'Мини-картина',          age:'6+',    loc:'grand',  occ:4, cap:8,  priv:false },
    { day:5, master:'m4', start:16, dur:2.5, service:'Акварель',             age:'6-12',  loc:'p1389',  occ:5, cap:6,  priv:false },
    { day:5, master:'m3', start:14.5,dur:1.5,service:'Индив. керамика',      age:'12+',   loc:'alpika', occ:1, cap:1,  priv:true  },
    // ВС (day 6)
    { day:6, master:'m1', start:11, dur:2.5, service:'Картина маслом',       age:'12+',   loc:'grand',  occ:5, cap:8,  priv:false },
    { day:6, master:'m2', start:11, dur:1.5, service:'Ручная лепка',         age:'5+',    loc:'alpika', occ:3, cap:6,  priv:false },
    { day:6, master:'m7', start:14, dur:2,   service:'Картина акрилом',      age:'6+',    loc:'grand',  occ:6, cap:10, priv:false },
    { day:6, master:'m5', start:16.5,dur:2,  service:'Роспись одежды',       age:'8+',    loc:'p1389',  occ:4, cap:8,  priv:false },
  ].map((e, i) => ({
    ...e,
    id: `ev_${i}`,
    // Convert to Activity interface here
  }));
}
```

## 5. Booking Data (P2, P3)

```typescript
export const CLIENTS: Client[] = [
  { id: 'c1', name: 'Анна Иванова',       phone: '+7 (900) 123-45-67', email: 'anna@example.com' },
  { id: 'c2', name: 'Мария Петрова',      phone: '+7 (900) 234-56-78' },
  { id: 'c3', name: 'Елена Сидорова',     phone: '+7 (900) 345-67-89' },
  // ... 8 clients total
];

export const RECORDS: BookingRecord[] = [
  { id: 'r1', activityId: 'ev_0', clientId: 'c1', status: 'CONFIRMED', createdAt: '2026-05-10T10:00:00' },
  // ... 12 records
];

export const VISITS: Visit[] = [
  { id: 'v1', recordId: 'r1', visitorId: 'vis1', isPrimary: true, priceCharged: 3500, visited: true },
  // ... 20+ visits
];

export const PAYMENTS: Payment[] = [
  { id: 'p1', recordId: 'r1', amount: 3500, method: 'card', paid: true },
  // ... 10 payments
];
```

## 6. Helper Functions

```typescript
// Calculate fill opacity for event card background
export function getFillOpacity(occupied: number, capacity: number): number {
  const pct = Math.min(occupied / capacity, 1);
  return 0.12 + pct * 0.28;  // 0.12 (empty) → 0.40 (full)
}

// Get Monday of current week
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

// Date formatting
export function formatDate(date: Date): string {
  const months = ['января','февраля','марта','апреля','мая','июня',
                  'июля','августа','сентября','октября','ноября','декабря'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

// Time formatting
export function formatTime(hours: number): string {
  const h = Math.floor(hours);
  const m = hours % 1 === 0.5 ? '30' : '00';
  return `${h}:${m}`;
}

// Days of week
export const DAYS = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];
export const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                       'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
```
