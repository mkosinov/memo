import { toGalleryPhotoViewModel } from '../to-gallery-vm';
import type { RawPhotoDTO } from '@/app/lib/model/dto/gallery';

describe('toGalleryPhotoViewModel', () => {
  it('converts raw photo to view model', () => {
    const raw: RawPhotoDTO = {
      id: 'photo-1',
      url: 'https://example.com/photo.jpg',
      technique: 'акрил',
    };
    const vm = toGalleryPhotoViewModel(raw);
    expect(vm.id).toBe('photo-1');
    expect(vm.url).toBe('https://example.com/photo.jpg');
    expect(vm.technique).toBe('акрил');
  });
});
