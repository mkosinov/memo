import { toActivityViewModel } from '../to-activity-vm';
import type { RawActivityDTO } from '@/app/lib/model/dto/activity';

function makeRawActivity(overrides?: Partial<RawActivityDTO>): RawActivityDTO {
  return {
    id: 'act-1',
    title: 'Морской пейзаж',
    category: 'взрослым',
    image_url: 'https://example.com/image.jpg',
    time: '14:00',
    duration_minutes: 150,
    location_id: 'alpika',
    location_name: 'Альпика',
    guests_count: 3,
    material: 'Масло',
    size: '30x40 см',
    price_min: 3500,
    price_max: 5500,
    teacher_name: 'Ольга Середа',
    date: '2026-05-20',
    ...overrides,
  };
}

describe('toActivityViewModel', () => {
  it('converts snake_case to camelCase', () => {
    const raw = makeRawActivity();
    const vm = toActivityViewModel(raw);
    expect(vm.id).toBe('act-1');
    expect(vm.title).toBe('Морской пейзаж');
    expect(vm.imageUrl).toBe('https://example.com/image.jpg');
    expect(vm.teacherName).toBe('Ольга Середа');
  });

  it('formats price range', () => {
    const vm = toActivityViewModel(makeRawActivity());
    expect(vm.priceFormatted).toBe('3 500 – 5 500 ₽');
  });

  it('formats single price when min equals max', () => {
    const vm = toActivityViewModel(makeRawActivity({ price_min: 3500, price_max: 3500 }));
    expect(vm.priceFormatted).toBe('3 500 ₽');
  });

  it('formats duration from minutes', () => {
    const vm = toActivityViewModel(makeRawActivity({ duration_minutes: 150 }));
    expect(vm.duration).toBe('2 ч 30 мин');
  });

  it('formats date', () => {
    const vm = toActivityViewModel(makeRawActivity({ date: '2026-05-20' }));
    expect(vm.dateFormatted).toBe('20 мая');
  });

  it('nests location object', () => {
    const vm = toActivityViewModel(makeRawActivity());
    expect(vm.location).toEqual({ id: 'alpika', name: 'Альпика' });
  });

  it('assigns correct category color for взрослым', () => {
    const vm = toActivityViewModel(makeRawActivity({ category: 'взрослым' }));
    expect(vm.categoryColor).toBe('#C49A2E');
  });

  it('assigns correct category color for вместе', () => {
    const vm = toActivityViewModel(makeRawActivity({ category: 'вместе' }));
    expect(vm.categoryColor).toBe('#5B8C7A');
  });

  it('assigns correct category color for детям', () => {
    const vm = toActivityViewModel(makeRawActivity({ category: 'детям' }));
    expect(vm.categoryColor).toBe('#D4789A');
  });

  it('handles optional teacher avatar', () => {
    const vmWith = toActivityViewModel(makeRawActivity({ teacher_avatar: 'https://example.com/avatar.jpg' }));
    expect(vmWith.teacherAvatar).toBe('https://example.com/avatar.jpg');

    const vmWithout = toActivityViewModel(makeRawActivity());
    expect(vmWithout.teacherAvatar).toBeUndefined();
  });
});
