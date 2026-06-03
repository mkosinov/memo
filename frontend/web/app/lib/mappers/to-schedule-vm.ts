import type { WebScheduleDTO } from '@/app/lib/mappers/join-schedule';
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

export function toScheduleView(raw: WebScheduleDTO): ScheduleView {
  return {
    id: raw.id,
    title: raw.serviceTitle,
    tags: raw.tags ?? [],
    imageUrl: raw.image_url ?? '',
    photos: raw.photos,
    time: raw.time,
    duration: formatDuration(raw.durationMinutes),
    location: {
      id: raw.locationId,
      name: raw.locationName,
      address: raw.locationAddress,
    },
    guestsCount: raw.occupied,
    material: raw.material || '',
    size: raw.size || '',
    priceMin: raw.priceMin,
    priceMax: raw.priceMax,
    masterName: raw.masterName,
    masterAvatar: raw.masterAvatar,
    date: raw.date,
    priceFormatted: formatPrice(raw.priceMin, raw.priceMax),
    dateFormatted: formatDate(raw.date),
    tagColors: getTagColors(raw.tags ?? []),
    nextTimes: (raw as unknown as Record<string, unknown>).nextTimes as { id: string; date: string; time: string }[] | undefined,
    priceHint: raw.priceHint,
    materialHint: raw.materialHint,
    locationHint: raw.locationHint,
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
