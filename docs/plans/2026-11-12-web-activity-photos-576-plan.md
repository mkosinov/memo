# План: публичные фото услуги и её занятий в деталях расписания web (#576)

## Goal

Гость, открыв детали занятия в веб-расписании, видит под главной картинкой
(обложка услуги) ряд миниатюр: публичные прямые фото услуги, затем публичные
фото её занятий; клик по миниатюре ставит её в главную; нет фото — ряда нет.
Один новый фильтр `service_id` на `GET /api/v1/public/photos` (объединяющая
семантика variant A + двухгрупповой порядок). Спека:
`docs/specs/2026-11-12-web-activity-photos-576-design.md` (рев.3).

## Architecture

Бэкенд: новый параметрический кирпич `PublicPhotoListParams(PaginationParams)`
на публичном маршруте; `list_public_photos_view` при `service_id` собирает
объединяющий предикат (переиспользуется ветка variant A общего билдера) и
кастомный двухгрупповой `order_by` для разделяемого list-core. api-client:
`service_id` в `PhotoPublicListParams`. Web: `serviceId` протягивается вниз по
модели расписания; мёртвая цепочка `photos`/`guestPhotos` удаляется; хук
`useServicePhotos` (один запрос, `per_page=20`); полоса миниатюр в
`ActivityDetail` с a11y-контрактом и машинными хинтами.

Примечание (гейт C): дом-правило композиции галереи уже внесено в
`docs/domain-rules/photos.md` и влито в main вместе со спекой (856fc5eb,
канон: дом-правила едут со спекой) — отдельной задачи IMPL не требует;
`Required Docs` ниже указывает его как контекст для чтения.

## Tech Stack

FastAPI + SQLAlchemy (бэкенд), TypeScript + React + TanStack Query (web),
Playwright (e2e), Vitest (юниты web/api-client), pytest (бэкенд).

## Task 1: Бэкенд — фильтр `service_id` на публичной витрине

### Classification: standard

### Required Docs

- `docs/domain-rules/photos.md` — секция API Endpoints (строка
  `GET /api/v1/public/photos`), Business Logic/Backend (variant A, порядок).
- `docs/specs/2026-11-12-web-activity-photos-576-design.md` §6.1.

### Шаги

1. `backend/src/schemas/photo.py`: класс `PublicPhotoListParams(PaginationParams)`
   с единственным полем `service_id: str | None = None` (докстринг: почему не
   `PhotoListParams` — активация админ-фильтров на анонимном маршруте).
2. `backend/src/api/v1/public.py`: маршрут переключается на
   `Annotated[PublicPhotoListParams, Query()]`; фильтр пробрасывается в
   `list_public_photos_view`; докстринг маршрута обновить (семантика, порядок).
3. `backend/src/services/photo.py`, `list_public_photos_view`: при заданном
   `service_id` — `PhotoListParams(service_id=..., is_public=True)` (ветка
   variant A с LEFT OUTER JOIN уже существует в билдере stmt) и кастомный
   `order_by`: сначала прямые фото услуги (`Photo.service_id == X` → 1, иначе 0,
   DESC), затем закреплённые `created_at DESC, id ASC`; без фильтра — текущий
   путь без изменений. Схема ответа и принудительный `is_public=True` не меняются.
4. Тесты `backend/tests/` (канон тестов публичной витрины #583):
   - объединение: фото услуги + фото её занятия (публичные) возвращаются;
     чужая услуга/чужое занятие/непубличные — нет;
   - порядок: прямые фото услуги раньше фото занятий; внутри групп
     `created_at desc` (≥2 фото на группу с разными датами; `id asc` на равных);
   - несуществующий `service_id` → пустой список;
   - без фильтра — прежняя лента и порядок (регресс); выборка с фильтром ⊆
     выборка без фильтра.

### DoD

- pytest: новые кейсы зелёные, регресс публичной витрины и админ-списка зелёные.
- Ручная проверка: `GET /api/v1/public/photos?service_id=<id>` возвращает
  двухгрупповой порядок; без фильтра ответ байт-в-байт прежней формы.

## Task 2: api-client — параметр `service_id` у `getPublicPhotos`

### Classification: trivial

### Required Docs

- `docs/specs/2026-11-12-web-activity-photos-576-design.md` §6.2.

### Шаги

1. `packages/api-client/src/endpoints.ts`: `PhotoPublicListParams` получает
   `service_id?: string`; попадает в query-string как `service_id=`.
2. Тест `endpoints.test.ts` (канон блока `getPublicPhotos (#493)`): параметр
   в URL; без параметра URL не содержит `service_id`.

### DoD

- Vitest api-client зелёный; Zod-зеркало ответа не тронуто.

## Task 3: Web-модель — `serviceId` вниз по цепочке, мёртвая цепочка `photos` долой

### Classification: standard

### Required Docs

- `docs/domain-rules/photos.md` — Frontend (правило композиции галереи).
- `docs/specs/2026-11-12-web-activity-photos-576-design.md` §6.3.

### Шаги

1. `to-schedule-vm.ts`: `ScheduleView` (занятие) получает `serviceId:
   raw.serviceId`; пины `photos` из маппера и теста
   (`to-schedule-vm.test.ts:33, 108-114, 187`) удаляются; добавляется ассерт
   проброса `serviceId`.
2. `buildSchedule.ts`: удалить `photos: []` (`:100`) и поле из `WebScheduleDTO`
   (`dto/schedule.ts`); пин `buildSchedule.test.ts:166` удалить (ассерт
   `serviceId` уже есть на `:146`).
3. `page.tsx` адаптер и `ActivityView` (`view/activity.ts`): пробросить
   `serviceId`; удалить `guestPhotos` (адаптер `page.tsx:47-52`, поле
   `ActivityView`, мёртвый маппер `to-activity-vm.ts:17` вместе с его тестом и
   фикстурами — рендером не используется).

### DoD

- Vitest web зелёный; tsc без ошибок; в модели расписания не осталось полей
  `photos`/`guestPhotos`.

## Task 4: Хук `useServicePhotos`

### Classification: small

### Required Docs

- `docs/specs/2026-11-12-web-activity-photos-576-design.md` §6.4.

### Шаги

1. `frontend/web/app/hooks/useServicePhotos.ts`: react-query,
   `getPublicPhotos({ service_id, per_page: 20 })`, ключ
   `['photos', 'public', 'service', serviceId]`, `staleTime: 300_000`,
   `gcTime: 600_000`; маппинг `toGalleryPhotoView` (порядок сохраняется);
   ошибка пробрасывается — хук возвращает `photos: []` + `error`.
2. Юниты: один запрос с `service_id`; маппинг через allowlist (невалидный
   filename отбрасывается); пустой ответ → пустой массив.

### DoD

- Vitest web зелёный; повторные монтирования не порождают второй сетевой запрос.

## Task 5: Полоса миниатюр в `ActivityDetail`

### Classification: standard

### Required Docs

- `docs/specs/2026-11-12-web-activity-photos-576-design.md` §6.5, §7.
- `docs/domain-rules/photos.md` — Frontend (композиция).

### Шаги

1. `ActivityDetail.tsx`: под главной картинкой контейнер
   `data-testid="activity-photo-strip"`: `flex overflow-x-auto no-scrollbar`,
   миниатюры ~64–80 px, первая — обложка (при наличии), далее фото из
   `useServicePhotos(activity.serviceId)` в порядке ответа.
2. Главная картинка получает `data-testid="activity-photo-main"`; дефолт —
   обложка; клик по миниатюре (`data-testid="activity-photo-thumb"`, нативная
   `<button>`) меняет `src` локальным состоянием; активная — `aria-current="true"`.
3. Обложки нет (`imageUrl` пуст) — главная по умолчанию первое фото ряда,
   миниатюры обложки нет; нет фото — ряда нет.
4. A11y и загрузка: `tabindex="0"`, `role="group"`, `aria-label` ряда и
   миниатюр; `:focus-visible`; миниатюры `loading="lazy"` + `decoding="async"`
   + явные `width`/`height`.
5. Юниты (`__tests__`): состав и порядок ряда (обложка → фото услуги → фото
   занятий), клик меняет главную, пустой набор — ряда нет, a11y-атрибуты.

### DoD

- Vitest web зелёный; ручная проверка на dev-сервере против свежих фото.
- Поддерживает User Scenarios US-1…US-4 спеки (финальная фиксация — Task 6).

## Task 6: E2E `activity-photos.spec.ts` — US-1…US-4

### Classification: standard

### Required Docs

- `docs/specs/2026-11-12-web-activity-photos-576-design.md` §3, §6.6, §7.
- Канон фикстур: `frontend/web/e2e/cabinet-photos.spec.ts` (статические
  filename из `frontend/web/public/images/`; naturalWidth-поллинг).

### Шаги

1. Фикстуры через API (не сид): в `beforeAll` — стафф-логин (креды канона
   admin-e2e из env), выбор услуги и двух её занятий на видимой в вебе неделе
   (`GET /services/all` + `GET /activities`), `POST /api/v1/photos`: 2
   публичных фото услуги (разные `created_at`), 2 публичных фото второго
   занятия, 1 непубличное фото услуги; filename — существующие статические
   изображения `public/images/` (по канону #513 — байты отдаёт статика,
   `is_public` фильтрует только списки); `afterAll` — удаление созданных фото.
2. Тесты:
   - US-1: детали занятия → ряд = обложка + 2 фото услуги + 2 фото занятия в
     этом порядке; клик по миниатюре меняет `activity-photo-main`; клик по
     обложке возвращает; непубличное фото отсутствует.
   - US-2: занятие без своих фото → ряд = обложка + только фото услуги.
   - US-3: детали занятия, у услуги нет прямых фото, у занятия есть → ряд =
     обложка + фото занятия (фикстура через отдельную пару услуга/занятие).
   - US-4: услуга без фото вовсе и её занятие без фото →
     `activity-photo-strip` отсутствует, обложка на месте.
3. Прогон визуальных проверок §7 спеки (5 пунктов, машинные хинты).

### DoD

- E2E test for scenario 1 passes (RED-GREEN-REFACTOR).
- E2E test for scenario 2 passes (RED-GREEN-REFACTOR).
- E2E test for scenario 3 passes (RED-GREEN-REFACTOR).
- E2E test for scenario 4 passes (RED-GREEN-REFACTOR).
- Существующие web-e2e (галерея, кабинет, расписание) не регрессировали.
