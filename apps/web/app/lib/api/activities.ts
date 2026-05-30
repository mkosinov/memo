import type { ActivityDTO } from '@/app/lib/model/dto/activity';

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

interface ActivityTemplate {
  baseId: string;
  title: string;
  category: 'взрослым' | 'вместе' | 'детям';
  image_url: string;
  guest_photos?: string[];
  time: string;
  duration_minutes: number;
  location_id: string;
  location_name: string;
  location_address?: string;
  material: string;
  size: string;
  price_min: number;
  price_max: number;
  teacher_name: string;
  teacher_avatar?: string;
  price_details?: string;
  material_details?: string;
  location_details?: string;
}

const ACTIVITY_TEMPLATES: ActivityTemplate[] = [
  {
    baseId: 'act-sea',
    title: 'Морской пейзаж',
    category: 'взрослым',
    image_url: '/images/card-seascape.jpg',
    guest_photos: ['/images/guest-1.jpg', '/images/guest-2.jpg'],
    time: '14:00',
    duration_minutes: 150,
    location_id: 'alpika',
    location_name: 'Альпика',
    location_address: 'Красная Поляна, ул. Альпика, 1',
    material: 'Масло',
    size: '30×40 см',
    price_min: 3500,
    price_max: 5500,
    teacher_name: 'Ольга Середа',
    teacher_avatar: 'https://i.pravatar.cc/40?img=1',
    price_details: 'Включает все материалы, холст и фартук',
    material_details: 'Профессиональные масляные краски, холст на подрамнике 30×40, кисти, палитра',
    location_details: '5 минут от канатной дороги «Альпика», вход со двора',
  },
  {
    baseId: 'act-wc',
    title: 'Акварельный скетчинг',
    category: 'взрослым',
    image_url: '/images/card-watercolor.jpg',
    time: '11:00',
    duration_minutes: 120,
    location_id: 'grand',
    location_name: 'Гранд Отель Поляна',
    location_address: 'Красная Поляна, ул. Просвещения, 60',
    material: 'Акварель',
    size: 'A3',
    price_min: 2800,
    price_max: 4000,
    teacher_name: 'Юлия Большакова',
    price_details: 'Включает акварельную бумагу и набор красок',
    material_details: 'Акварельные краски, бумага A3 300 г/м², кисти, палитра',
  },
  {
    baseId: 'act-family',
    title: 'Рисуем семью',
    category: 'вместе',
    image_url: '/images/card-family.jpg',
    time: '12:00',
    duration_minutes: 90,
    location_id: 'alpika',
    location_name: 'Альпика',
    location_address: 'Красная Поляна, ул. Альпика, 1',
    material: 'Акрил',
    size: '20×30 см',
    price_min: 2000,
    price_max: 3000,
    teacher_name: 'Дарья Тюльпина',
    price_details: 'Цена за одного участника, дети до 5 лет бесплатно',
    material_details: 'Акриловые краски, холст 20×30, кисти, фартуки для детей',
  },
  {
    baseId: 'act-animals',
    title: 'Весёлые зверушки',
    category: 'детям',
    image_url: '/images/card-animals.jpg',
    time: '10:00',
    duration_minutes: 60,
    location_id: 'p1389',
    location_name: 'Поляна 1389',
    location_address: 'Красная Поляна, ул. Горная, 1389',
    material: 'Гуашь',
    size: 'A4',
    price_min: 1500,
    price_max: 2000,
    teacher_name: 'Анастасия П.',
    price_details: 'Включает все материалы и готовую работу',
    material_details: 'Гуашь, бумага A4, кисти, трафареты',
    location_details: '2 этаж, рядом с детской зоной',
  },
  {
    baseId: 'act-mountain',
    title: 'Горный пейзаж акрилом',
    category: 'взрослым',
    image_url: '/images/card-mountain-acrylic.jpg',
    time: '16:00',
    duration_minutes: 180,
    location_id: 'p1389',
    location_name: 'Поляна 1389',
    location_address: 'Красная Поляна, ул. Горная, 1389',
    material: 'Акрил',
    size: '40×50 см',
    price_min: 3800,
    price_max: 5000,
    teacher_name: 'Александра В.',
    price_details: 'Включает профессиональный холст и набор красок',
    material_details: 'Акриловые краски, холст 40×50 на подрамнике, набор кистей, мастихин',
  },
  {
    baseId: 'act-shopper',
    title: 'Роспись шоппера',
    category: 'вместе',
    image_url: '/images/card-shopper.jpg',
    time: '15:00',
    duration_minutes: 90,
    location_id: 'grand',
    location_name: 'Гранд Отель Поляна',
    location_address: 'Красная Поляна, ул. Просвещения, 60',
    material: 'Текстильные краски',
    size: 'Шоппер 38×42',
    price_min: 2500,
    price_max: 3200,
    teacher_name: 'Ирина Горох',
    price_details: 'Шоппер включён в стоимость',
    material_details: 'Текстильные краски, шоппер из хлопка, трафареты, кисти',
    location_details: 'Лобби отеля, зона у ресепшн',
  },
  {
    baseId: 'act-interior',
    title: 'Интерьерная живопись',
    category: 'взрослым',
    image_url: '/images/card-mountain-acrylic.jpg',
    time: '13:00',
    duration_minutes: 150,
    location_id: 'alpika',
    location_name: 'Альпика',
    location_address: 'Красная Поляна, ул. Альпика, 1',
    material: 'Акрил',
    size: '50×60 см',
    price_min: 4500,
    price_max: 6500,
    teacher_name: 'Елена Морозова',
    teacher_avatar: 'https://i.pravatar.cc/40?img=5',
    price_details: 'Холст и краски премиум-класса включены',
    material_details: 'Акриловые краски, холст 50×60 на подрамнике, набор кистей, мастихин',
    location_details: '2 этаж, светлая студия с панорамными окнами',
  },
];

/** Distribute activity templates across a 14-day window */
function makeMockActivities(): ActivityDTO[] {
  const result: ActivityDTO[] = [];
  const daysCount = 14;

  for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
    const dateStr = d(dayOffset);
    // Assign a rotating subset: 3–5 activities per day
    const activitiesForDay = ACTIVITY_TEMPLATES.filter((_, i) => {
      // Each template appears every ~2-3 days with some jitter
      const step = [2, 2, 3, 2, 3][i % 5];
      return dayOffset % step === i % 3;
    });

    for (const tpl of activitiesForDay) {
      const id = `${tpl.baseId}-d${dayOffset}`;
      const nextOffset1 = dayOffset + 2 + (dayOffset % 3);
      const nextOffset2 = dayOffset + 5 + (dayOffset % 2);
      const nextOffset3 = dayOffset + 8 + (dayOffset % 3);

      result.push({
        id,
        title: tpl.title,
        category: tpl.category,
        image_url: tpl.image_url,
        guest_photos: tpl.guest_photos,
        time: tpl.time,
        duration_minutes: tpl.duration_minutes,
        location_id: tpl.location_id,
        location_name: tpl.location_name,
        location_address: tpl.location_address,
        guests_count: 2 + (dayOffset % 5),
        material: tpl.material,
        size: tpl.size,
        price_min: tpl.price_min,
        price_max: tpl.price_max,
        teacher_name: tpl.teacher_name,
        teacher_avatar: tpl.teacher_avatar,
        date: dateStr,
        next_times: [
          ...(nextOffset1 < daysCount ? [{ id: `${tpl.baseId}-d${nextOffset1}`, date: ruDate(nextOffset1), time: tpl.time }] : []),
          ...(nextOffset2 < daysCount ? [{ id: `${tpl.baseId}-d${nextOffset2}`, date: ruDate(nextOffset2), time: tpl.time }] : []),
          ...(nextOffset3 < daysCount ? [{ id: `${tpl.baseId}-d${nextOffset3}`, date: ruDate(nextOffset3), time: tpl.time }] : []),
        ],
        price_details: tpl.price_details,
        material_details: tpl.material_details,
        location_details: tpl.location_details,
      });
    }
  }

  return result;
}

export interface ActivityAPI {
  /** Filter by exact date (YYYY-MM-DD) */
  date?: string;
  /** Start of date range (YYYY-MM-DD) */
  dateStart?: string;
  /** End of date range (YYYY-MM-DD) */
  dateEnd?: string;
  /** Filter by location ID */
  location?: string;
  /** Filter by activity tag (возрастная группа) */
  tag?: string;
}

export async function getActivities(params?: ActivityAPI): Promise<ActivityDTO[]> {
  let result = makeMockActivities();

  if (params?.date) {
    result = result.filter((a) => a.date === params.date);
  }
  if (params?.dateStart) {
    result = result.filter((a) => a.date >= params.dateStart!);
  }
  if (params?.dateEnd) {
    result = result.filter((a) => a.date <= params.dateEnd!);
  }
  if (params?.location) {
    result = result.filter((a) => a.location_id === params.location);
  }
  if (params?.tag) {
    result = result.filter((a) => a.category === params.tag);
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
