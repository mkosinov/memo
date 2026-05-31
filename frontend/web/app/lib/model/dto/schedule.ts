export interface PhotoDTO {
  url: string;
  isPublic: boolean;
  tags: string[];
}

export interface NextTimeDTO {
  id: string;
  date: string;
  time: string;
}

export interface ScheduleDTO {
  id: string;
  title: string;
  tags: string[];
  image_url: string;
  photos: PhotoDTO[];
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
  master_name: string;
  master_avatar?: string;
  date: string;
  next_times?: NextTimeDTO[];
  price_hint?: string;
  material_hint?: string;
  location_hint?: string;
}
