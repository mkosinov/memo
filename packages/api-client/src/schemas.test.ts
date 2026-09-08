import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  MasterResponseSchema,
  type MasterResponse,
  LocationResponseSchema,
  type LocationResponse,
  TagResponseSchema,
  ServiceResponseSchema,
  type ServiceResponse,
  ActivityCreateSchema,
  type ActivityCreate,
  ActivityPatchSchema,
  type ActivityPatch,
  ActivityResponseSchema,
  type ActivityResponse,
  PhotoResponseSchema,
  PhotoListResponseSchema,
  PhotoCreateSchema,
  PhotoUpdateSchema,
  type PhotoCreate,
  type PhotoResponse,
  VisitResponseSchema,
  type VisitResponse,
  RecordResponseSchema,
  type RecordResponse,
  ClientResponseSchema,
  type ClientResponse,
  ClientUpdateSchema,
  PaymentResponseSchema,
  type PaymentResponse,
  TariffCreateSchema,
  MasterUpdateSchema,
  MaterialResponseSchema,
  MaterialUpdateSchema,
  ServiceCreateSchema,
  ServiceUpdateSchema,
  type ServiceUpdate,
  ServiceMaterialItemSchema,
  ServiceMaterialLinkSchema,
  LocationCreateSchema,
  LocationUpdateSchema,
  type LocationUpdate,
  ClientWithStatsSchema,
  RecordViewResponseSchema,
  type RecordView,
} from './schemas';
import backendFixtures from './__fixtures__/backend-responses.json';

// ─── MasterResponse ────────────────────────────────────────────────────────

const validMaster = {
  id: 'master-1',
  first_name: 'Анна',
  last_name: 'Иванова',
  color: '#FF6B6B',
  position: 'мастер',
  specialty: 'живопись',
  avatar_url: 'https://example.com/avatar.jpg',
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('MasterResponseSchema', () => {
  it('parses a valid master response', () => {
    const result = MasterResponseSchema.parse(validMaster);
    expect(result.id).toBe('master-1');
    expect(result.first_name).toBe('Анна');
    expect(result.last_name).toBe('Иванова');
    expect(result.color).toBe('#FF6B6B');
    expect(result.position).toBe('мастер');
    expect(result.specialty).toBe('живопись');
    expect(result.avatar_url).toBe('https://example.com/avatar.jpg');
    expect(result.archived).toBe(false);
  });

  it('parses master with nullable avatar_url', () => {
    const data = { ...validMaster, avatar_url: null };
    const result = MasterResponseSchema.parse(data);
    expect(result.avatar_url).toBeNull();
  });

  it('rejects missing required field', () => {
    const { first_name, ...without } = validMaster;
    expect(() => MasterResponseSchema.parse(without)).toThrow();
  });

  it('parses master with sort_order', () => {
    const data = { ...validMaster, sort_order: 3 };
    const result = MasterResponseSchema.parse(data);
    expect(result.sort_order).toBe(3);
  });

  it('defaults sort_order to undefined when absent', () => {
    const result = MasterResponseSchema.parse(validMaster);
    expect(result.sort_order).toBeUndefined();
  });
});

// ─── LocationResponse ──────────────────────────────────────────────────────

const validLocation = {
  id: 'loc-1',
  name: 'Студия на Невском',
  address: 'Невский пр. 28',
  description: 'Уютная студия',
  capacity: 10,
  yandex_map_url: 'https://yandex.ru/maps/...',
  review_url: 'https://yandex.ru/reviews/...',
  record_info: 'Запись по телефону',
  image_url: 'https://example.com/studio.jpg',
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('LocationResponseSchema', () => {
  it('parses a valid location response', () => {
    const result = LocationResponseSchema.parse(validLocation);
    expect(result.id).toBe('loc-1');
    expect(result.name).toBe('Студия на Невском');
    expect(result.capacity).toBe(10);
  });

  it('parses location with nullable fields', () => {
    const data = { ...validLocation, address: null, description: null };
    const result = LocationResponseSchema.parse(data);
    expect(result.address).toBeNull();
    expect(result.description).toBeNull();
  });

  it('rejects missing name', () => {
    const { name, ...without } = validLocation;
    expect(() => LocationResponseSchema.parse(without)).toThrow();
  });

  it('parses location with location_hint', () => {
    const data = { ...validLocation, location_hint: 'Вход со двора' };
    const result = LocationResponseSchema.parse(data);
    expect(result.location_hint).toBe('Вход со двора');
  });

  it('parses location without location_hint (field absent)', () => {
    // Schema has location_hint as optional, so parsing should succeed without it
    const result = LocationResponseSchema.parse(validLocation);
    expect(result.location_hint).toBeUndefined();
  });

  it('parses location with sort_order', () => {
    const data = { ...validLocation, sort_order: 5 };
    const result = LocationResponseSchema.parse(data);
    expect(result.sort_order).toBe(5);
  });

  it('defaults sort_order to undefined when absent', () => {
    const result = LocationResponseSchema.parse(validLocation);
    expect(result.sort_order).toBeUndefined();
  });

  it('parses location with short_title', () => {
    const data = { ...validLocation, short_title: 'Гранд' };
    const result = LocationResponseSchema.parse(data);
    expect(result.short_title).toBe('Гранд');
  });

  it('parses location without short_title (field absent)', () => {
    const result = LocationResponseSchema.parse(validLocation);
    expect(result.short_title).toBeUndefined();
  });

  it('parses location with null short_title', () => {
    const data = { ...validLocation, short_title: null };
    const result = LocationResponseSchema.parse(data);
    expect(result.short_title).toBeNull();
  });
});

// ─── ServiceResponse ────────────────────────────────────────────────────────

const validTariff = {
  id: 'tariff-1',
  service_id: 'service-1',
  title: 'Взрослый',
  description: 'Билет для взрослого',
  price: 2500,
};

const validTag = {
  id: 'tag-1',
  tag: 'масло',
};

// GH #223: nested material payload on ServiceResponse (read shape, spec §4/§5).
const validServiceMaterialItem = {
  id: 'material-1',
  title: 'Акварель',
  description: 'Акварельные краски',
  note: 'бумага 300 г',
};

const validService = {
  id: 'service-1',
  title: 'Мастер-класс по живописи',
  description: 'Научитесь писать маслом',
  image_url: 'https://example.com/painting.jpg',
  specialty: 'живопись',
  min_age: 6,
  max_age: 99,
  duration: 180,
  record_info: 'Запись за 24 часа',
  tariffs: [validTariff],
  tags: [validTag],
  materials: [validServiceMaterialItem],
  archived: false,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('ServiceResponseSchema', () => {
  it('parses a valid service response with nested tariffs and tags', () => {
    const result = ServiceResponseSchema.parse(validService);
    expect(result.id).toBe('service-1');
    expect(result.title).toBe('Мастер-класс по живописи');
    expect(result.min_age).toBe(6);
    expect(result.max_age).toBe(99);
    expect(result.duration).toBe(180);
    expect(result.tariffs).toHaveLength(1);
    expect(result.tariffs[0].title).toBe('Взрослый');
    expect(result.tariffs[0].price).toBe(2500);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].tag).toBe('масло');
  });

  it('parses service with empty tariffs and tags', () => {
    const data = { ...validService, tariffs: [], tags: [] };
    const result = ServiceResponseSchema.parse(data);
    expect(result.tariffs).toHaveLength(0);
    expect(result.tags).toHaveLength(0);
  });

  it('strips legacy material_hint from service responses (GH #223 Task 13)', () => {
    // material_hint is retired: a legacy backend response still carrying the
    // key must parse, and the parsed result must not expose the field.
    const data = { ...validService, material_hint: 'Принести фартук' };
    const result = ServiceResponseSchema.parse(data);
    expect('material_hint' in result).toBe(false);
  });

  it('parses service without material_hint (field absent)', () => {
    // When field is absent and schema uses .optional(), parse should still succeed
    const result = ServiceResponseSchema.parse(validService);
    expect('material_hint' in result).toBe(false);
  });

  // ─── GH #223: nested materials (read shape, spec §4/§5) ───

  it('parses service with materials (GH #223)', () => {
    const result = ServiceResponseSchema.parse(validService);
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].id).toBe('material-1');
    expect(result.materials[0].title).toBe('Акварель');
    expect(result.materials[0].description).toBe('Акварельные краски');
    expect(result.materials[0].note).toBe('бумага 300 г');
  });

  it('defaults materials to [] when absent (GH #223)', () => {
    const { materials: _materials, ...noMaterials } = validService;
    const result = ServiceResponseSchema.parse(noMaterials);
    expect(result.materials).toEqual([]);
  });

  it('parses material item with null note (GH #223)', () => {
    const data = { ...validService, materials: [{ ...validServiceMaterialItem, note: null }] };
    const result = ServiceResponseSchema.parse(data);
    expect(result.materials[0].note).toBeNull();
  });
});

// ─── ServiceMaterialItemSchema (GH #223) ───────────────────────────────────

describe('ServiceMaterialItemSchema', () => {
  it('parses a valid nested material item', () => {
    const result = ServiceMaterialItemSchema.parse(validServiceMaterialItem);
    expect(result.id).toBe('material-1');
    expect(result.title).toBe('Акварель');
    expect(result.description).toBe('Акварельные краски');
    expect(result.note).toBe('бумага 300 г');
  });

  it('accepts null note', () => {
    const result = ServiceMaterialItemSchema.parse({ ...validServiceMaterialItem, note: null });
    expect(result.note).toBeNull();
  });

  it('rejects missing note (backend always serializes it)', () => {
    const { note: _note, ...noNote } = validServiceMaterialItem;
    expect(() => ServiceMaterialItemSchema.parse(noNote)).toThrow();
  });

  it('rejects missing title', () => {
    const { title: _title, ...noTitle } = validServiceMaterialItem;
    expect(() => ServiceMaterialItemSchema.parse(noTitle)).toThrow();
  });
});

// ─── ServiceMaterialLinkSchema (GH #223, write shape spec §4) ───────────────

describe('ServiceMaterialLinkSchema', () => {
  it('parses a link with a note', () => {
    const result = ServiceMaterialLinkSchema.parse({ material_id: 'material-1', note: 'бумага 300 г' });
    expect(result.material_id).toBe('material-1');
    expect(result.note).toBe('бумага 300 г');
  });

  it('parses a link without note (optional)', () => {
    const result = ServiceMaterialLinkSchema.parse({ material_id: 'material-1' });
    expect(result.note).toBeUndefined();
  });

  it('parses a link with null note (clears the note, spec §4)', () => {
    const result = ServiceMaterialLinkSchema.parse({ material_id: 'material-1', note: null });
    expect(result.note).toBeNull();
  });

  it('rejects missing material_id', () => {
    expect(() => ServiceMaterialLinkSchema.parse({ note: 'без id' })).toThrow();
  });
});

// ─── ActivityCreate ─────────────────────────────────────────────────────────

const validActivityCreate = {
  master_id: 'master-1',
  service_id: 'service-1',
  location_id: 'loc-1',
  start: '2024-12-25T14:00:00Z',
  duration: 180,
  capacity: 10,
  is_private: false,
  comment: 'Комментарий',
  record_info: 'Запись обязательна',
};

describe('ActivityCreateSchema', () => {
  it('parses a valid activity create request', () => {
    const result = ActivityCreateSchema.parse(validActivityCreate);
    expect(result.master_id).toBe('master-1');
    expect(result.service_id).toBe('service-1');
    expect(result.start).toBe('2024-12-25T14:00:00Z');
    expect(result.duration).toBe(180);
    expect(result.is_private).toBe(false);
  });

  it('accepts minimal input without optional fields', () => {
    const minimal = {
      master_id: 'master-1',
      service_id: 'service-1',
      location_id: 'loc-1',
      start: '2024-12-25T14:00:00Z',
      duration: 180,
      capacity: 10,
    };
    const result = ActivityCreateSchema.parse(minimal);
    expect(result.is_private).toBeUndefined();
    expect(result.comment).toBeUndefined();
    expect(result.record_info).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    const { master_id, ...without } = validActivityCreate;
    expect(() => ActivityCreateSchema.parse(without)).toThrow();
  });
});

// ─── ActivityPatch (GH #142) ────────────────────────────────────────────────

describe('ActivityPatchSchema', () => {
  it('parses a minimal partial payload (only start)', () => {
    const result = ActivityPatchSchema.parse({ start: '2026-09-03T10:30:00' });
    expect(result.start).toBe('2026-09-03T10:30:00');
    expect(result.master_id).toBeUndefined();
  });

  it('accepts occupied (wire anomaly — ignored by backend on PATCH)', () => {
    const result = ActivityPatchSchema.parse({ start: '2026-09-03T10:30:00', occupied: 3 });
    expect(result.occupied).toBe(3);
  });

  it('accepts any partial subset of ActivityCreate fields', () => {
    const patch: ActivityPatch = { duration: 120, capacity: 8, comment: 'новый' };
    const result = ActivityPatchSchema.parse(patch);
    expect(result.duration).toBe(120);
    expect(result.capacity).toBe(8);
    expect(result.comment).toBe('новый');
  });
});

// ─── ActivityResponse ───────────────────────────────────────────────────────

const validActivityResponse = {
  ...validActivityCreate,
  id: 'activity-1',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  occupied: 3,
};

describe('ActivityResponseSchema', () => {
  it('parses a valid activity response', () => {
    const result = ActivityResponseSchema.parse(validActivityResponse);
    expect(result.id).toBe('activity-1');
    expect(result.occupied).toBe(3);
    expect(result).not.toHaveProperty('is_active');
  });

  it('rejects activity without occupied', () => {
    const { occupied: _, ...dataWithoutOccupied } = validActivityResponse;
    expect(() => ActivityResponseSchema.parse(dataWithoutOccupied)).toThrow();
  });
});

// ─── PhotoResponse (GH #211: 4-owner model, visitor_id removed) ─────────────

const validPhoto = {
  id: 'photo-1',
  filename: 'workshop-2024.jpg',
  client_id: 'client-1',
  service_id: 'service-1',
  activity_id: 'activity-1',
  location_id: 'location-1',
  is_public: true,
  tags: [{ id: 'tag-1', tag: 'керамика' }],
  client_name: 'Иван Петров',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('PhotoResponseSchema', () => {
  it('parses a valid photo response', () => {
    const result = PhotoResponseSchema.parse(validPhoto);
    expect(result.id).toBe('photo-1');
    expect(result.filename).toBe('workshop-2024.jpg');
    expect(result.client_id).toBe('client-1');
    expect(result.service_id).toBe('service-1');
    expect(result.activity_id).toBe('activity-1');
    expect(result.location_id).toBe('location-1');
    expect(result.is_public).toBe(true);
    expect(result.tags).toEqual([{ id: 'tag-1', tag: 'керамика' }]);
    expect(result.client_name).toBe('Иван Петров');
  });

  it('parses photo with null owner fields and client_name', () => {
    const data = {
      ...validPhoto,
      client_id: null,
      service_id: null,
      activity_id: null,
      location_id: null,
      client_name: null,
      tags: [],
    };
    const result = PhotoResponseSchema.parse(data);
    expect(result.client_id).toBeNull();
    expect(result.location_id).toBeNull();
    expect(result.client_name).toBeNull();
    expect(result.tags).toEqual([]);
  });

  it('rejects visitor_id on the type (dropped in GH #211)', () => {
    const p: PhotoResponse = validPhoto;
    // @ts-expect-error visitor_id no longer exists on PhotoResponse
    expect(p.visitor_id).toBeUndefined();
  });

  it('rejects missing required field', () => {
    const { id, ...without } = validPhoto;
    expect(() => PhotoResponseSchema.parse(without)).toThrow();
  });
});

describe('PhotoCreateSchema / PhotoUpdateSchema (GH #211 4-owner model)', () => {
  // Backend PhotoCreate (schemas/photo.py): filename required; owner slots
  // client_id/service_id/activity_id/location_id all optional-null; NO
  // visitor_id (dropped in GH #211).
  it('parses a create payload with the 4 owner slots', () => {
    const result = PhotoCreateSchema.parse({
      filename: 'a.jpg',
      client_id: 'client-1',
      service_id: null,
      activity_id: null,
      location_id: null,
      is_public: true,
      tag_ids: ['tag-1'],
    });
    expect(result.filename).toBe('a.jpg');
    expect(result.client_id).toBe('client-1');
    expect(result.is_public).toBe(true);
    expect(result.tag_ids).toEqual(['tag-1']);
  });

  it('rejects visitor_id on the PhotoCreate type', () => {
    const data: PhotoCreate = { filename: 'a.jpg', is_public: true, tag_ids: [] };
    // @ts-expect-error visitor_id no longer exists on PhotoCreate
    expect(data.visitor_id).toBeUndefined();
  });

  it('PhotoUpdateSchema accepts a partial payload (PATCH-like)', () => {
    const result = PhotoUpdateSchema.parse({ location_id: 'loc-1' });
    expect(result.location_id).toBe('loc-1');
  });
});

describe('PhotoListResponseSchema (GH #211)', () => {
  it('parses a paginated photo envelope', () => {
    const result = PhotoListResponseSchema.parse({
      items: [validPhoto],
      total: 1,
      page: 1,
      per_page: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('photo-1');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(20);
  });

  it('rejects envelope with malformed photo item', () => {
    expect(() =>
      PhotoListResponseSchema.parse({
        items: [{ id: 'p-1', filename: 'a.jpg' }],
        total: 1,
        page: 1,
        per_page: 20,
      }),
    ).toThrow();
  });
});

// ─── VisitResponse ──────────────────────────────────────────────────────────

const validVisit = {
  id: 'visit-1',
  record_id: 'record-1',
  visitor_id: 'visitor-1',
  price: 2500,
  custom_price: null,
  status: 'waiting',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('VisitResponseSchema', () => {
  it('parses a valid visit response', () => {
    const result = VisitResponseSchema.parse(validVisit);
    expect(result.id).toBe('visit-1');
    expect(result.record_id).toBe('record-1');
    expect(result.visitor_id).toBe('visitor-1');
    expect(result.price).toBe(2500);
    expect(result.status).toBe('waiting');
  });

  it('rejects missing required field', () => {
    const { id, ...without } = validVisit;
    expect(() => VisitResponseSchema.parse(without)).toThrow();
  });
});

// ─── RecordResponse ────────────────────────────────────────────────────────

const validRecord = {
  id: 'record-1',
  activity_id: 'activity-1',
  client_id: 'client-1',
  status: 'confirmed',
  seats: 2,
  anonym_visits: 0,
  comment: 'VIP guests',
  custom_price: null,
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  visits: [validVisit],
};

describe('RecordResponseSchema', () => {
  it('parses a valid record response with nested visits', () => {
    const result = RecordResponseSchema.parse(validRecord);
    expect(result.id).toBe('record-1');
    expect(result.activity_id).toBe('activity-1');
    expect(result.client_id).toBe('client-1');
    expect(result.status).toBe('confirmed');
    expect(result.seats).toBe(2);
    expect(result.comment).toBe('VIP guests');
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0].id).toBe('visit-1');
  });

  it('parses record with null client_id and comment', () => {
    const data = { ...validRecord, client_id: null, comment: null };
    const result = RecordResponseSchema.parse(data);
    expect(result.client_id).toBeNull();
    expect(result.comment).toBeNull();
  });

  it('parses record with empty visits', () => {
    const data = { ...validRecord, visits: [] };
    const result = RecordResponseSchema.parse(data);
    expect(result.visits).toHaveLength(0);
  });

  it('rejects missing required field', () => {
    const { id, ...without } = validRecord;
    expect(() => RecordResponseSchema.parse(without)).toThrow();
  });
});

// ─── RecordViewResponse (GH #213: composite read endpoint display fields) ───

const recordViewVisit = {
  id: 'visit-1',
  record_id: 'record-1',
  visitor_id: 'visitor-1',
  price: 2500,
  custom_price: null,
  status: 'waiting',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

const validRecordView = {
  id: 'record-1',
  activity_id: 'activity-1',
  client_id: 'client-1',
  status: 'confirmed',
  seats: 2,
  anonym_visits: 0,
  comment: 'VIP guests',
  custom_price: null,
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  visits: [recordViewVisit],
  client_name: 'Иван Петров',
  activity_start: '2024-12-25T14:00:00',
  service_title: 'Мастер-класс по живописи',
  master_name: 'Иванова Анна',
  location_name: 'Студия на Невском',
  master_color: '#FF6B6B',
  is_private: false,
  paid: 5000,
};

describe('RecordViewResponseSchema', () => {
  it('parses a valid record view response with all display fields', () => {
    const result = RecordViewResponseSchema.parse(validRecordView);
    expect(result.id).toBe('record-1');
    expect(result.visits).toHaveLength(1);
    expect(result.client_name).toBe('Иван Петров');
    expect(result.activity_start).toBe('2024-12-25T14:00:00');
    expect(result.service_title).toBe('Мастер-класс по живописи');
    expect(result.master_name).toBe('Иванова Анна');
    expect(result.location_name).toBe('Студия на Невском');
    expect(result.master_color).toBe('#FF6B6B');
    expect(result.is_private).toBe(false);
    expect(result.paid).toBe(5000);
  });

  it('parses record view with null display fields and paid 0', () => {
    const data = {
      ...validRecordView,
      client_id: null,
      client_name: null,
      activity_start: null,
      service_title: null,
      master_name: null,
      location_name: null,
      master_color: null,
      paid: 0,
    };
    const result = RecordViewResponseSchema.parse(data);
    expect(result.client_name).toBeNull();
    expect(result.activity_start).toBeNull();
    expect(result.service_title).toBeNull();
    expect(result.master_name).toBeNull();
    expect(result.location_name).toBeNull();
    expect(result.master_color).toBeNull();
    expect(result.paid).toBe(0);
  });

  it('rejects record view missing a display field', () => {
    const { is_private: _, ...without } = validRecordView;
    expect(() => RecordViewResponseSchema.parse(without)).toThrow();
  });

  it('rejects record view missing base RecordResponse fields', () => {
    const { id: _, ...without } = validRecordView;
    expect(() => RecordViewResponseSchema.parse(without)).toThrow();
  });

  it('rejects non-integer paid', () => {
    const data = { ...validRecordView, paid: 100.5 };
    expect(() => RecordViewResponseSchema.parse(data)).toThrow();
  });

  it('RecordView is a valid type', () => {
    const r: RecordView = validRecordView;
    expect(r.paid).toBe(5000);
  });
});

// ─── ClientResponse ────────────────────────────────────────────────────────

const validClient = {
  id: 'client-1',
  name: 'Иван Петров',
  phone: '+79991234567',
  email: null,
  channel: 'phone',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  archived: false,
};

describe('ClientResponseSchema', () => {
  it('parses a valid client response', () => {
    const result = ClientResponseSchema.parse(validClient);
    expect(result.id).toBe('client-1');
    expect(result.name).toBe('Иван Петров');
    expect(result.phone).toBe('+79991234567');
    expect(result.channel).toBe('phone');
    expect(result.archived).toBe(false);
  });

  it('rejects missing required field', () => {
    const { id, ...without } = validClient;
    expect(() => ClientResponseSchema.parse(without)).toThrow();
  });
});

// ─── ClientUpdateSchema (GH #201, #207 — is_active removed) ───────────────

describe('ClientUpdateSchema', () => {
  it('accepts a full canonical update payload', () => {
    const result = ClientUpdateSchema.parse({
      name: 'Иван', phone: '+79991234567', email: null,
      channel: 'telegram',
    });
    expect(result.channel).toBe('telegram');
  });

  it('accepts all-null personal fields (deliberate wipe)', () => {
    const result = ClientUpdateSchema.parse({
      name: null, phone: null, email: null, channel: null,
    });
    expect(result.channel).toBeNull();
  });

  it('rejects a stray is_active (backend 422 parity, extra="forbid")', () => {
    expect(() =>
      ClientUpdateSchema.parse({
        name: 'Иван', phone: null, email: null, channel: null, is_active: true,
      }),
    ).toThrow();
  });

  it('rejects a missing personal field (required keys)', () => {
    expect(() =>
      ClientUpdateSchema.parse({
        name: 'Иван', phone: null, channel: null,
      } as never),
    ).toThrow();
  });

  it('rejects an invalid channel string', () => {
    expect(() =>
      ClientUpdateSchema.parse({
        name: null, phone: null, email: null,
        channel: 'instagram',
      }),
    ).toThrow();
  });
});

// ─── PaymentResponse ───────────────────────────────────────────────────────

const validPayment = {
  id: 'payment-1',
  record_id: 'record-1',
  amount: 5000,
  method: 'card',
  created_at: '2024-06-01T12:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
};

describe('PaymentResponseSchema', () => {
  it('parses a valid payment response', () => {
    const result = PaymentResponseSchema.parse(validPayment);
    expect(result.id).toBe('payment-1');
    expect(result.record_id).toBe('record-1');
    expect(result.amount).toBe(5000);
    expect(result.method).toBe('card');
  });

  it('parses payment with null method', () => {
    const data = { ...validPayment, method: null };
    const result = PaymentResponseSchema.parse(data);
    expect(result.method).toBeNull();
  });

  it('rejects missing required field', () => {
    const { id, ...without } = validPayment;
    expect(() => PaymentResponseSchema.parse(without)).toThrow();
  });
});

// ─── Type exports compile check ────────────────────────────────────────────

describe('Type exports', () => {
  it('MasterResponse is a valid type', () => {
    const m: MasterResponse = validMaster;
    expect(m.first_name).toBe('Анна');
  });

  it('LocationResponse is a valid type', () => {
    const l: LocationResponse = validLocation;
    expect(l.name).toBe('Студия на Невском');
  });

  it('ServiceResponse is a valid type', () => {
    const s: ServiceResponse = validService;
    expect(s.title).toBe('Мастер-класс по живописи');
  });

  it('ActivityCreate is a valid type', () => {
    const a: ActivityCreate = validActivityCreate;
    expect(a.master_id).toBe('master-1');
  });

  it('ActivityResponse is a valid type', () => {
    const a: ActivityResponse = validActivityResponse;
    expect(a.occupied).toBe(3);
  });

  it('PhotoResponse is a valid type', () => {
    const p: PhotoResponse = validPhoto;
    expect(p.filename).toBe('workshop-2024.jpg');
    expect(p.client_name).toBe('Иван Петров');
  });

  it('VisitResponse is a valid type', () => {
    const v: VisitResponse = validVisit;
    expect(v.record_id).toBe('record-1');
  });

  it('RecordResponse is a valid type', () => {
    const r: RecordResponse = validRecord;
    expect(r.activity_id).toBe('activity-1');
  });

  it('ClientResponse is a valid type', () => {
    const c: ClientResponse = validClient;
    expect(c.name).toBe('Иван Петров');
  });

  it('PaymentResponse is a valid type', () => {
    const p: PaymentResponse = validPayment;
    expect(p.amount).toBe(5000);
  });

  it('ServiceCreate input accepts minimal fields (defaults apply)', () => {
    const s: z.input<typeof ServiceCreateSchema> = {
      title: 'Рисование',
      duration: 120,
    };
    const parsed = ServiceCreateSchema.parse(s);
    expect(parsed.title).toBe('Рисование');
    expect(parsed.description).toBe('');
  });

  it('ServiceUpdate is a valid type', () => {
    const s: ServiceUpdate = {
      title: 'Обновлённое название',
      description: '',
      image_url: '',
      specialty: '',
      min_age: 0,
      max_age: 18,
      duration: 60,
      record_info: '',
      tariffs: [],
      tag_ids: [],
      materials: [],
    };
    expect(s.title).toBe('Обновлённое название');
  });

  it('LocationCreate input accepts minimal fields (defaults apply)', () => {
    const l: z.input<typeof LocationCreateSchema> = {
      name: 'Новая студия',
      capacity: 20,
    };
    const parsed = LocationCreateSchema.parse(l);
    expect(parsed.name).toBe('Новая студия');
    expect(parsed.address).toBe('');
  });

  it('LocationUpdate is a valid type', () => {
    const l: LocationUpdate = {
      name: 'Обновлённая студия',
      short_title: '',
      address: '',
      description: '',
      capacity: 10,
      yandex_map_url: '',
      review_url: '',
      record_info: '',
      image_url: '',
      location_hint: '',
      tag_ids: [],
    };
    expect(l.name).toBe('Обновлённая студия');
  });

  it('TariffCreate input accepts minimal fields', () => {
    const t: z.input<typeof TariffCreateSchema> = {
      title: 'Взрослый',
      price: 2500,
    };
    const parsed = TariffCreateSchema.parse(t);
    expect(parsed.title).toBe('Взрослый');
    expect(parsed.description).toBe('');
  });
});

// ─── TariffCreateSchema ──────────────────────────────────────────────────

const validTariffCreate = {
  title: 'Детский',
  description: 'Билет для ребёнка',
  price: 1500,
};

describe('TariffCreateSchema', () => {
  it('parses a valid tariff create request', () => {
    const result = TariffCreateSchema.parse(validTariffCreate);
    expect(result.title).toBe('Детский');
    expect(result.description).toBe('Билет для ребёнка');
    expect(result.price).toBe(1500);
  });

  it('defaults description to empty string', () => {
    const data = { title: 'Стандарт', price: 2000 };
    const result = TariffCreateSchema.parse(data);
    expect(result.description).toBe('');
  });

  it('rejects negative price', () => {
    const data = { title: 'Бесплатный', price: -100 };
    expect(() => TariffCreateSchema.parse(data)).toThrow();
  });
});

// ─── ServiceCreateSchema ─────────────────────────────────────────────────

const validServiceCreate = {
  title: 'Мастер-класс по глине',
  duration: 90,
};

describe('ServiceCreateSchema', () => {
  it('parses a valid service create request with defaults', () => {
    const result = ServiceCreateSchema.parse(validServiceCreate);
    expect(result.title).toBe('Мастер-класс по глине');
    expect(result.duration).toBe(90);
    expect(result.description).toBe('');
    expect(result.image_url).toBe('');
    expect(result.specialty).toBe('');
    expect(result.min_age).toBe(0);
    expect(result.max_age).toBe(18);
    expect(result.record_info).toBe('');
    expect(result.tariffs).toEqual([]);
    expect(result.tag_ids).toEqual([]);
  });

  it('parses with all fields provided', () => {
    const data = {
      title: 'Рисование маслом',
      description: 'Учимся рисовать',
      image_url: 'https://example.com/img.jpg',
      specialty: 'живопись',
      min_age: 6,
      max_age: 14,
      duration: 180,
      record_info: 'Запись за сутки',
      tariffs: [{ title: 'Взрослый', price: 3000 }],
      tag_ids: ['tag-1', 'tag-2'],
    };
    const result = ServiceCreateSchema.parse(data);
    expect(result.title).toBe('Рисование маслом');
    expect(result.tariffs).toHaveLength(1);
    expect(result.tag_ids).toHaveLength(2);
  });

  it('rejects empty title', () => {
    const data = { title: '', duration: 90 };
    expect(() => ServiceCreateSchema.parse(data)).toThrow();
  });

  it('rejects missing duration', () => {
    const { duration, ...data } = validServiceCreate;
    expect(() => ServiceCreateSchema.parse(data)).toThrow();
  });

  it('rejects duration < 15', () => {
    const data = { title: 'Короткий', duration: 10 };
    expect(() => ServiceCreateSchema.parse(data)).toThrow();
  });

  it('rejects duration > 480', () => {
    const data = { title: 'Длинный', duration: 481 };
    expect(() => ServiceCreateSchema.parse(data)).toThrow();
  });

  // ─── GH #223: materials links on write (spec §4) ───

  it('defaults materials to [] when absent (GH #223)', () => {
    const result = ServiceCreateSchema.parse(validServiceCreate);
    expect(result.materials).toEqual([]);
  });

  it('accepts materials links (GH #223)', () => {
    const data = {
      ...validServiceCreate,
      materials: [{ material_id: 'material-1', note: 'бумага 300 г' }, { material_id: 'material-2' }],
    };
    const result = ServiceCreateSchema.parse(data);
    expect(result.materials).toHaveLength(2);
    expect(result.materials[0]).toEqual({ material_id: 'material-1', note: 'бумага 300 г' });
    expect(result.materials[1].material_id).toBe('material-2');
  });

  it('rejects a materials link without material_id (GH #223)', () => {
    const data = { ...validServiceCreate, materials: [{ note: 'без id' }] };
    expect(() => ServiceCreateSchema.parse(data)).toThrow();
  });
});

// ─── ServiceUpdateSchema ─────────────────────────────────────────────────

describe('ServiceUpdateSchema', () => {
  it('accepts a full canonical update payload', () => {
    const result = ServiceUpdateSchema.parse({
      title: 'Новое название',
      duration: 90,
    });
    expect(result.title).toBe('Новое название');
  });

  it('rejects a stray is_active (backend 422 parity, extra="forbid")', () => {
    expect(() =>
      ServiceUpdateSchema.parse({ title: 'Новое название', duration: 90, is_active: true }),
    ).toThrow();
  });

  it('rejects update missing required create fields', () => {
    expect(() => ServiceUpdateSchema.parse({})).toThrow();
  });

  it('inherits materials from ServiceCreate and defaults to [] (GH #223)', () => {
    const result = ServiceUpdateSchema.parse({ title: 'Новое название', duration: 90 });
    expect(result.materials).toEqual([]);
  });

  it('still rejects an unknown key alongside materials (strict, GH #223)', () => {
    expect(() =>
      ServiceUpdateSchema.parse({
        title: 'Новое название',
        duration: 90,
        materials: [{ material_id: 'material-1' }],
        bogus: true,
      }),
    ).toThrow();
  });
});

// ─── LocationCreateSchema ────────────────────────────────────────────────

const validLocationCreate = {
  name: 'Новая студия',
  capacity: 15,
};

describe('LocationCreateSchema', () => {
  it('parses a valid location create request with defaults', () => {
    const result = LocationCreateSchema.parse(validLocationCreate);
    expect(result.name).toBe('Новая студия');
    expect(result.capacity).toBe(15);
    expect(result.address).toBe('');
    expect(result.description).toBe('');
    expect(result.yandex_map_url).toBe('');
    expect(result.review_url).toBe('');
    expect(result.record_info).toBe('');
    expect(result.image_url).toBe('');
    expect(result.location_hint).toBe('');
    expect(result.tag_ids).toEqual([]);
  });

  it('parses with all fields', () => {
    const data = {
      name: 'Большой зал',
      address: 'ул. Ленина 10',
      description: 'Зал на 50 человек',
      capacity: 50,
      yandex_map_url: 'https://yandex.ru/maps/xxx',
      review_url: 'https://yandex.ru/reviews/xxx',
      record_info: 'Бронирование онлайн',
      image_url: 'https://example.com/hall.jpg',
      location_hint: 'Вход с парковки',
      tag_ids: ['tag-1'],
    };
    const result = LocationCreateSchema.parse(data);
    expect(result.name).toBe('Большой зал');
    expect(result.capacity).toBe(50);
    expect(result.tag_ids).toHaveLength(1);
  });

  it('rejects empty name', () => {
    const data = { name: '', capacity: 15 };
    expect(() => LocationCreateSchema.parse(data)).toThrow();
  });

  it('rejects missing capacity', () => {
    const { capacity, ...data } = validLocationCreate;
    expect(() => LocationCreateSchema.parse(data)).toThrow();
  });

  it('rejects capacity < 1', () => {
    const data = { name: 'Пустая', capacity: 0 };
    expect(() => LocationCreateSchema.parse(data)).toThrow();
  });
});

// ─── LocationUpdateSchema ────────────────────────────────────────────────

describe('LocationUpdateSchema', () => {
  it('accepts a full canonical update payload', () => {
    const result = LocationUpdateSchema.parse({
      name: 'Обновлённое',
      capacity: 20,
    });
    expect(result.name).toBe('Обновлённое');
  });

  it('rejects a stray is_active (backend 422 parity, extra="forbid")', () => {
    expect(() =>
      LocationUpdateSchema.parse({ name: 'Обновлённое', capacity: 20, is_active: true }),
    ).toThrow();
  });

  it('rejects update missing required create fields', () => {
    expect(() => LocationUpdateSchema.parse({})).toThrow();
  });
});

// ─── MasterUpdateSchema ────────────────────────────────────────────────────

describe('MasterUpdateSchema', () => {
  it('accepts a full canonical update payload', () => {
    const result = MasterUpdateSchema.parse({
      first_name: 'Пётр',
      last_name: 'Иванов',
      color: '#AABBCC',
      position: 'мастер',
      specialty: 'живопись',
    });
    expect(result.first_name).toBe('Пётр');
  });

  it('rejects a stray is_active (backend 422 parity, extra="forbid")', () => {
    expect(() =>
      MasterUpdateSchema.parse({
        first_name: 'Пётр',
        last_name: 'Иванов',
        color: '#AABBCC',
        position: 'мастер',
        specialty: 'живопись',
        is_active: true,
      }),
    ).toThrow();
  });
});

// ─── MaterialUpdateSchema ──────────────────────────────────────────────────

describe('MaterialUpdateSchema', () => {
  it('accepts a full canonical update payload', () => {
    const result = MaterialUpdateSchema.parse({ title: 'Глина' });
    expect(result.title).toBe('Глина');
  });

  it('rejects a stray is_active (backend 422 parity, extra="forbid")', () => {
    expect(() => MaterialUpdateSchema.parse({ title: 'Глина', is_active: true })).toThrow();
  });
});

// ─── archived-inversion parity (spec #207 §16) ──────────────────────────────
// Fixtures are serialized by the backend's own Pydantic response schemas
// (same objects FastAPI emits — the dev server on :8000 was unreachable at
// capture time, so the schemas themselves were the source of truth). They
// pin the API contract: responses expose `archived` (true = in archive) and
// never `is_active`; the frontend Zod schemas must round-trip them as-is.
// regenerate (repo root, backend venv):
//   backend/.venv/bin/python packages/api-client/scripts/gen_backend_fixtures.py

describe('archived-inversion parity with backend responses (spec #207 §16)', () => {
  it.each([
    ['master', MasterResponseSchema],
    ['location', LocationResponseSchema],
    ['service', ServiceResponseSchema],
    ['material', MaterialResponseSchema],
    ['client', ClientResponseSchema],
  ] as const)('%s: parses backend response with correct archived polarity', (entity, schema) => {
    const { active, archived } = backendFixtures[entity];
    const parsedActive = schema.parse(active);
    const parsedArchived = schema.parse(archived);
    // Active DB row (is_active=true) serializes to archived=false, and vice versa.
    expect(parsedActive.archived).toBe(false);
    expect(parsedArchived.archived).toBe(true);
  });

  it.each([
    ['master', MasterResponseSchema],
    ['location', LocationResponseSchema],
    ['service', ServiceResponseSchema],
    ['material', MaterialResponseSchema],
    ['client', ClientResponseSchema],
  ] as const)('%s: backend response has archived, never is_active', (entity, schema) => {
    const row = backendFixtures[entity].archived;
    expect(row).toHaveProperty('archived');
    expect(row).not.toHaveProperty('is_active');
    expect(schema.parse(row).archived).toBe(true);
  });

  it('client_with_stats inherits archived from ClientResponse', () => {
    const { active, archived } = backendFixtures.client_with_stats;
    expect(ClientWithStatsSchema.parse(active).archived).toBe(false);
    expect(ClientWithStatsSchema.parse(archived).archived).toBe(true);
    expect(backendFixtures.client_with_stats.archived).not.toHaveProperty('is_active');
  });
});
