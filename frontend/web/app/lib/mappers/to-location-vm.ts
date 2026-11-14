import type { LocationPublicResponse } from '@memo/api-client';
import type { LocationView } from '@/app/lib/model/view/location';

/** Public dictionary row → view (GH #479/#601): the anonymous contract
 * carries only id/title/address/location_hint — the mock-era
 * `hours`/`photoUrl` fields are gone with the homemade DTO, the staff
 * fields never left the server. */
export function toLocationViewFromResponse(raw: LocationPublicResponse): LocationView {
  return {
    id: raw.id,
    title: raw.title,
    address: raw.address ?? '',
  };
}
