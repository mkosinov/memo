# План #513: клиентский кабинет — чтение /my (записи/фото/платежи) + экраны

- Issue: #513 · спека: `docs/specs/2026-10-22-web-client-cabinet-read-design.md` (Gate B OK) · план рев.2: 2026-10-23
- Поведенческая дельта — в спеке `## Behavioral Delta`; задачи её не пересказывают.

## Goal

Клиент после входа видит в кабинете три раздела: «Мои записи», «Мои фото», «Мои платежи» — на трёх новых эндпоинтах чтения `/api/v1/my/records|photos|payments` под клиентской сессией #499, схемы без служебных полей. Плюс первый playwright-проект веба и сид-дельта для E2E.

## Architecture

Backend: новые роуты `/api/v1/my/records|photos|payments` под `require_client_session`; клиентское `/my`-семейство уже на main (PR #523 смержен): `backend/src/api/v1/my_client.py` (`GET /my/client`, `POST /my/records`), `require_client_session` в `backend/src/auth/permissions.py`. Новые роуты регистрируются в сборке API (`backend/src/api/v1/__init__.py`). Сборка составных ответов на уровне сервиса (по образцу существующего составного чтения записей — `backend/src/services/record.py`); пер-endpoint схемы. Frontend web: Next.js App Router, разделы `/cabinet/records|photos|payments`, примитивы `frontend/web/app/ui/` + новые лёгкие list-компоненты; все вызовы через `@memo/api-client`. E2E: новый playwright-проект в `frontend/web`, клиентская сессия-фикстура (storageState), собственный стек с портами из динамического окна e2e-канона.

## Tech Stack

FastAPI + SQLAlchemy + Pydantic (pytest), Next.js + React + Tailwind + vitest, `@memo/api-client` (ручное зеркало контрактов), Playwright (новый проект web), общий сид.

## Dependencies

- **PR #523 смержен** (коммит 9ad9fd3c, 22.10): `require_client_session`, `GET /my/client`, оболочка `/cabinet` и вход кодом уже на main. При старте IMPL сверить фактический контракт `/my`-семейства (`my_client.py`) со спекой #513 — ревью #523 могло дрейфовать от спеки #499.
- Порядок: 1–3 (бэкенд) → 4 (api-client) → 5 (сид) → 6 (E2E-инфраструктура) → 7–9 (экраны, каждый со своим E2E) → 10 (изоляция и замыкание).

## Task 1: Backend — `GET /api/v1/my/records`

### Classification: standard

### Required Docs

- `docs/domain-rules/records.md`, `docs/domain-rules/visits.md`
- спека #513: «Контракт API → GET /api/v1/my/records»

Схемы `MyRecordItem` (+`MyVisitItem`) per-endpoint: `id`, `activity_date` / `activity_start` / `activity_end` (вычисляются из начала и длительности занятия), `service_title`, `comment`, `visits[]` (`id`, `visitor_name: string | null`, `status`, `price`). Цена — снапшот: визитовый `custom_price` при наличии, иначе сохранённый `price`; к тарифу не обращаться (инвариант #357). Сервисная сборка с фильтром владельца `user.client_id`, сортировка по началу занятия убыв. + `id` возр.; визиты по `id` возр. Вход — кирпич `PaginationParams` без собственных полей. Охрана `require_client_session`; регистрация роутера в сборке API.

DoD: pytest зелёный — состав полей и список «не входят»; 401 (нет куки и staff-токен в клиентской куке); 422 пагинация; изоляция от второго клиента; снапшот-цена после удаления тарифа; `visitor_name: null`; детерминированный порядок.

## Task 2: Backend — `GET /api/v1/my/photos`

### Classification: small

### Required Docs

- `docs/domain-rules/photos.md`
- спека #513: «Контракт API → GET /api/v1/my/photos»

Схема `MyPhotoItem`: `id`, `filename`, `is_public`, `tags: string[]` (сервер разрешает M2M в названия), `created_at`. Все свои фото без фильтра публичности, `created_at` убыв. + `id` возр. Охрана и пагинация как в Task 1; регистрация роутера.

DoD: pytest зелёный — контракт, непубличные возвращаются наравне с публичными, 401, изоляция, 422 пагинация, детерминированный порядок.

## Task 3: Backend — `GET /api/v1/my/payments`

### Classification: small

### Required Docs

- `docs/domain-rules/payments.md`
- спека #513: «Контракт API → GET /api/v1/my/payments»

Схема `MyPaymentItem`: `id`, `amount` (integer), `method: cash|card|transfer|null`, `created_at`, `record` (`id`, `activity_date`, `service_title`) — всегда присутствует, платёж без записи невозможен. Владение через запись, `created_at` убыв. + `id` возр. Регистрация роутера.

DoD: pytest зелёный — контракт, контекст записи у каждого платежа, `method: null`, 401, изоляция, 422 пагинация, детерминированный порядок.

## Task 4: api-client — `listMyRecords` / `listMyPhotos` / `listMyPayments`

### Classification: small

### Required Docs

- спека #513: «api-client», «Контракт API»
- `packages/api-client/src/schemas.ts` (юнионы #480)

Три функции `list*` (нейминг по цели #497, новые функции не трогают старые семейства), per-endpoint наборы типов, статус-юнионы из существующих экспортов.

DoD: типы компилируются, юнит-тесты зеркала (поля/типы/query) зелёные.

## Task 5: Сид-дельта для кабинета

### Classification: small

### Required Docs

- `backend/src/seed/seed.py`, канон-тесты сида (pytest)
- спека #513: «Тесты → E2E → сид-дельта»

В сид добавляются: ≥1 непубличное фото клиента кабинета; сущности второго клиента — записи с визитами, фото, платёж (для изоляции С2). Имена стабильные, идентификаторы — по канону сида UUID (#491).

DoD: канон-тесты сида обновлены и зелёные; сид воспроизводим.

## Task 6: E2E-инфраструктура web

### Classification: large

### Required Docs

- спека #513: «Тесты → E2E»
- `.opencode/skills/dev-workflow/SKILL.md` (канон портов e2e-стеков, #317)
- `frontend/admin/e2e/fixtures/` (образцы: `seed-ids.ts`, `auth-state.ts`)

Первый playwright-проект в `frontend/web`: конфиг; собственный стек прогона — бэкенд и web-сервер, порты из динамического окна :28000–32700 канона dev-workflow (4 порта на прогон с тегом; не порт playground :3101); клиентская сессия-фикстура — вход по потоку #523 (телефон → код), код читается напрямую из тестовой БД (SQL-хелперы по образцу `seed-ids`), storageState.

DoD: фикстура логинит клиента сида на чистом прогоне; смоук-прогон открывает экран кабинета на стеке.

## Task 7: Web — навигация кабинета + экран «Мои записи»

### Classification: standard

### Required Docs

- спека #513: «Экраны веб-кабинета», «Visual Compliance Checks»
- web-примитивы `frontend/web/app/ui/`

Оболочка `/cabinet` получает навигацию трёх разделов (`data-testid="cabinet-nav"`), редирект вошедшего `/cabinet` → `/cabinet/records`; анониму на любом разделе — форма входа. Экран `/cabinet/records`: карточки занятий (`my-record-card`) — дата, время (начало–окончание), услуга, свой комментарий (`comment` из Task 1 потребляется экраном); строки посетителей — имя (безымянное место — «Посетитель»), статус (`my-visit-status`: `waiting`→«Ожидает», `visited`→«Состоялось», `missed`→«Пропущено», `cancelled`→«Отменено»), цена; пустое состояние «У вас пока нет записей» со ссылкой на страницу бронирования; постраничная навигация.

DoD: vitest зелёной — карточка со всеми полями и комментарием, подписи статусов, безымянное место, пустое состояние со ссылкой, пагинация; E2E сценариев С1 и С5 проходит (RED-GREEN-REFACTOR; инфраструктура Task 6).

## Task 8: Web — экран «Мои фото»

### Classification: standard

### Required Docs

- спека #513: «Экраны веб-кабинета», «Visual Compliance Checks»
- `frontend/web/app/hooks/useGallery.ts`, `frontend/web/app/lib/mappers/to-gallery-vm.ts`

Подтвердить путь рендера для непубличных имён: файлы сида ссылаются на `/images/*.jpg`, которых нет в `frontend/web/public/images` — задача выясняет, как гостевая галерея раздаёт такие файлы, и использует тот же механизм (если раздача не покрывает непубличные — решение по месту с фиксацией в задаче). Экран `/cabinet/photos`: сетка фото, бейдж публикации `is_public` → «Опубликовано» / «Не опубликовано» (`my-photo-card`); пустое состояние «У вас пока нет фото»; постраничная навигация.

DoD: путь рендера подтверждён и зафиксирован; vitest зелёной (бейдж обоих видов, пустое состояние, пагинация); E2E сценария С3 проходит — непубличное фото с бейджем «Не опубликовано» в кабинете и его отсутствие в гостевой галерее (RED-GREEN-REFACTOR).

## Task 9: Web — экран «Мои платежи»

### Classification: standard

### Required Docs

- спека #513: «Экраны веб-кабинета», «Visual Compliance Checks»

Экран `/cabinet/payments`: строки (`my-payment-row`) — сумма, способ (`cash`→«Наличные», `card`→«Карта», `transfer`→«Перевод», `null`→«Способ не указан»), дата, занятие (услуга + дата занятия); пустое состояние «У вас пока нет платежей»; постраничная навигация.

DoD: vitest зелёной (все подписи способов включая `null`, контекст занятия, пустое состояние, пагинация); E2E сценария С4 проходит (RED-GREEN-REFACTOR).

## Task 10: E2E — изоляция и замыкание

### Classification: standard

### Required Docs

- спека #513: «User Scenarios», «Visual Compliance Checks»

Сценарий С2: сущности второго клиента сида отсутствуют на всех трёх экранах. Полный прогон С1–С5 на стеке Task 6. Прогон `scripts/visual-compliance-check.sh` по секции спеки.

DoD: E2E С2 проходит; С1–С5 все зелёные одним прогоном; `visual-compliance-check.sh` по спеке зелёный.
