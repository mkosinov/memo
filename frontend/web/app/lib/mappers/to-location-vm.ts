import type { LocationResponse } from '@memo/api-client';
import type { LocationView } from '@/app/lib/model/view/location';

/** API row → view (GH #479): the contract carries only id/title/address —
 * the mock-era `hours`/`photoUrl` fields are gone with the homemade DTO. */
export function toLocationViewFromResponse(raw: LocationResponse): LocationView {
  return {
    id: raw.id,
    title: raw.title,
    address: raw.address ?? '',
  };
}
