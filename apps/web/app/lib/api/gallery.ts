import type { RawPhotoDTO } from '@/app/lib/model/dto/gallery';

const MOCK_PHOTOS: RawPhotoDTO[] = [
  {
    id: 'photo-1',
    url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=300&fit=crop',
    technique: 'масло',
  },
  {
    id: 'photo-2',
    url: 'https://images.unsplash.com/photo-1460661419201-3fdcc8e41ce3?w=400&h=300&fit=crop',
    technique: 'акварель',
  },
  {
    id: 'photo-3',
    url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=300&fit=crop',
    technique: 'акрил',
  },
  {
    id: 'photo-4',
    url: 'https://images.unsplash.com/photo-1596548438137-d51ea5c83ca5?w=400&h=300&fit=crop',
    technique: 'дети',
  },
  {
    id: 'photo-5',
    url: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=400&h=300&fit=crop',
    technique: 'акрил',
  },
  {
    id: 'photo-6',
    url: 'https://images.unsplash.com/photo-1513519244980-afbf55b59654?w=400&h=300&fit=crop',
    technique: 'текстиль',
  },
  {
    id: 'photo-7',
    url: 'https://images.unsplash.com/photo-1579783926875-8ea3e83ab71f?w=400&h=300&fit=crop',
    technique: 'масло',
  },
  {
    id: 'photo-8',
    url: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=400&h=300&fit=crop',
    technique: 'лепка',
  },
];

export async function getGallery(limit?: number): Promise<RawPhotoDTO[]> {
  const photos = [...MOCK_PHOTOS];
  if (limit) return photos.slice(0, limit);
  return photos;
}
