import { toLocationViewFromResponse } from '../to-location-vm';
import type { LocationPublicResponse } from '@memo/api-client';

// GH #601: the mapper's input is the PUBLIC dictionary row — exactly 4
// fields (id/title/address/location_hint); the web reads nothing else.
describe('toLocationViewFromResponse', () => {
  it('maps the public dictionary row to the filter-option contract', () => {
    const raw: LocationPublicResponse = {
      id: 'u1',
      title: 'Альпика',
      address: 'Альпика, 1 этаж',
      location_hint: '1 этаж, светлая студия с панорамными окнами',
    };

    const vm = toLocationViewFromResponse(raw);

    expect(vm).toStrictEqual({
      id: 'u1',
      title: 'Альпика',
      address: 'Альпика, 1 этаж',
    });
  });

  it('normalizes a nullable address to an empty string', () => {
    const raw: LocationPublicResponse = {
      id: 'u2',
      title: 'Поляна 1389',
      address: null,
      location_hint: null,
    };

    const vm = toLocationViewFromResponse(raw);

    expect(vm).toStrictEqual({ id: 'u2', title: 'Поляна 1389', address: '' });
  });

  it('carries no mock-era fields (hours/photoUrl)', () => {
    const raw: LocationPublicResponse = {
      id: 'u3',
      title: 'Гранд Отель Поляна',
      address: 'лобби',
      location_hint: null,
    };

    const vm = toLocationViewFromResponse(raw);

    expect(vm).not.toHaveProperty('hours');
    expect(vm).not.toHaveProperty('photoUrl');
  });
});
