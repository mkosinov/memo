import type { PhotoPublicResponse } from '@memo/api-client';
import type { GalleryPhotoView } from '@/app/lib/model/view/gallery';

/** URL allowlist (GH #479, #517): the value is normalized BEFORE the checks —
 * outer whitespace trimmed, control chars removed — then same-origin paths
 * (absolute or relative) and full http(s) URLs render; everything else —
 * foreign schemes (javascript:, data:), protocol-relative foreign hosts,
 * empty strings — is dropped from the gallery. Normalize-first also catches
 * glued forms: "ja<ctrl>vascript:" collapses into a scheme the check rejects.
 * Exported for the «Мои фото» mapper (#513): the cabinet grid renders by the
 * SAME mechanism, so it shares one allowlist — no per-screen drift.
 * The gallery mapper below is typed by the public schema #493
 * (PhotoPublicResponse) — tags are plain title strings. */
export function toAllowedUrl(filename: string): string | null {
  const candidate = filename.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return null;
  return candidate.length > 0 ? candidate : null;
}

/** Contract photo → gallery view (GH #479, #493): url = filename (allowlisted),
 * caption = tag strings joined with " · " ('' when no tags).
 * Typed by the #493 public schema (PhotoPublicResponse, ADR-015): tags
 * arrive as plain title strings (server resolves), never tag objects.
 * Returns null when the filename fails the allowlist — the caller drops it. */
export function toGalleryPhotoView(raw: PhotoPublicResponse): GalleryPhotoView | null {
  const url = toAllowedUrl(raw.filename);
  if (url === null) return null;
  return {
    id: raw.id,
    url,
    caption: raw.tags.join(' · '),
  };
}
