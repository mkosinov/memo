import type { LocationResponse } from '@memo/api-client';
import type { LocationDTO } from '@/app/lib/model/dto/location';
import type { LocationView } from '@/app/lib/model/view/location';

export function toLocationView(raw: LocationDTO): LocationView {
  return {
    id: raw.id,
    title: raw.title,
    address: raw.address,
    hours: raw.hours,
    photoUrl: raw.photo_url,
  };
}

/** API row → view (GH #491: the web home filter consumes real locations —
 * the mock list hardcoded pre-UUID seed ids). The API carries no `hours`
 * and nullable address/image; the VM fields are optional. */
export function toLocationViewFromResponse(raw: LocationResponse): LocationView {
  return {
    id: raw.id,
    title: raw.title,
    address: raw.address ?? '',
    hours: undefined,
    photoUrl: raw.image_url ?? undefined,
  };
}
