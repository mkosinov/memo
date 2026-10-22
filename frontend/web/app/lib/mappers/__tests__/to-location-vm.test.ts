import { toLocationViewFromResponse } from '../to-location-vm';
import type { LocationResponse } from '@memo/api-client';

// GH #479: LocationView is narrowed to the api-client contract —
// id/title/address only; the mock-specific hours/photoUrl fields are gone.
describe('toLocationViewFromResponse', () => {
  it('maps LocationResponse to the filter-option contract', () => {
    const raw: LocationResponse = {
      id: 'u1',
      title: 'Альпика',
      address: 'Альпика, 1 этаж',
    } as LocationResponse;

    const vm = toLocationViewFromResponse(raw);

    expect(vm).toStrictEqual({
      id: 'u1',
      title: 'Альпика',
      address: 'Альпика, 1 этаж',
    });
  });

  it('normalizes a nullable address to an empty string', () => {
    const raw = { id: 'u2', title: 'Поляна 1389', address: null } as LocationResponse;

    const vm = toLocationViewFromResponse(raw);

    expect(vm).toStrictEqual({ id: 'u2', title: 'Поляна 1389', address: '' });
  });

  it('carries no mock-era fields (hours/photoUrl)', () => {
    const raw = {
      id: 'u3',
      title: 'Гранд Отель Поляна',
      address: 'лобби',
      image_url: '/images/grand.jpg',
    } as LocationResponse;

    const vm = toLocationViewFromResponse(raw);

    expect(vm).not.toHaveProperty('hours');
    expect(vm).not.toHaveProperty('photoUrl');
  });
});
