import type { ActivityCategory } from '../dto/activity';

export interface NextTimeOption {
  id: string;
  date: string;
  time: string;
}

export interface ActivityViewModel {
  id: string;
  title: string;
  category: ActivityCategory;
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

export interface ActivityFilters {
  date?: string;
  location?: string;
  category?: string;
}
