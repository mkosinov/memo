export type ActivityCategory = 'взрослым' | 'вместе' | 'детям';

export interface RawActivityDTO {
  id: string;
  title: string;
  category: ActivityCategory;
  image_url: string;
  time: string;
  duration_minutes: number;
  location_id: string;
  location_name: string;
  guests_count: number;
  material: string;
  size: string;
  price_min: number;
  price_max: number;
  teacher_name: string;
  teacher_avatar?: string;
  date: string;
}
