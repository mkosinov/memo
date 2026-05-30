import type { ActivityDTO } from '@/app/lib/model/dto/activity';
import type { ActivityView } from '@/app/lib/model/view/activity';
import { formatPrice, formatDate, formatDuration } from '@/app/lib/mappers/format';

const CATEGORY_COLORS: Record<string, string> = {
  'взрослым': '#C49A2E',
  'вместе': '#5B8C7A',
  'детям': '#D4789A',
};

export function toActivityView(raw: ActivityDTO): ActivityView {
  return {
    id: raw.id,
    title: raw.title,
    category: raw.category,
    imageUrl: raw.image_url,
    guestPhotos: raw.guest_photos,
    time: raw.time,
    duration: formatDuration(raw.duration_minutes),
    location: { id: raw.location_id, name: raw.location_name, address: raw.location_address },
    guestsCount: raw.guests_count,
    material: raw.material,
    size: raw.size,
    priceMin: raw.price_min,
    priceMax: raw.price_max,
    teacherName: raw.teacher_name,
    teacherAvatar: raw.teacher_avatar,
    date: raw.date,
    priceFormatted: formatPrice(raw.price_min, raw.price_max),
    dateFormatted: formatDate(raw.date),
    categoryColor: CATEGORY_COLORS[raw.category] || '#888888',
    nextTimes: raw.next_times,
    priceDetails: raw.price_details,
    materialDetails: raw.material_details,
    locationDetails: raw.location_details,
  };
}
