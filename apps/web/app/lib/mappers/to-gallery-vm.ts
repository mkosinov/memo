import type { GalleryPhotoDTO } from '@/app/lib/model/dto/gallery';
import type { GalleryPhotoView } from '@/app/lib/model/view/gallery';

export function toGalleryPhotoView(raw: GalleryPhotoDTO): GalleryPhotoView {
  return {
    id: raw.id,
    url: raw.url,
    technique: raw.technique,
  };
}
