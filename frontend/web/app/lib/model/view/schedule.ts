import type { TariffView } from './tariff';

export interface NextTimeOption {
  id: string;
  date: string;
  time: string;
}

export interface ScheduleView {
  id: string;
  /** Service id — passed through so detail overlays can query service-scoped data (e.g. photos, #576). */
  serviceId: string;
  title: string;
  tags: string[];
  imageUrl: string;
  time: string;
  duration: string;
  location: { id: string; title: string; address?: string };
  guestsCount: number;
  material: string;
  size: string;
  priceMin: number;
  priceMax: number;
  /** Service tariffs for the booking overlay (#499); empty/undefined for tariff-free services. */
  tariffs?: TariffView[];
  masterName: string;
  masterAvatar?: string;
  date: string;
  priceFormatted: string;
  dateFormatted: string;
  tagColors: string[];
  nextTimes?: NextTimeOption[];
  priceHint?: string;
  /** Joined per-material display lines (GH #223 §9). Undefined → the materials block is omitted. */
  materialDetails?: string;
  locationHint?: string;
}

export interface ScheduleCardView {
  id: string;
  imageUrl: string;
  tags: string[];
  title: string;
  time: string;
  duration: string;
  guestsCount: number;
  priceMin: number;
  priceMax: number;
}

export interface ScheduleFiltersView {
  /** Filter by exact date (YYYY-MM-DD) */
  date?: string;
  /** Start of date range (YYYY-MM-DD) */
  dateStart?: string;
  /** End of date range (YYYY-MM-DD) */
  dateEnd?: string;
  /** Filter by location ID */
  location?: string;
  /** Filter by tag (age group) */
  tag?: string;
}
