import { toScheduleView, toCardProps } from '../to-schedule-vm';
import type { WebScheduleDTO } from '@/app/lib/mappers/buildSchedule';
import type { ScheduleView, ScheduleCardView } from '@/app/lib/model/view/schedule';

function makeRawSchedule(overrides?: Partial<WebScheduleDTO>): WebScheduleDTO {
  return {
    id: 'sched-1',
    masterId: 'master-1',
    serviceId: 'service-1',
    locationId: 'alpika',
    masterName: 'Ольга Середа',
    serviceTitle: 'Морской пейзаж',
    date: '2026-05-20',
    time: '14:00',
    durationMinutes: 150,
    occupied: 3,
    capacity: 10,
    locationName: 'Альпика',
    locationAddress: 'Альпика, 1 этаж',
    locationHint: undefined,
    materialHint: undefined,
    priceMin: 3500,
    priceMax: 5500,
    priceHint: undefined,
    image_url: 'https://example.com/image.jpg',
    tags: ['хит', 'для детей'],
    masterAvatar: 'https://example.com/avatar.jpg',
    // Web-only fields
    photos: [
      { url: 'https://example.com/photo1.jpg', isPublic: true, tags: ['интерьер'] },
    ],
    material: 'Масло',
    size: '30x40 см',
    ...overrides,
  };
}

describe('toScheduleView', () => {
  it('converts DTO fields to camelCase ViewModel', () => {
    const raw = makeRawSchedule();
    const vm = toScheduleView(raw);

    expect(vm.id).toBe('sched-1');
    expect(vm.title).toBe('Морской пейзаж');
    expect(vm.imageUrl).toBe('https://example.com/image.jpg');
    expect(vm.masterName).toBe('Ольга Середа');
    expect(vm.masterAvatar).toBe('https://example.com/avatar.jpg');
    expect(vm.guestsCount).toBe(3);
  });

  it('formats price range', () => {
    const vm = toScheduleView(makeRawSchedule());
    expect(vm.priceFormatted).toBe('3 500 – 5 500 ₽');
  });

  it('formats single price when min equals max', () => {
    const vm = toScheduleView(makeRawSchedule({ priceMin: 3500, priceMax: 3500 }));
    expect(vm.priceFormatted).toBe('3 500 ₽');
  });

  it('formats duration from minutes', () => {
    const vm = toScheduleView(makeRawSchedule({ durationMinutes: 150 }));
    expect(vm.duration).toBe('2 ч 30 мин');
  });

  it('formats date', () => {
    const vm = toScheduleView(makeRawSchedule({ date: '2026-05-20' }));
    expect(vm.dateFormatted).toBe('20 мая');
  });

  it('nests location object', () => {
    const vm = toScheduleView(makeRawSchedule());
    expect(vm.location).toEqual({
      id: 'alpika',
      name: 'Альпика',
      address: 'Альпика, 1 этаж',
    });
  });

  it('assigns correct tag colors for known tags', () => {
    const vm = toScheduleView(makeRawSchedule({ tags: ['хит', 'для детей', 'новинка'] }));
    expect(vm.tagColors).toEqual(['#D4789A', '#5B8C7A', '#C49A2E']);
  });

  it('assigns default gray for unknown tags', () => {
    const vm = toScheduleView(makeRawSchedule({ tags: ['unknown-tag'] }));
    expect(vm.tagColors).toEqual(['#888888']);
  });

  it('handles empty tags', () => {
    const vm = toScheduleView(makeRawSchedule({ tags: [] }));
    expect(vm.tagColors).toEqual([]);
  });

  it('maps photos array', () => {
    const photos = [
      { url: 'https://example.com/p1.jpg', isPublic: true, tags: ['интерьер'] },
      { url: 'https://example.com/p2.jpg', isPublic: false, tags: [] },
    ];
    const vm = toScheduleView(makeRawSchedule({ photos }));
    expect(vm.photos).toEqual(photos);
  });

  it('handles optional price hint', () => {
    const vmWith = toScheduleView(makeRawSchedule({ priceHint: 'Взрослый: 3500₽, Детский: 2500₽' }));
    expect(vmWith.priceHint).toBe('Взрослый: 3500₽, Детский: 2500₽');

    const vmWithout = toScheduleView(makeRawSchedule());
    expect(vmWithout.priceHint).toBeUndefined();
  });

  it('handles optional material hint', () => {
    const vmWith = toScheduleView(makeRawSchedule({ materialHint: 'Все материалы включены' }));
    expect(vmWith.materialHint).toBe('Все материалы включены');

    const vmWithout = toScheduleView(makeRawSchedule());
    expect(vmWithout.materialHint).toBeUndefined();
  });

  it('handles optional location hint', () => {
    const vmWith = toScheduleView(makeRawSchedule({ locationHint: '5 минут от входа' }));
    expect(vmWith.locationHint).toBe('5 минут от входа');

    const vmWithout = toScheduleView(makeRawSchedule());
    expect(vmWithout.locationHint).toBeUndefined();
  });

  it('maps next_times array', () => {
    const nextTimes = [
      { id: 'sched-2', date: '2026-05-22', time: '14:00' },
      { id: 'sched-3', date: '2026-05-25', time: '11:00' },
    ];
    const vm = toScheduleView(makeRawSchedule());
    (vm as unknown as Record<string, unknown>).nextTimes = nextTimes;
    expect(vm.nextTimes).toEqual(nextTimes);
  });

  it('handles empty next_times', () => {
    const vm = toScheduleView(makeRawSchedule());
    (vm as unknown as Record<string, unknown>).nextTimes = [];
    expect(vm.nextTimes).toEqual([]);
  });

  it('handles optional master avatar', () => {
    const vmWith = toScheduleView(makeRawSchedule({ masterAvatar: 'https://example.com/av.jpg' }));
    expect(vmWith.masterAvatar).toBe('https://example.com/av.jpg');

    const vmWithout = toScheduleView(makeRawSchedule({ masterAvatar: undefined }));
    expect(vmWithout.masterAvatar).toBeUndefined();
  });

  it('handles optional location address', () => {
    const vmWith = toScheduleView(makeRawSchedule({ locationAddress: 'ул. Тестовая, 1' }));
    expect(vmWith.location.address).toBe('ул. Тестовая, 1');

    const vmWithout = toScheduleView(makeRawSchedule({ locationAddress: undefined }));
    expect(vmWithout.location.address).toBeUndefined();
  });

  it('maps material and size fields', () => {
    const vm = toScheduleView(makeRawSchedule({ material: 'Акрил', size: '40x50 см' }));
    expect(vm.material).toBe('Акрил');
    expect(vm.size).toBe('40x50 см');
  });
});

describe('toCardProps', () => {
  it('extracts card subset from ScheduleView', () => {
    const vm: ScheduleView = {
      id: 'sched-1',
      title: 'Морской пейзаж',
      tags: ['хит'],
      imageUrl: 'https://example.com/image.jpg',
      photos: [],
      time: '14:00',
      duration: '2 ч 30 мин',
      location: { id: 'alpika', name: 'Альпика' },
      guestsCount: 3,
      material: 'Масло',
      size: '30x40 см',
      priceMin: 3500,
      priceMax: 5500,
      masterName: 'Ольга Середа',
      date: '2026-05-20',
      priceFormatted: '3 500 – 5 500 ₽',
      dateFormatted: '20 мая',
      tagColors: ['#D4789A'],
    };

    const card = toCardProps(vm);

    expect(card).toEqual<ScheduleCardView>({
      id: 'sched-1',
      imageUrl: 'https://example.com/image.jpg',
      tags: ['хит'],
      title: 'Морской пейзаж',
      time: '14:00',
      duration: '2 ч 30 мин',
      guestsCount: 3,
      priceMin: 3500,
      priceMax: 5500,
    });
  });
});
