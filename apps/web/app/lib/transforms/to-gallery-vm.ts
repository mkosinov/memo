import type { RawPhotoDTO } from '@/app/lib/model/dto/gallery';
import type { GalleryPhotoViewModel } from '@/app/lib/model/view/gallery';

export function toGalleryPhotoViewModel(raw: RawPhotoDTO): GalleryPhotoViewModel {
  return {
    id: raw.id,
    url: raw.url,
    technique: raw.technique,
  };
}
