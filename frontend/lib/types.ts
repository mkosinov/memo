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
