// ─── Artist ───────────────────────────────────────────────────────────────

export interface Artist {
  id: string;
  name: string;
  shortName: string;
  color: string;
}

// ─── Studio ───────────────────────────────────────────────────────────────

export interface Studio {
  id: string;
  name: string;
  address?: string;
  emoji?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  duration: number;
  maxCapacity: number;
  minAge: string;
  defaultAdultPrice: number;
  defaultChildPrice: number;
  defaultIndividualPrice: number;
  description?: string;
}

// ─── Activity ─────────────────────────────────────────────────────────────

export interface Activity {
  id: string;
  day: number;          // 0=ПН ... 6=ВС
  masterId: string;
  startTime: number;    // e.g. 10.5 = 10:30
  duration: number;
  serviceId: string;
  serviceName: string;
  minAge: string;
  locationId: string;
  occupied: number;
  capacity: number;
  isPrivate: boolean;
}

// ─── Stamp State ──────────────────────────────────────────────────────────

export interface StampState {
  masterId: string | null;
  serviceId: string | null;
  locations: Set<string>;
  ready: boolean;
}

// ─── Client (Booking) ─────────────────────────────────────────────────────

export interface Client {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface Visitor {
  id: string;
  clientId: string;
  name: string;
  age?: number;
  isAdult: boolean;
}

export interface BookingRecord {
  id: string;
  activityId: string;
  clientId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
  createdAt: string;
  comment?: string;
}

export interface Visit {
  id: string;
  recordId: string;
  visitorId: string;
  isPrimary: boolean;
  priceCharged: number;
  visited: boolean;
}

export interface Payment {
  id: string;
  recordId: string;
  amount: number;
  paid: boolean;
  method?: 'cash' | 'card' | 'transfer';
  createdAt: string;
}
