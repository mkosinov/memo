import type { GalleryPhotoDTO } from '@/app/lib/model/dto/gallery';

const MOCK_PHOTOS: GalleryPhotoDTO[] = [
  {
    id: 'photo-1',
    url: '/images/guest-1.jpg',
    technique: 'масло',
  },
  {
    id: 'photo-2',
    url: '/images/guest-2.jpg',
    technique: 'акварель',
  },
  {
    id: 'photo-3',
    url: '/images/guest-3.jpg',
    technique: 'акрил',
  },
  {
    id: 'photo-4',
    url: '/images/guest-4.jpg',
    technique: 'дети',
  },
  {
    id: 'photo-5',
    url: '/images/guest-5.jpg',
    technique: 'акрил',
  },
  {
    id: 'photo-6',
    url: '/images/guest-6.jpg',
    technique: 'текстиль',
  },
  {
    id: 'photo-7',
    url: '/images/guest-7.jpg',
    technique: 'масло',
  },
  {
    id: 'photo-8',
    url: '/images/guest-8.jpg',
    technique: 'лепка',
  },
];

export async function getGallery(limit?: number): Promise<GalleryPhotoDTO[]> {
  const photos = [...MOCK_PHOTOS];
  if (limit) return photos.slice(0, limit);
  return photos;
}
