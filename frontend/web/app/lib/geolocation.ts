export interface GeoPosition {
  latitude: number;
  longitude: number;
}

/**
 * Returns the user's current geolocation.
 * Currently returns null as a stub — will be implemented with
 * navigator.geolocation in a future iteration.
 */
export function getCurrentPosition(): Promise<GeoPosition | null> {
  return Promise.resolve(null);
}
