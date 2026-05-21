import type { RawActivityDTO } from '@/app/lib/model/dto/activity';

const MOCK_ACTIVITIES: RawActivityDTO[] = [
  {
    id: 'act-1',
    title: 'Морской пейзаж',
    category: 'взрослым',
    image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600&h=450&fit=crop',
    time: '14:00',
    duration_minutes: 150,
    location_id: 'alpika',
    location_name: 'Альпика',
    guests_count: 3,
    material: 'Масло',
    size: '30×40 см',
    price_min: 3500,
    price_max: 5500,
    teacher_name: 'Ольга Середа',
    teacher_avatar: 'https://i.pravatar.cc/40?img=1',
    date: '2026-05-20',
  },
  {
    id: 'act-2',
    title: 'Акварельный скетчинг',
    category: 'взрослым',
    image_url: 'https://images.unsplash.com/photo-1460661419201-3fdcc8e41ce3?w=600&h=450&fit=crop',
    time: '11:00',
    duration_minutes: 120,
    location_id: 'grand',
    location_name: 'Гранд Отель Поляна',
    guests_count: 5,
    material: 'Акварель',
    size: 'A3',
    price_min: 2800,
    price_max: 4000,
    teacher_name: 'Юлия Большакова',
    date: '2026-05-20',
  },
  {
    id: 'act-3',
    title: 'Рисуем семью',
    category: 'вместе',
    image_url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&h=450&fit=crop',
    time: '12:00',
    duration_minutes: 90,
    location_id: 'alpika',
    location_name: 'Альпика',
    guests_count: 4,
    material: 'Акрил',
    size: '20×30 см',
    price_min: 2000,
    price_max: 3000,
    teacher_name: 'Дарья Тюльпина',
    date: '2026-05-21',
  },
  {
    id: 'act-4',
    title: 'Весёлые зверушки',
    category: 'детям',
    image_url: 'https://images.unsplash.com/photo-1596548438137-d51ea5c83ca5?w=600&h=450&fit=crop',
    time: '10:00',
    duration_minutes: 60,
    location_id: 'p1389',
    location_name: 'Поляна 1389',
    guests_count: 6,
    material: 'Гуашь',
    size: 'A4',
    price_min: 1500,
    price_max: 2000,
    teacher_name: 'Анастасия П.',
    date: '2026-05-21',
  },
  {
    id: 'act-5',
    title: 'Горный пейзаж акрилом',
    category: 'взрослым',
    image_url: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=600&h=450&fit=crop',
    time: '16:00',
    duration_minutes: 180,
    location_id: 'p1389',
    location_name: 'Поляна 1389',
    guests_count: 2,
    material: 'Акрил',
    size: '40×50 см',
    price_min: 3800,
    price_max: 5000,
    teacher_name: 'Александра В.',
    date: '2026-05-22',
  },
  {
    id: 'act-6',
    title: 'Роспись шоппера',
    category: 'вместе',
    image_url: 'https://images.unsplash.com/photo-1513519244980-afbf55b59654?w=600&h=450&fit=crop',
    time: '15:00',
    duration_minutes: 90,
    location_id: 'grand',
    location_name: 'Гранд Отель Поляна',
    guests_count: 7,
    material: 'Текстильные краски',
    size: 'Шоппер 38×42',
    price_min: 2500,
    price_max: 3200,
    teacher_name: 'Ирина Горох',
    date: '2026-05-22',
  },
];

export interface ActivitiesFilters {
  date?: string;
  location?: string;
  category?: string;
}

export async function getActivities(filters?: ActivitiesFilters): Promise<RawActivityDTO[]> {
  let result = [...MOCK_ACTIVITIES];

  if (filters?.date) {
    result = result.filter((a) => a.date === filters.date);
  }
  if (filters?.location) {
    result = result.filter((a) => a.location_id === filters.location);
  }
  if (filters?.category) {
    result = result.filter((a) => a.category === filters.category);
  }

  return result;
}

export interface BookingData {
  activityId: string;
  adultCount: number;
  childCount: number;
  name: string;
  phone: string;
  comment?: string;
  confirmationMethod: string;
}

export async function createBooking(data: BookingData): Promise<{ success: boolean; bookingId: string }> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { success: true, bookingId: `mock-${Date.now()}` };
}
