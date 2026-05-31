# Web → Backend API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the web frontend (colourmountains.ru) to the real backend API — replace mock data with real API calls, add join layer, implement phone-based booking.

**Architecture:** Backend-first: add missing fields (material_hint, location_hint, photo flags, materials table) + phone-based RecordCreate. Then frontend: join layer (ScheduleIndex with byId + byLocation indexes), React Query hook, replace page integration.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 + TypeScript + Tailwind + React Query (frontend)

---

## Task 1: Backend — Add material_hint to Service, location_hint to Location

**Classification:** small
**Dependencies:** None

**Files:**
- `backend/src/models/service.py` — add `material_hint` column
- `backend/src/models/location.py` — add `location_hint` column
- `backend/src/schemas/service.py` — add `material_hint` to response/output
- `backend/src/schemas/location.py` — add `location_hint` to response/output

**Steps:**
- [ ] Read existing model files to understand current structure
- [ ] In `backend/src/models/service.py`, add after `record_info`:
  ```python
  material_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
  ```
- [ ] In `backend/src/models/location.py`, add after `image_url`:
  ```python
  location_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
  ```
- [ ] In `backend/src/schemas/service.py`, add to ServiceBase (and thus ServiceResponse):
  ```python
  material_hint: str | None = None
  ```
- [ ] In `backend/src/schemas/location.py`, add to LocationBase:
  ```python
  location_hint: str | None = None
  ```
- [ ] Run tests: `cd backend && python -m pytest` — verify no regressions

---

## Task 2: Backend — Add is_public, is_guest to Photo model + Photo schemas

**Classification:** small
**Dependencies:** None

**Files:**
- `backend/src/models/photo.py` — add `is_public`, `is_guest` columns
- `backend/src/schemas/photo.py` — NEW file with PhotoResponse schema
- `backend/src/models/__init__.py` — ensure photo schemas exported (if needed)

**Steps:**
- [ ] Read current `backend/src/models/photo.py`
- [ ] Add import: `from sqlalchemy import Boolean`
- [ ] Add after `activity_id`:
  ```python
  is_public: Mapped[bool] = mapped_column(Boolean, default=False)
  ```
  (Guest categorization uses `photo_tags` join table + tag "guest" — no separate field needed.)
- [ ] Create `backend/src/schemas/photo.py`:
  ```python
  """Pydantic schemas for photos."""
  from pydantic import BaseModel, ConfigDict

  class PhotoResponse(BaseModel):
      model_config = ConfigDict(from_attributes=True)
      id: str
      filename: str
      visitor_id: str | None = None
      service_id: str | None = None
      activity_id: str | None = None
      is_public: bool = False
      created_at: str
      updated_at: str
      is_active: bool
  ```
- [ ] Run tests: `cd backend && python -m pytest`

---

## Task 3: Backend — Photos/web endpoint (public)

**Classification:** small
**Dependencies:** Task 2 (PhotoResponse schema)

**Files:**
- `backend/src/api/v1/photos.py` — NEW router file
- `backend/src/api/v1/__init__.py` or `backend/src/app.py` — register router

**Steps:**
- [ ] Check how other routers are registered (look at `src/app.py`)
- [ ] Create `backend/src/api/v1/photos.py`:
  ```python
  """FastAPI router for photo endpoints."""

  from fastapi import APIRouter, Depends, Query
  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession

  from src.db import SessionDep
  from src.models.photo import Photo
  from src.schemas.photo import PhotoResponse

  router = APIRouter(prefix="/api/v1/photos", tags=["photos"])

  @router.get("/web", response_model=list[PhotoResponse])
  async def list_public_photos(
      activity_id: str | None = Query(None),
      session: SessionDep,
  ) -> list[PhotoResponse]:
      """Return public photos (is_public=true). Optionally filter by activity."""
      stmt = select(Photo).where(Photo.is_public == True, Photo.is_active == True)
      if activity_id:
          stmt = stmt.where(Photo.activity_id == activity_id)
      result = await session.execute(stmt)
      photos = result.scalars().all()
      return [PhotoResponse.model_validate(p) for p in photos]
  ```
- [ ] Register router in the app (find where other routers are included, e.g. `app.include_router(photos_router)`)
- [ ] Test manually: restart backend (`dev.sh --restart`) and call `curl http://localhost:8000/api/v1/photos/web`
- [ ] Run backend tests: `cd backend && python -m pytest`

---

## Task 4: Update api-client schemas for new backend fields

**Classification:** small
**Dependencies:** Tasks 1-2 (backend schema changes must be implemented first)

**Files:**
- `packages/api-client/src/schemas.ts` — add material_hint, location_hint, PhotoResponse

**Steps:**
- [ ] Read current `packages/api-client/src/schemas.ts`
- [ ] Add `material_hint` to `ServiceResponseSchema` after `record_info`:
  ```typescript
  material_hint: z.string().nullable().optional(),
  ```
- [ ] Add `location_hint` to `LocationResponseSchema` after `image_url`:
  ```typescript
  location_hint: z.string().nullable().optional(),
  ```
- [ ] Add `PhotoResponseSchema` after LocationResponse:
  ```typescript
  export const PhotoResponseSchema = z.object({
    id: z.string(),
    filename: z.string(),
    visitor_id: z.string().nullable(),
    service_id: z.string().nullable(),
    activity_id: z.string().nullable(),
    is_public: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    is_active: z.boolean(),
  });
  export type PhotoResponse = z.infer<typeof PhotoResponseSchema>;
  ```
- [ ] Read `packages/api-client/src/endpoints.ts`
- [ ] Add `getWebPhotos` function after `getLocations`:
  ```typescript
  export async function getWebPhotos(params?: { activity_id?: string }): Promise<PhotoResponse[]> {
    const search = new URLSearchParams();
    if (params?.activity_id) search.set('activity_id', params.activity_id);
    const qs = search.toString();
    return api(`/api/v1/photos/web${qs ? `?${qs}` : ''}`, z.array(PhotoResponseSchema));
  }
  ```
  Import `PhotoResponseSchema` and `PhotoResponse` at the top.
- [ ] Update `packages/api-client/src/index.ts` to export `PhotoResponseSchema`, `PhotoResponse`, `getWebPhotos`
- [ ] Run typecheck: `cd packages/api-client && npx tsc --noEmit`

---

## Task 5: Backend — Create Materials table (model + admin, no CRUD router needed for MVP)

**Classification:** standard
**Dependencies:** None

**Files:**
- `backend/src/models/material.py` — NEW ORM model
- `backend/src/schemas/material.py` — NEW Pydantic schemas
- `backend/src/admin/setup.py` — register MaterialAdmin
- `backend/src/models/__init__.py` — export Material

**Steps:**
- [ ] Create `backend/src/models/material.py`:
  ```python
  """Material ORM model for art technique references."""
  from sqlalchemy import String, Text
  from sqlalchemy.orm import Mapped, mapped_column
  from src.models.abstract import AbstractModel

  class Material(AbstractModel):
      __tablename__ = "materials"
      title: Mapped[str] = mapped_column(String(200))
      description: Mapped[str] = mapped_column(Text)
  ```
- [ ] Create `backend/src/schemas/material.py`:
  ```python
  """Pydantic schemas for materials."""
  from pydantic import BaseModel, ConfigDict

  class MaterialBase(BaseModel):
      title: str
      description: str

  class MaterialCreate(MaterialBase):
      pass

  class MaterialUpdate(MaterialBase):
      pass

  class MaterialResponse(MaterialBase):
      model_config = ConfigDict(from_attributes=True)
      id: str
      created_at: str
      updated_at: str
      is_active: bool
  ```
- [ ] In `backend/src/admin/setup.py`, add:
  ```python
  class MaterialAdmin(ModelView, model=Material):
      column_list = ['title', 'description', 'is_active']
  ```
  Register by adding `MaterialAdmin` to the admin list following existing pattern.
- [ ] In `backend/src/models/__init__.py`, add:
  ```python
  from .material import Material
  ```
  And add `'Material'` to `__all__` if it exists.
- [ ] Run tests: `cd backend && python -m pytest`

---

## Task 6: Backend — RecordCreate phone-based flow

**Classification:** standard
**Dependencies:** None

**Files:**
- `backend/src/schemas/record.py` — modify VisitItem + RecordCreate
- `backend/src/services/record.py` — phone-based client/visitor lookup
- `backend/src/models/client.py` — ensure Client has phone-based finder
- Tests: `backend/tests/test_records.py` or similar

**Steps:**
- [ ] Read current `backend/src/schemas/record.py`
- [ ] Replace `VisitItem`:
  ```python
  class VisitItem(BaseModel):
      """Nested visit payload — name-based (for web form)."""
      name: str
      age: int | None = None
      price: int
  ```
- [ ] Modify `RecordCreate`:
  ```python
  class RecordCreate(BaseModel):
      """Create record with phone-based client lookup."""
      activity_id: str
      phone: str
      comment: str | None = None
      visits: list[VisitItem]
  ```
- [ ] Read current `backend/src/services/record.py`
- [ ] Modify `create()` method:
  ```python
  async def create(self, db_session: AsyncSession, data: RecordCreate) -> Record:
      # 1. Find or create Client by phone
      from src.models.client import Client
      from src.models.visitor import Visitor

      result = await db_session.execute(
          select(Client).where(Client.phone == data.phone)
      )
      client = result.scalar_one_or_none()
      if not client:
          # Create new client with first visitor's name
          first_name = data.visits[0].name if data.visits else "Гость"
          client = Client(
              phone=data.phone,
              name=first_name,
              channel="website",
          )
          db_session.add(client)
          await db_session.flush()

      # 2. Find or create Visitors
      visitor_ids: list[str] = []
      for item in data.visits:
          result = await db_session.execute(
              select(Visitor).where(
                  Visitor.client_id == client.id,
                  Visitor.name == item.name,
              )
          )
          visitor = result.scalar_one_or_none()
          if not visitor:
              visitor = Visitor(
                  client_id=client.id,
                  name=item.name,
                  age=item.age,
              )
              db_session.add(visitor)
              await db_session.flush()
          visitor_ids.append(visitor.id)

      # 3. Create Record
      record = Record(
          activity_id=data.activity_id,
          client_id=client.id,
          status="pending",
          seats=len(data.visits),
          comment=data.comment,
      )
      db_session.add(record)
      await db_session.flush()

      # 4. Create Visits
      for i, item in enumerate(data.visits):
          visit = Visit(
              record_id=record.id,
              visitor_id=visitor_ids[i],
              price=item.price,
              status="waiting",
          )
          db_session.add(visit)

      await db_session.flush()
      await db_session.refresh(record)
      return record
  ```
  Need to add `from sqlalchemy import select` import if not present.
- [ ] Write test: `POST /api/v1/records` with phone, verify client+visitor+record created
- [ ] Run tests: `cd backend && python -m pytest`

---

## Task 7: Backend — Seed data update

**Classification:** standard
**Dependencies:** Tasks 1-5 (models/schemas must exist)

**Files:**
- `backend/src/seed/seed.py`

**Steps:**
- [ ] Read current seed file
- [ ] Update `_seed_services`: add `material_hint` and `image_url` to each service
  ```python
  {"id": "s1", "title": "Картина маслом", "description": "Масляная живопись на холсте",
   "image_url": "/images/card-seascape.jpg", "specialty": "живопись",
   "min_age": 12, "max_age": 99, "duration": 150, "record_info": "",
   "material_hint": "Масляные краски, холст на подрамнике 40×50 см, набор кистей, мастихин"},
  {"id": "s2", "title": "Картина акрилом", "description": "Акриловая живопись на холсте",
   "image_url": "/images/card-mountain-acrylic.jpg", "specialty": "живопись",
   "min_age": 6, "max_age": 99, "duration": 120, "record_info": "",
   "material_hint": "Акриловые краски, холст 30×40 см, кисти, палитра"},
  {"id": "s3", "title": "Мини-картина акрилом", "description": "Миниатюра акрилом на маленьком холсте",
   "image_url": "/images/card-watercolor.jpg", "specialty": "живопись",
   "min_age": 6, "max_age": 99, "duration": 90, "record_info": "",
   "material_hint": "Акриловые краски, холст 20×30 см, кисти"},
  {"id": "s4", "title": "Акварель", "description": "Акварельная живопись",
   "image_url": "/images/card-watercolor.jpg", "specialty": "живопись",
   "min_age": 6, "max_age": 12, "duration": 150, "record_info": "",
   "material_hint": "Акварельные краски, бумага A3 300 г/м², кисти"},
  {"id": "s5", "title": "Ручная лепка", "description": "Лепка из глины",
   "image_url": "/images/card-animals.jpg", "specialty": "керамика",
   "min_age": 5, "max_age": 99, "duration": 90, "record_info": "",
   "material_hint": "Глина, стек, вода, фартук"},
  {"id": "s6", "title": "Роспись одежды", "description": "Роспись футболки или шоппера",
   "image_url": "/images/card-shopper.jpg", "specialty": "живопись",
   "min_age": 8, "max_age": 99, "duration": 120, "record_info": "",
   "material_hint": "Текстильные краски, шоппер из хлопка, трафареты, кисти"},
  {"id": "s7", "title": "Морской пейзаж", "description": "Морской пейзаж маслом",
   "image_url": "/images/card-seascape.jpg", "specialty": "живопись",
   "min_age": 12, "max_age": 99, "duration": 180, "record_info": "",
   "material_hint": "Масляные краски, холст 50×60 см, набор кистей, мастихин"},
  ```
- [ ] Update `_seed_locations`: add `location_hint`:
  ```python
  {"id": "alpika", "name": "Альпика", "address": "Альпика, 1 этаж", "capacity": 10,
   "location_hint": "1 этаж, светлая студия с панорамными окнами"},
  {"id": "grand", "name": "Гранд Отель Поляна", "address": "Гранд Отель, лобби", "capacity": 12,
   "location_hint": "Лобби отеля, зона у ресепшн"},
  {"id": "p1389", "name": "Поляна 1389", "address": "Поляна 1389, 2 этаж", "capacity": 8,
   "location_hint": "2 этаж, рядом с детской зоной"},
  ```
- [ ] Add `_seed_service_tags` after `_seed_tags`:
  ```python
  async def _seed_service_tags(session) -> None:
      """Link services to tags via service_tags join table."""
      from src.models.tag import service_tags
      # s1 (Картина маслом) → хит, взрослым
      # s2 (Картина акрилом) → популярное
      # s4 (Акварель) → для детей
      # etc.
      links = [
          ("s1", "tag2"),  # хит
          ("s1", "tag4"),  # популярное
          ("s2", "tag4"),  # популярное
          ("s4", "tag3"),  # для детей
          ("s5", "tag3"),  # для детей
          ("s7", "tag1"),  # новинка
          ("s7", "tag2"),  # хит
      ]
      for service_id, tag_id in links:
          result = await session.execute(
              select(service_tags).where(
                  service_tags.c.service_id == service_id,
                  service_tags.c.tag_id == tag_id,
              )
          )
          if not result.first():
              await session.execute(
                  service_tags.insert().values(service_id=service_id, tag_id=tag_id)
              )
  ```
- [ ] Add `_seed_activity_tags` after activities:
  ```python
  async def _seed_activity_tags(session) -> None:
      """Link activities to tags."""
      from src.models.tag import activity_tags
      # ev_0 (Морской пейзаж) → новинка
      links = [
          ("ev_0", "tag1"),  # новинка
          ("ev_0", "tag6"),  # сезонное
      ]
      for activity_id, tag_id in links:
          result = await session.execute(
              select(activity_tags).where(
                  activity_tags.c.activity_id == activity_id,
                  activity_tags.c.tag_id == tag_id,
              )
          )
          if not result.first():
              await session.execute(
                  activity_tags.insert().values(activity_id=activity_id, tag_id=tag_id)
              )
  ```
- [ ] Add `_seed_photos`:
  ```python
  async def _seed_photos(session) -> None:
      """Seed public photos linked to services/activities."""
      from src.models.photo import Photo
      photos = [
          {"id": "ph1", "filename": "/images/card-seascape.jpg", "service_id": "s1",
           "activity_id": None, "is_public": True},
          {"id": "ph2", "filename": "/images/card-mountain-acrylic.jpg", "service_id": "s2",
           "activity_id": None, "is_public": True},
          {"id": "ph3", "filename": "/images/card-watercolor.jpg", "service_id": "s4",
           "activity_id": None, "is_public": True},
          {"id": "ph4", "filename": "/images/card-family.jpg", "service_id": "s5",
           "activity_id": None, "is_public": True},
          {"id": "ph5", "filename": "/images/card-shopper.jpg", "service_id": "s6",
           "activity_id": None, "is_public": True},
          {"id": "ph6", "filename": "/images/guest-1.jpg", "service_id": None,
           "activity_id": "ev_0", "is_public": True},
          {"id": "ph7", "filename": "/images/guest-2.jpg", "service_id": None,
           "activity_id": "ev_4", "is_public": True},
      ]
      # After seeding photos, tag ph6, ph7 as "гость" via photo_tags
      from src.models.tag import photo_tags
      for photo_id in ["ph6", "ph7"]:
          result = await session.execute(
              select(photo_tags).where(
                  photo_tags.c.photo_id == photo_id,
                  photo_tags.c.tag_id == "tag7",  # tag7 = "гость"
              )
          )
          if not result.first():
              await session.execute(
                  photo_tags.insert().values(photo_id=photo_id, tag_id="tag7")
              )
  ```
  Need to add `from sqlalchemy import select` if not already imported.
      for p in photos:
          if not await _exists(session, Photo, p["id"]):
              session.add(Photo(**p))
  ```
- [ ] Update `_seed_tags`: add tag "гость" (tag7):
  ```python
  tag_names = ["новинка", "хит", "для детей", "популярное", "индивидуальное", "сезонное", "гость"]
  ```
  ```python
  async def _seed_materials(session) -> None:
      from src.models.material import Material
      materials = [
          {"id": "mat1", "title": "Масло", "description": "Масляные краски — классика живописи. Густые, насыщенные, сохнут долго."},
          {"id": "mat2", "title": "Акрил", "description": "Акриловые краски — быстросохнущие, яркие, подходят для любых поверхностей."},
          {"id": "mat3", "title": "Акварель", "description": "Акварельные краски — прозрачные, нежные, требуют специальной бумаги."},
          {"id": "mat4", "title": "Гуашь", "description": "Гуашь — плотные матовые краски на водной основе, идеальны для детей."},
      ]
      for m in materials:
          if not await _exists(session, Material, m["id"]):
              session.add(Material(**m))
  ```
- [ ] Update `seed_data()` to call the new seed functions in order: `_seed_service_tags`, `_seed_activity_tags`, `_seed_photos`, `_seed_materials`
- [ ] Add necessary imports at top of file: `from src.models.material import Material`, `from src.models.tag import service_tags, activity_tags`
- [ ] Re-seed: `cd backend && uv run python -m seed.seed`
- [ ] Verify: `curl http://localhost:8000/api/v1/services/s1` shows `material_hint`, `image_url`
- [ ] Run tests: `cd backend && python -m pytest`

---

## Task 8: Frontend — ScheduleDTO + ScheduleView + PhotoDTO models

**Classification:** small
**Dependencies:** None

**Files:**
- `frontend/web/app/lib/model/dto/schedule.ts` — NEW (replaces `activity.ts`)
- `frontend/web/app/lib/model/view/schedule.ts` — NEW (replaces `activity.ts`)
- `frontend/web/app/lib/model/dto/photo.ts` — NEW

**Steps:**
- [ ] Read existing `frontend/web/app/lib/model/dto/activity.ts` and `view/activity.ts` for reference
- [ ] Create `frontend/web/app/lib/model/dto/schedule.ts`:
  ```typescript
  export interface PhotoDTO {
    url: string;
    isPublic: boolean;
    tags: string[];  // from photo_tags — e.g. ["гость"]
  }
  ```
  Note: `material` and `size` are kept for backward compat with existing components; they can be populated from `material_hint` or kept as empty strings. Remove them once components migrate.
- [ ] Create `frontend/web/app/lib/model/dto/photo.ts`:
  ```typescript
  export interface WebPhotoResponse {
    id: string;
    filename: string;
    activity_id: string | null;
    is_public: boolean;
    is_guest: boolean;
  }
  ```
- [ ] Create `frontend/web/app/lib/model/view/schedule.ts`:
  ```typescript
  export type ActivityTag = 'взрослым' | 'вместе' | 'детям';

  export interface NextTimeOption {
    id: string;
    date: string;
    time: string;
  }

  export interface ScheduleView {
    id: string;
    title: string;
    tags: string[];
    imageUrl: string;
    photos: { url: string; isPublic: boolean; tags: string[] }[];
    time: string;
    duration: string;
    location: { id: string; name: string; address?: string };
    guestsCount: number;
    material: string;
    size: string;
    priceMin: number;
    priceMax: number;
    masterName: string;
    masterAvatar?: string;
    date: string;
    priceFormatted: string;
    dateFormatted: string;
    tagColors: string[];
    nextTimes?: NextTimeOption[];
    priceHint?: string;
    materialHint?: string;
    locationHint?: string;
  }

  export interface ScheduleCardView {
    id: string;
    imageUrl: string;
    tags: string[];
    title: string;
    time: string;
    duration: string;
    guestsCount: number;
    priceMin: number;
    priceMax: number;
  }

  export interface ScheduleFiltersView {
    date?: string;
    dateStart?: string;
    dateEnd?: string;
    location?: string;
    tag?: string;
  }
  ```

---

## Task 9: Frontend — API functions (photos + records)

**Classification:** small
**Dependencies:** None

**Files:**
- `frontend/web/app/lib/api/photos.ts` — NEW
- `frontend/web/app/lib/api/records.ts` — NEW (replaces createBooking in activities.ts)
- `packages/api-client/src/endpoints.ts` — add createRecord with phone

**Steps:**
- [ ] Create `frontend/web/app/lib/api/photos.ts`:
  ```typescript
  import { apiClient, buildQueryString } from './client';
  import type { WebPhotoResponse } from '@/app/lib/model/dto/photo';

  export async function fetchWebPhotos(params?: {
    activity_id?: string;
  }): Promise<WebPhotoResponse[]> {
    const qs = buildQueryString({ activity_id: params?.activity_id });
    return apiClient<WebPhotoResponse[]>(`/api/v1/photos/web${qs}`);
  }
  ```
- [ ] Create `frontend/web/app/lib/api/records.ts`:
  ```typescript
  import { apiClient } from './client';

  export interface BookingData {
    activityId: string;
    phone: string;
    name: string;
    childCount: number;
    adultCount: number;
    comment?: string;
    priceTotal: number;
  }

  export async function createRecord(data: BookingData): Promise<{ success: boolean; recordId: string }> {
    const visits: { name: string; age: number | null; price: number }[] = [];
    const adultPrice = Math.round(data.priceTotal / (data.adultCount + data.childCount));

    for (let i = 0; i < data.adultCount; i++) {
      visits.push({ name: data.name, age: null, price: adultPrice });
    }
    for (let i = 0; i < data.childCount; i++) {
      visits.push({ name: `${data.name} (ребёнок)`, age: null, price: adultPrice });
    }

    const body = {
      activity_id: data.activityId,
      phone: data.phone,
      comment: data.comment ?? null,
      visits,
    };

    const result = await apiClient<{ id: string }>('/api/v1/records', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return { success: true, recordId: result.id };
  }
  ```

---

## Task 10: Frontend — joinActivities() mapper (ScheduleIndex)

**Classification:** standard
**Dependencies:** Task 8 (ScheduleDTO)

**Files:**
- `frontend/web/app/lib/mappers/join-schedule.ts` — NEW

**Steps:**
- [ ] Create `frontend/web/app/lib/mappers/join-schedule.ts`:
  ```typescript
  import type { ActivityResponse } from '@memo/api-client';
  import type { MasterResponse } from '@memo/api-client';
  import type { ServiceResponse } from '@memo/api-client';
  import type { LocationResponse } from '@memo/api-client';
  import type { ScheduleDTO } from '@/app/lib/model/dto/schedule';

  export interface LocationIndex {
    byDate: Map<string, string[]>;
    byServiceId: Map<string, string[]>;
  }

  export interface ScheduleIndex {
    byId: Map<string, ScheduleDTO>;
    byLocation: Record<string, LocationIndex>;
  }

  function extractTime(iso: string): string {
    return iso.slice(11, 16); // "2026-06-01T10:00:00" → "10:00"
  }

  function extractDate(iso: string): string {
    return iso.slice(0, 10); // "2026-06-01T10:00:00" → "2026-06-01"
  }

  function computePriceHint(tariffs: { title: string; price: number }[]): string {
    return tariffs.map(t => `${t.title}: ${t.price}₽`).join(', ');
  }

  function buildTagSet(serviceTags: { tag: string }[], activityTags: { tag: string }[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of [...serviceTags, ...activityTags]) {
      if (!seen.has(t.tag)) {
        seen.add(t.tag);
        result.push(t.tag);
      }
    }
    return result;
  }

  export function joinActivities(
    activities: ActivityResponse[],
    services: Map<string, ServiceResponse>,
    masters: Map<string, MasterResponse>,
    locations: Map<string, LocationResponse>,
  ): ScheduleIndex {
    const byId = new Map<string, ScheduleDTO>();
    const locationIds = new Set<string>();

    // Phase 1: Build all ScheduleDTOs
    for (const act of activities) {
      const service = services.get(act.service_id);
      const master = masters.get(act.master_id);
      const location = locations.get(act.location_id);

      if (!service || !master || !location) continue;

      const tariffs = service.tariffs ?? [];
      const prices = tariffs.map(t => t.price);
      const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
      const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

      const dto: ScheduleDTO = {
        id: act.id,
        title: service.title,
        tags: buildTagSet(service.tags ?? [], []),
        image_url: service.image_url || '',
        photos: [],
        time: extractTime(act.start),
        duration_minutes: act.duration,
        location_id: act.location_id,
        location_name: location.name,
        location_address: location.address ?? undefined,
        guests_count: act.occupied,
        material: service.material_hint?.split(',')[0]?.trim() ?? '',
        size: '',
        price_min: priceMin,
        price_max: priceMax,
        master_name: `${master.first_name} ${master.last_name}`,
        master_avatar: master.avatar_url ?? undefined,
        date: extractDate(act.start),
        price_hint: computePriceHint(tariffs),
        material_hint: service.material_hint ?? undefined,
        location_hint: location.location_hint ?? undefined,
      };

      byId.set(act.id, dto);
      locationIds.add(act.location_id);
    }

    // Phase 2: Build location indexes
    const allLocIds = ['all', ...locationIds];
    const byLocation: Record<string, LocationIndex> = {};

    for (const locId of allLocIds) {
      byLocation[locId] = {
        byDate: new Map(),
        byServiceId: new Map(),
      };
    }

    for (const [id, dto] of byId) {
      // Index in location-specific + 'all'
      const locKeys = ['all', dto.location_id];
      for (const locKey of locKeys) {
        const idx = byLocation[locKey];

        // byDate
        const dateArr = idx.byDate.get(dto.date) ?? [];
        dateArr.push(id);
        idx.byDate.set(dto.date, dateArr);

        // byServiceId (map service title as proxy, or use actual service_id)
        // We use the title as a key since backend service_id is not in DTO
        const svcKey = dto.title;
        const svcArr = idx.byServiceId.get(svcKey) ?? [];
        svcArr.push(id);
        idx.byServiceId.set(svcKey, svcArr);
      }
    }

    // Phase 3: Compute next_times for each DTO
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    for (const [id, dto] of byId) {
      const locIdx = byLocation[dto.location_id];
      const svcIds = locIdx.byServiceId.get(dto.title) ?? [];

      const nextIds = svcIds
        .map(sid => byId.get(sid)!)
        .filter(a => a.id !== id && a.date >= todayStr && (a.date > dto.date || (a.date === dto.date && a.time > dto.time)))
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
        .slice(0, 6)
        .map(a => ({ id: a.id, date: a.date, time: a.time }));

      if (nextIds.length > 0) {
        dto.next_times = nextIds;
      }
    }

    return { byId, byLocation };
  }
  ```
- [ ] Write a unit test for `joinActivities`: create mock ActivityResponse, ServiceResponse etc inputs, verify ScheduleIndex structure

---

## Task 11: Frontend — toScheduleView() mapper

**Classification:** small
**Dependencies:** Task 7, Task 9

**Files:**
- `frontend/web/app/lib/mappers/to-schedule-vm.ts` — NEW
- `frontend/web/app/lib/mappers/format.ts` — reuse existing format functions

**Steps:**
- [ ] Create `frontend/web/app/lib/mappers/to-schedule-vm.ts`:
  ```typescript
  import type { ScheduleDTO } from '@/app/lib/model/dto/schedule';
  import type { ScheduleView } from '@/app/lib/model/view/schedule';
  import { formatPrice, formatDate, formatDuration } from '@/app/lib/mappers/format';

  const TAG_COLORS: Record<string, string> = {
    'новинка': '#C49A2E',
    'хит': '#D4789A',
    'для детей': '#5B8C7A',
    'популярное': '#7A6E9C',
    'индивидуальное': '#8A7840',
    'сезонное': '#6B7E9C',
  };

  function getTagColors(tags: string[]): string[] {
    return tags.map(t => TAG_COLORS[t] || '#888888');
  }

  export function toScheduleView(raw: ScheduleDTO): ScheduleView {
    return {
      id: raw.id,
      title: raw.title,
      tags: raw.tags,
      imageUrl: raw.image_url,
      photos: raw.photos,
      time: raw.time,
      duration: formatDuration(raw.duration_minutes),
      location: { id: raw.location_id, name: raw.location_name, address: raw.location_address },
      guestsCount: raw.guests_count,
      material: raw.material || '',
      size: raw.size || '',
      priceMin: raw.price_min,
      priceMax: raw.price_max,
      masterName: raw.master_name,
      masterAvatar: raw.master_avatar,
      date: raw.date,
      priceFormatted: formatPrice(raw.price_min, raw.price_max),
      dateFormatted: formatDate(raw.date),
      tagColors: getTagColors(raw.tags),
      nextTimes: raw.next_times,
      priceHint: raw.price_hint,
      materialHint: raw.material_hint,
      locationHint: raw.location_hint,
    };
  }

  export function toCardProps(vm: ScheduleView): ScheduleView['id'] & {
    imageUrl: string;
    tags: string[];
    title: string;
    time: string;
    duration: string;
    guestsCount: number;
    priceMin: number;
    priceMax: number;
  } {
    return {
      id: vm.id,
      imageUrl: vm.imageUrl,
      tags: vm.tags,
      title: vm.title,
      time: vm.time,
      duration: vm.duration,
      guestsCount: vm.guestsCount,
      priceMin: vm.priceMin,
      priceMax: vm.priceMax,
    };
  }
  ```
- [ ] Write a unit test for `toScheduleView` with a mock ScheduleDTO

---

## Task 12: Frontend — useSchedule() hook

**Classification:** standard
**Dependencies:** Tasks 7-10

**Files:**
- `frontend/web/app/hooks/useSchedule.ts` — NEW
- `frontend/web/app/query/` — may need React Query provider setup

**Steps:**
- [ ] Install React Query: `cd frontend && npm install @tanstack/react-query`
- [ ] Read `frontend/web/app/layout.tsx` to find the root layout
- [ ] Create or update `frontend/web/app/providers.tsx` (NEW):
  ```typescript
  'use client';

  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { ReactNode } from 'react';

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  export function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }
  ```
- [ ] In `frontend/web/app/layout.tsx`, wrap the layout's children with `<Providers>`:
  ```typescript
  import { Providers } from './providers';
  // ... inside the layout return:
  <Providers>{children}</Providers>
  ```
- [ ] Create `frontend/web/app/hooks/useSchedule.ts`:
  ```typescript
  'use client';

  import { useMemo, useCallback } from 'react';
  import { useQueries } from '@tanstack/react-query';
  import { getActivities, getMasters, getServices, getLocations } from '@memo/api-client';
  import { joinActivities, type ScheduleIndex } from '@/app/lib/mappers/join-schedule';
  import { toScheduleView } from '@/app/lib/mappers/to-schedule-vm';
  import type { ScheduleView, ScheduleFiltersView } from '@/app/lib/model/view/schedule';
  import { ApiError } from '@/app/lib/errors';

  export interface UseScheduleResult {
    schedules: ScheduleView[];
    getByDate: (date: string, locationId?: string) => ScheduleView[];
    isLoading: boolean;
    error: ApiError | null;
  }

  function computeDateRange(filters: ScheduleFiltersView): { date_from: string; date_to: string } {
    // Default: show 30 days from today
    const today = new Date();
    const dateFrom = filters.dateStart ?? today.toISOString().slice(0, 10);
    const dateTo = filters.dateEnd ?? new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { date_from: dateFrom, date_to: dateTo };
  }

  export function useSchedule(filters: ScheduleFiltersView = {}): UseScheduleResult {
    const { date_from, date_to } = computeDateRange(filters);

    const queries = useQueries({
      queries: [
        {
          queryKey: ['activities', date_from, date_to],
          queryFn: () => getActivities({ date_from, date_to }),
          staleTime: 0,
          refetchInterval: 60_000,
        },
        {
          queryKey: ['services'],
          queryFn: () => getServices(),
          staleTime: 300_000,
          gcTime: 600_000,
        },
        {
          queryKey: ['masters'],
          queryFn: () => getMasters(),
          staleTime: 300_000,
          gcTime: 600_000,
        },
        {
          queryKey: ['locations'],
          queryFn: () => getLocations(),
          staleTime: 300_000,
          gcTime: 600_000,
        },
      ],
    });

    const index: ScheduleIndex | null = useMemo(() => {
      if (queries.some(q => q.isLoading || q.isError)) return null;
      const [activities, services, masters, locations] = queries.map(q => q.data!);
      return joinActivities(
        activities,
        new Map(services.map(s => [s.id, s])),
        new Map(masters.map(m => [m.id, m])),
        new Map(locations.map(l => [l.id, l])),
      );
    }, [queries.map(q => q.data)]);

    const allSchedules: ScheduleView[] = useMemo(() => {
      if (!index) return [];
      return [...index.byId.values()].map(toScheduleView);
    }, [index]);

    const getByDate = useCallback(
      (date: string, locationId = 'all'): ScheduleView[] => {
        if (!index) return [];
        const ids = index.byLocation[locationId]?.byDate.get(date) ?? [];
        return ids.map(id => toScheduleView(index.byId.get(id)!)).filter(Boolean);
      },
      [index],
    );

    const error = queries.find(q => q.error)?.error;
    const apiError = error instanceof ApiError ? error : error ? new ApiError(String(error), 500) : null;

    return {
      schedules: allSchedules,
      getByDate,
      isLoading: queries.some(q => q.isLoading),
      error: apiError,
    };
  }
  ```

---

## Task 13: Frontend — Page integration (replace old useActivities)

**Classification:** standard
**Dependencies:** Task 11 (useSchedule hook)

**Files:**
- `frontend/web/app/page.tsx` — replace imports and hook usage
- `frontend/web/app/lib/api/activities.ts` — deprecate old mock functions (keep fetchActivities/useActivities for reference, remove makeMockActivities)

**Steps:**
- [ ] In `frontend/web/app/page.tsx`:
  - Replace `import { useActivities } from './hooks/useActivities'` with `import { useSchedule } from './hooks/useSchedule'`
  - Replace `import { toActivityView } from './lib/mappers/to-activity-vm'` with `import { toScheduleView } from './lib/mappers/to-schedule-vm'` (or remove if using hook directly)
  - Replace `const { activities, isLoading, error } = useActivities(...)` with `const { schedules, getByDate, isLoading, error } = useSchedule(...)`
  - Replace `allActivities` → `schedules`
  - Replace `toCardProps` to use ScheduleCardView shape
  - Replace `handleSelectCard` to find in `schedules` instead of `allActivities`
  - Update any references to `category` → `tags`, `teacherName` → `masterName`, etc.
- [ ] Update components that reference old view types:
  - Check `MKCarousel`, `ActivityDetail`, `BookingPrivateOverlay`, `ActivityTagFilter` for usage of `ActivityView`, `ActivityCardView`, `ActivityFiltersView`
  - Replace with `ScheduleView`, `ScheduleCardView`, `ScheduleFiltersView`
- [ ] In `frontend/web/app/lib/api/activities.ts`:
  - Remove `makeMockActivities()` function
  - Remove `ACTIVITY_TEMPLATES` array
  - Remove `ActivityAPI` interface
  - Remove `getActivities()` mock implementation (keep only if used elsewhere as fallback)
  - Remove `createBooking()` (replaced by `createRecord` in records.ts)
- [ ] Remove old model files: `activity.ts` (dto + view) once no components reference them
- [ ] Run frontend tests: `cd frontend && npm run test`

---

## Task 14: Frontend — Testing the integration

**Classification:** standard
**Dependencies:** Tasks 7-12

**Files:**
- `frontend/web/app/lib/mappers/__tests__/join-schedule.test.ts` — NEW
- `frontend/web/app/lib/mappers/__tests__/to-schedule-vm.test.ts` — NEW

**Steps:**
- [ ] Write test for `join-schedule.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { joinActivities } from '../join-schedule';
  import type { ActivityResponse, ServiceResponse, MasterResponse, LocationResponse } from '@memo/api-client';

  const mockMaster: MasterResponse = {
    id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A',
    position: 'мастер', specialty: 'живопись', avatar_url: null,
    is_active: true, created_at: '', updated_at: '',
  };

  const mockService: ServiceResponse = {
    id: 's1', title: 'Картина маслом', description: 'Масляная живопись',
    image_url: '/img.jpg', specialty: 'живопись',
    min_age: 12, max_age: 99, duration: 150, record_info: '',
    is_active: true, created_at: '', updated_at: '',
    material_hint: 'Масло, холст 40×50',
    tariffs: [{ id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 3500 }],
    tags: [{ id: 'tag2', tag: 'хит' }],
  };

  const mockLocation: LocationResponse = {
    id: 'alpika', name: 'Альпика', address: 'Адрес', description: null,
    capacity: 10, yandex_map_url: null, review_url: null,
    record_info: null, image_url: null,
    is_active: true, created_at: '', updated_at: '',
    location_hint: '1 этаж',
  };

  const mockActivity: ActivityResponse = {
    id: 'ev_0', master_id: 'm1', service_id: 's1', location_id: 'alpika',
    start: '2026-06-01T10:00:00', duration: 150, capacity: 8,
    is_private: false, comment: null, record_info: null,
    is_active: true, occupied: 2, created_at: '', updated_at: '',
  };

  describe('joinActivities', () => {
    it('creates ScheduleIndex with correct structure', () => {
      const result = joinActivities(
        [mockActivity],
        new Map([['s1', mockService]]),
        new Map([['m1', mockMaster]]),
        new Map([['alpika', mockLocation]]),
      );

      expect(result.byId.has('ev_0')).toBe(true);
      expect(result.byLocation['all'].byDate.has('2026-06-01')).toBe(true);
      expect(result.byLocation['alpika'].byDate.has('2026-06-01')).toBe(true);
      expect(result.byLocation['all'].byServiceId.has('Картина маслом')).toBe(true);

      const dto = result.byId.get('ev_0')!;
      expect(dto.title).toBe('Картина маслом');
      expect(dto.tags).toEqual(['хит']);
      expect(dto.master_name).toBe('Ольга Середа');
      expect(dto.price_min).toBe(3500);
      expect(dto.price_max).toBe(3500);
      expect(dto.time).toBe('10:00');
      expect(dto.date).toBe('2026-06-01');
    });

    it('skips activities with missing reference data', () => {
      const result = joinActivities(
        [mockActivity],
        new Map(), // no services
        new Map([['m1', mockMaster]]),
        new Map([['alpika', mockLocation]]),
      );
      expect(result.byId.size).toBe(0);
    });
  });
  ```
- [ ] Write test for `to-schedule-vm.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { toScheduleView } from '../to-schedule-vm';
  import type { ScheduleDTO } from '@/app/lib/model/dto/schedule';

  const mockDTO: ScheduleDTO = {
    id: 'ev_0', title: 'Картина маслом', tags: ['хит'],
    image_url: '/img.jpg', photos: [],
    time: '10:00', duration_minutes: 150,
    location_id: 'alpika', location_name: 'Альпика', location_address: 'Адрес',
    guests_count: 2, material: 'Масло', size: '40×50',
    price_min: 3500, price_max: 5000,
    master_name: 'Ольга Середа', master_avatar: undefined,
    date: '2026-06-01',
    price_hint: 'Взрослый: 3500₽', material_hint: 'Масло, холст 40×50', location_hint: '1 этаж',
  };

  describe('toScheduleView', () => {
    it('maps all fields correctly', () => {
      const view = toScheduleView(mockDTO);
      expect(view.title).toBe('Картина маслом');
      expect(view.tags).toEqual(['хит']);
      expect(view.priceFormatted).toBe('от 3 500₽');
      expect(view.duration).toBe('2 ч 30 мин');
      expect(view.masterName).toBe('Ольга Середа');
      expect(view.priceHint).toBe('Взрослый: 3500₽');
    });
  });
  ```
- [ ] Run frontend tests: `cd frontend && npm run test`

---

## Visual Compliance Checks

After all tasks complete:

- [ ] Backend: `curl http://localhost:8000/api/v1/services/s1` shows `material_hint` and `image_url`
- [ ] Backend: `curl http://localhost:8000/api/v1/photos/web` returns public photos
- [ ] Backend: `curl -X POST http://localhost:8000/api/v1/records -H 'Content-Type: application/json' -d '{"activity_id":"ev_0","phone":"+79999999999","visits":[{"name":"Тест","price":3500}]}'` creates record
- [ ] Frontend loads without errors, shows real data from backend
- [ ] `getByDate('2026-06-01', 'alpika')` returns 3-5 ScheduleView items
- [ ] Cards show tags, master name, correct prices
- [ ] Booking flow works end to end
