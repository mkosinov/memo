import type { RawActivityDTO } from '@/app/lib/model/dto/activity';

/** Helper: format Date as YYYY-MM-DD */
function d(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().split('T')[0];
}

/** Helper: Russian date string like "22 мая" */
function ruDate(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const day = date.getDate();
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${day} ${months[date.getMonth()]}`;
}

function makeMockActivities(): RawActivityDTO[] {
  return [
    {
      id: 'act-1',
      title: 'Морской пейзаж',
      category: 'взрослым',
      image_url: '/images/card-seascape.jpg',
      guest_photos: [
        '/images/guest-1.jpg',
        '/images/guest-2.jpg',
      ],
      time: '14:00',
      duration_minutes: 150,
      location_id: 'alpika',
      location_name: 'Альпика',
      location_address: 'Красная Поляна, ул. Альпика, 1',
      guests_count: 3,
      material: 'Масло',
      size: '30×40 см',
      price_min: 3500,
      price_max: 5500,
      teacher_name: 'Ольга Середа',
      teacher_avatar: 'https://i.pravatar.cc/40?img=1',
      date: d(0),
      next_times: [
        { id: 'act-1b', date: ruDate(2), time: '14:00' },
        { id: 'act-1c', date: ruDate(5), time: '11:00' },
        { id: 'act-1d', date: ruDate(8), time: '16:00' },
      ],
      price_details: 'Включает все материалы, холст и фартук',
      material_details: 'Профессиональные масляные краски, холст на подрамнике 30×40, кисти, палитра',
      location_details: '5 минут от канатной дороги «Альпика», вход со двора',
    },
    {
      id: 'act-2',
      title: 'Акварельный скетчинг',
      category: 'взрослым',
      image_url: '/images/card-watercolor.jpg',
      time: '11:00',
      duration_minutes: 120,
      location_id: 'grand',
      location_name: 'Гранд Отель Поляна',
      location_address: 'Красная Поляна, ул. Просвещения, 60',
      guests_count: 5,
      material: 'Акварель',
      size: 'A3',
      price_min: 2800,
      price_max: 4000,
      teacher_name: 'Юлия Большакова',
      date: d(0),
      next_times: [
        { id: 'act-2b', date: ruDate(3), time: '11:00' },
        { id: 'act-2c', date: ruDate(7), time: '15:00' },
      ],
      price_details: 'Включает акварельную бумагу и набор красок',
      material_details: 'Акварельные краски, бумага A3 300 г/м², кисти, палитра',
    },
    {
      id: 'act-3',
      title: 'Рисуем семью',
      category: 'вместе',
      image_url: '/images/card-family.jpg',
      time: '12:00',
      duration_minutes: 90,
      location_id: 'alpika',
      location_name: 'Альпика',
      location_address: 'Красная Поляна, ул. Альпика, 1',
      guests_count: 4,
      material: 'Акрил',
      size: '20×30 см',
      price_min: 2000,
      price_max: 3000,
      teacher_name: 'Дарья Тюльпина',
      date: d(0),
      next_times: [
        { id: 'act-3b', date: ruDate(4), time: '12:00' },
        { id: 'act-3c', date: ruDate(8), time: '10:00' },
      ],
      price_details: 'Цена за одного участника, дети до 5 лет бесплатно',
      material_details: 'Акриловые краски, холст 20×30, кисти, фартуки для детей',
    },
    {
      id: 'act-4',
      title: 'Весёлые зверушки',
      category: 'детям',
      image_url: '/images/card-animals.jpg',
      time: '10:00',
      duration_minutes: 60,
      location_id: 'p1389',
      location_name: 'Поляна 1389',
      location_address: 'Красная Поляна, ул. Горная, 1389',
      guests_count: 6,
      material: 'Гуашь',
      size: 'A4',
      price_min: 1500,
      price_max: 2000,
      teacher_name: 'Анастасия П.',
      date: d(0),
      next_times: [
        { id: 'act-4b', date: ruDate(3), time: '10:00' },
        { id: 'act-4c', date: ruDate(6), time: '10:00' },
        { id: 'act-4d', date: ruDate(10), time: '11:00' },
      ],
      price_details: 'Включает все материалы и готовую работу',
      material_details: 'Гуашь, бумага A4, кисти, трафареты',
      location_details: '2 этаж, рядом с детской зоной',
    },
    {
      id: 'act-5',
      title: 'Горный пейзаж акрилом',
      category: 'взрослым',
      image_url: '/images/card-mountain-acrylic.jpg',
      time: '16:00',
      duration_minutes: 180,
      location_id: 'p1389',
      location_name: 'Поляна 1389',
      location_address: 'Красная Поляна, ул. Горная, 1389',
      guests_count: 2,
      material: 'Акрил',
      size: '40×50 см',
      price_min: 3800,
      price_max: 5000,
      teacher_name: 'Александра В.',
      date: d(0),
      next_times: [
        { id: 'act-5b', date: ruDate(5), time: '16:00' },
      ],
      price_details: 'Включает профессиональный холст и набор красок',
      material_details: 'Акриловые краски, холст 40×50 на подрамнике, набор кистей, мастихин',
    },
    {
      id: 'act-6',
      title: 'Роспись шоппера',
      category: 'вместе',
      image_url: '/images/card-shopper.jpg',
      time: '15:00',
      duration_minutes: 90,
      location_id: 'grand',
      location_name: 'Гранд Отель Поляна',
      location_address: 'Красная Поляна, ул. Просвещения, 60',
      guests_count: 7,
      material: 'Текстильные краски',
      size: 'Шоппер 38×42',
      price_min: 2500,
      price_max: 3200,
      teacher_name: 'Ирина Горох',
      date: d(0),
      next_times: [
        { id: 'act-6b', date: ruDate(4), time: '15:00' },
        { id: 'act-6c', date: ruDate(9), time: '14:00' },
      ],
      price_details: 'Шоппер включён в стоимость',
      material_details: 'Текстильные краски, шоппер из хлопка, трафареты, кисти',
      location_details: 'Лобби отеля, зона у ресепшн',
    },
    {
      id: 'act-7',
      title: 'Интерьерная живопись',
      category: 'взрослым',
      image_url: '/images/card-mountain-acrylic.jpg',
      time: '13:00',
      duration_minutes: 150,
      location_id: 'alpika',
      location_name: 'Альпика',
      location_address: 'Красная Поляна, ул. Альпика, 1',
      guests_count: 4,
      material: 'Акрил',
      size: '50×60 см',
      price_min: 4500,
      price_max: 6500,
      teacher_name: 'Елена Морозова',
      teacher_avatar: 'https://i.pravatar.cc/40?img=5',
      date: d(0),
      next_times: [
        { id: 'act-7b', date: ruDate(3), time: '13:00' },
        { id: 'act-7c', date: ruDate(6), time: '14:00' },
      ],
      price_details: 'Холст и краски премиум-класса включены',
      material_details: 'Акриловые краски, холст 50×60 на подрамнике, набор кистей, мастихин',
      location_details: '2 этаж, светлая студия с панорамными окнами',
    },
  ];
}

export interface ActivitiesFilters {
  date?: string;
  location?: string;
  category?: string;
}

export async function getActivities(filters?: ActivitiesFilters): Promise<RawActivityDTO[]> {
  let result = makeMockActivities();

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
