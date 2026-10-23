import type { PhotoResponse } from '@memo/api-client';
import type { GalleryPhotoView } from '@/app/lib/model/view/gallery';

/** URL allowlist (GH #479): same-origin paths (absolute or relative) and full
 * http(s) URLs render; everything else — foreign schemes (javascript:, data:),
 * protocol-relative foreign hosts, empty strings — is dropped from the gallery.
 * Exported for the «Мои фото» mapper (#513): the cabinet grid renders by the
 * SAME mechanism, so it shares one allowlist — no per-screen drift. */
export function toAllowedUrl(filename: string): string | null {
  if (/^https?:\/\//i.test(filename)) return filename;
  if (filename.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(filename)) return null;
  return filename.length > 0 ? filename : null;
}

/** Contract photo → gallery view (GH #479): url = filename (allowlisted),
 * caption = tag titles joined with " · " ('' when no tags).
 * Returns null when the filename fails the allowlist — the caller drops it. */
export function toGalleryPhotoView(raw: PhotoResponse): GalleryPhotoView | null {
  const url = toAllowedUrl(raw.filename);
  if (url === null) return null;
  return {
    id: raw.id,
    url,
    caption: raw.tags.map((tag) => tag.title).join(' · '),
  };
}
