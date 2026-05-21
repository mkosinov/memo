import type { ActivityCategory } from '../dto/activity';

export interface ActivityViewModel {
  id: string;
  title: string;
  category: ActivityCategory;
  imageUrl: string;
  time: string;
  duration: string;
  location: { id: string; name: string };
  guestsCount: number;
  material: string;
  size: string;
  priceMin: number;
  priceMax: number;
  teacherName: string;
  teacherAvatar?: string;
  date: string;
  priceFormatted: string;
  dateFormatted: string;
  categoryColor: string;
}

export interface ActivityFilters {
  date?: string;
  location?: string;
  category?: string;
}
