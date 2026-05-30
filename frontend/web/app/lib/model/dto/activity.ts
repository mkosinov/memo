export type ActivityTag = 'взрослым' | 'вместе' | 'детям';

export interface NextTimeDTO {
  id: string;
  date: string;
  time: string;
}

export interface ActivityDTO {
  id: string;
  title: string;
  category: ActivityTag;
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
  next_times?: NextTimeDTO[];
  price_details?: string;
  material_details?: string;
  location_details?: string;
}
