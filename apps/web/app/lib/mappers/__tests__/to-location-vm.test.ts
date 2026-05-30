import { toLocationView } from '../to-location-vm';
import type { LocationDTO } from '@/app/lib/model/dto/location';

describe('toLocationView', () => {
  it('converts snake_case to camelCase', () => {
    const raw: LocationDTO = {
      id: 'alpika',
      name: 'Альпика',
      address: 'Альпика, 1 этаж',
      hours: '10:00–21:00',
      photo_url: 'https://example.com/photo.jpg',
    };
    const vm = toLocationView(raw);
    expect(vm.id).toBe('alpika');
    expect(vm.name).toBe('Альпика');
    expect(vm.address).toBe('Альпика, 1 этаж');
    expect(vm.hours).toBe('10:00–21:00');
    expect(vm.photoUrl).toBe('https://example.com/photo.jpg');
  });

  it('handles optional fields', () => {
    const raw: LocationDTO = {
      id: 'grand',
      name: 'Гранд Отель',
      address: 'Гранд Отель, лобби',
    };
    const vm = toLocationView(raw);
    expect(vm.hours).toBeUndefined();
    expect(vm.photoUrl).toBeUndefined();
  });
});
