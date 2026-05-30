export type ActivityTag = 'взрослым' | 'вместе' | 'детям';

export interface NextTimeOption {
  id: string;
  date: string;
  time: string;
}

export interface ActivityView {
  id: string;
  title: string;
  category: ActivityTag;
  imageUrl: string;
  guestPhotos?: string[];
  time: string;
  duration: string;
  location: { id: string; name: string; address?: string };
  guestsCount: number;
  material: string;
  size: string;
  priceMin: number;
  priceMax: number;
  teacherName: string;
  teacherAvatar?: string;
  teacherDetails?: string;
  date: string;
  priceFormatted: string;
  dateFormatted: string;
  categoryColor: string;
  nextTimes?: NextTimeOption[];
  priceDetails?: string;
  materialDetails?: string;
  locationDetails?: string;
}

export interface ActivityCardView {
  id: string;
  imageUrl: string;
  category: ActivityTag;
  title: string;
  time: string;
  duration: string;
  guestsCount: number;
  priceMin: number;
  priceMax: number;
}

export interface ActivityFiltersView {
  /** Filter by exact date (YYYY-MM-DD) */
  date?: string;
  /** Start of date range (YYYY-MM-DD) */
  dateStart?: string;
  /** End of date range (YYYY-MM-DD) */
  dateEnd?: string;
  /** Filter by location ID */
  location?: string;
  /** Filter by activity tag (возрастная группа) */
  tag?: ActivityTag;
}
