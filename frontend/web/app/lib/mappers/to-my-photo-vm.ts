import type { MyPhotoItem } from "@memo/api-client";
import type { MyPhotoCardView } from "@/app/lib/model/view/my-photos";
import { toAllowedUrl } from "@/app/lib/mappers/to-gallery-vm";

/** Publication badge labels (#513 spec pins the exact wording). */
export const PHOTO_PUBLIC_LABEL = "Опубликовано";
export const PHOTO_PRIVATE_LABEL = "Не опубликовано";

/** Contract photo (GET /my/photos items[]) → «Мои фото» card view (#513):
 *  url = filename through the SAME allowlist as the guest gallery (the spec
 *  pins the same render mechanism — static file serving; `is_public` is a
 *  display badge here, never a filter). Returns null when the filename fails
 *  the allowlist — the caller drops it. */
export function toMyPhotoCardView(raw: MyPhotoItem): MyPhotoCardView | null {
  const url = toAllowedUrl(raw.filename);
  if (url === null) return null;
  return {
    id: raw.id,
    url,
    isPublic: raw.is_public,
    isPublicLabel: raw.is_public ? PHOTO_PUBLIC_LABEL : PHOTO_PRIVATE_LABEL,
  };
}
