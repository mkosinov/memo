import type { LocationDTO } from '@/app/lib/model/dto/location';
import type { LocationView } from '@/app/lib/model/view/location';

export function toLocationView(raw: LocationDTO): LocationView {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address,
    hours: raw.hours,
    photoUrl: raw.photo_url,
  };
}
