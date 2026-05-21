export type ActivityCategory = 'взрослым' | 'вместе' | 'детям';

export interface RawNextTimeDTO {
  id: string;
  date: string;
  time: string;
}

export interface RawActivityDTO {
  id: string;
  title: string;
  category: ActivityCategory;
  image_url: string;
  guest_photos?: string[];
  time: string;
  duration_minutes: number;
  location_id: string;
  location_name: string;
  location_address?: string;
  guests_count: number;
  material: string;
  size: string;
  price_min: number;
  price_max: number;
  teacher_name: string;
  teacher_avatar?: string;
  date: string;
  next_times?: RawNextTimeDTO[];
  price_details?: string;
  material_details?: string;
  location_details?: string;
}
