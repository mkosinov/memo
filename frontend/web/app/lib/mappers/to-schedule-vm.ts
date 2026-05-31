import type { ScheduleDTO } from '@/app/lib/model/dto/schedule';
import type { ScheduleView, ScheduleCardView } from '@/app/lib/model/view/schedule';
import { formatPrice, formatDate, formatDuration } from '@/app/lib/mappers/format';

const TAG_COLORS: Record<string, string> = {
  'новинка': '#C49A2E',
  'хит': '#D4789A',
  'для детей': '#5B8C7A',
  'популярное': '#7A6E9C',
  'индивидуальное': '#8A7840',
  'сезонное': '#6B7E9C',
};

function getTagColors(tags: string[]): string[] {
  return tags.map(t => TAG_COLORS[t] || '#888888');
}

export function toScheduleView(raw: ScheduleDTO): ScheduleView {
  return {
    id: raw.id,
    title: raw.title,
    tags: raw.tags,
    imageUrl: raw.image_url,
    photos: raw.photos,
    time: raw.time,
    duration: formatDuration(raw.duration_minutes),
    location: {
      id: raw.location_id,
      name: raw.location_name,
      address: raw.location_address,
    },
    guestsCount: raw.guests_count,
    material: raw.material || '',
    size: raw.size || '',
    priceMin: raw.price_min,
    priceMax: raw.price_max,
    masterName: raw.master_name,
    masterAvatar: raw.master_avatar,
    date: raw.date,
    priceFormatted: formatPrice(raw.price_min, raw.price_max),
    dateFormatted: formatDate(raw.date),
    tagColors: getTagColors(raw.tags),
    nextTimes: raw.next_times,
    priceHint: raw.price_hint,
    materialHint: raw.material_hint,
    locationHint: raw.location_hint,
  };
}

export function toCardProps(vm: ScheduleView): ScheduleCardView {
  return {
    id: vm.id,
    imageUrl: vm.imageUrl,
    tags: vm.tags,
    title: vm.title,
    time: vm.time,
    duration: vm.duration,
    guestsCount: vm.guestsCount,
    priceMin: vm.priceMin,
    priceMax: vm.priceMax,
  };
}
