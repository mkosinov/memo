import type { RawLocationDTO } from '@/app/lib/model/dto/location';
import type { LocationViewModel } from '@/app/lib/model/view/location';

export function toLocationViewModel(raw: RawLocationDTO): LocationViewModel {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address,
    hours: raw.hours,
    photoUrl: raw.photo_url,
  };
}
