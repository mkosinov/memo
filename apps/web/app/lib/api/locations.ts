import type { LocationDTO } from '@/app/lib/model/dto/location';

const MOCK_LOCATIONS: LocationDTO[] = [
  {
    id: 'alpika',
    name: 'Альпика',
    address: 'г. Москва, ул. Горная, д. 1, 1 этаж',
    hours: '10:00–21:00',
    photo_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&h=400&fit=crop',
  },
  {
    id: 'grand',
    name: 'Гранд Отель Поляна',
    address: 'г. Москва, пр-т Мира, д. 25, лобби',
    hours: '09:00–22:00',
    photo_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&h=400&fit=crop',
  },
  {
    id: 'p1389',
    name: 'Поляна 1389',
    address: 'г. Москва, ул. Цветочная, д. 15, 2 этаж',
    hours: '10:00–20:00',
  },
  {
    id: 'park',
    name: 'Парк Студия',
    address: 'г. Москва, Парковая ул., д. 8',
    hours: '11:00–21:00',
    photo_url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&h=400&fit=crop',
  },
];

export async function getLocations(): Promise<LocationDTO[]> {
  return [...MOCK_LOCATIONS];
}
