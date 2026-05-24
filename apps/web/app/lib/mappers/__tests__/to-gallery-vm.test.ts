import { toGalleryPhotoView } from '../to-gallery-vm';
import type { GalleryPhotoDTO } from '@/app/lib/model/dto/gallery';

describe('toGalleryPhotoView', () => {
  it('converts raw photo to view model', () => {
    const raw: GalleryPhotoDTO = {
      id: 'photo-1',
      url: 'https://example.com/photo.jpg',
      technique: 'акрил',
    };
    const vm = toGalleryPhotoView(raw);
    expect(vm.id).toBe('photo-1');
    expect(vm.url).toBe('https://example.com/photo.jpg');
    expect(vm.technique).toBe('акрил');
  });
});
