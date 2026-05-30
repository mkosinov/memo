const LOCATION_COOKIE_NAME = 'memo_location';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

export function getLocationCookie(): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCATION_COOKIE_NAME}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function setLocationCookie(locationId: string): void {
  document.cookie = `${LOCATION_COOKIE_NAME}=${encodeURIComponent(locationId)}; max-age=${COOKIE_MAX_AGE}; path=/`;
}

export function clearLocationCookie(): void {
  document.cookie = `${LOCATION_COOKIE_NAME}=; max-age=0; path=/`;
}
