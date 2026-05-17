export interface Artist {
  id: string;
  name: string;
  color: string;
  role: string;
}

export interface Location {
  id: string;
  name: string;
  defaultCapacity: number;
}

export interface Service {
  id: string;
  name: string;
  adultPrice: number;
  childPrice: number;
  individualPrice: number;
  maxCapacity: number;
  durationMinutes: number;
}

export interface Activity {
  id: string;
  isPublic: boolean;
  serviceId: string;
  locationId: string;
  artistId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  capacity: number;
  priceAdult: number;
  priceChild: number;
  priceIndividual: number;
  hasRecords: boolean;
  comment?: string;
  clientName?: string; // Only for private activities
}

export type ViewMode = 'week' | 'month' | 'day' | 'list';

export type FormatPainterMode = 'inactive' | 'selectSource' | 'selectTarget' | 'delete';

export interface FormatPainterState {
  mode: FormatPainterMode;
  sourceId: string | null;
}

export interface Filters {
  locationId: string;
  serviceId: string;
  artistId: string;
  weekStart: string; // YYYY-MM-DD (Monday)
}

export interface Conflict {
  activityId1: string;
  activityId2: string;
  artistId: string;
  message: string;
}

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