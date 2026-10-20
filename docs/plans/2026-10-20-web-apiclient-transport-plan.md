# План #479: веб на единый транспорт `@memo/api-client`

- Issue: #479
- Спека: `docs/specs/2026-10-19-web-apiclient-transport-design.md` (рев. 9, main `31a12d76`)
- Дата: 2026-10-20, рев. 2 (план-ревью: снятие `/photos/web` и `POST /records` из публичного перечисления `auth/public.py` + аудит кросс-сюит; факт — мок локаций уже удалён мержем #491/#492, Task 4 сжат; Task 3 → standard)

## Goal

Единый транспорт веб-приложения: все запросы через `@memo/api-client`; самодельный fetch-стек удалён; локации и галерея на живых данных; зеркала `RecordCreate`/`RecordUpdate` выровнены и строгие; анонимный полный `POST /records` закрыт. Поведенческая дельта — в спеке (`## Behavioral Delta`), здесь не дублируется.

## Architecture

Три зоны правок: `packages/api-client` (ручное зеркало контрактов, zod, `.strict()` — устоявшийся паттерн пакета), `backend` (FastAPI: модель-как-query для списков, pydantic `extra="forbid"`, охрана маршрутов зависимостями), `frontend/web` (Next.js app router, react-query v5, vitest). Бронирование и клиентская авторизация — вне задачи (#499).

## Tech Stack

TypeScript/React, `@tanstack/react-query` v5, zod; Python/FastAPI/pydantic; vitest, pytest.

## Task 1: api-client — выравнивание зеркал `RecordCreate`/`RecordUpdate`

### Classification: small

### Required Docs

- `docs/specs/2026-10-19-web-apiclient-transport-design.md` — «Изменение 1»
- `docs/domain-rules/records.md`, `docs/domain-rules/visits.md`

Шаги:

1. `RecordCreateSchema`: визиты += `name?: string`, `age?: number | null`, `tariff_id?: string | null` (name-based режим контракта); `price` визита остаётся обязательным; на уровне записи убрать `status` и `seats`; схема `.strict()` (паттерн подтверждён: write-схемы пакета уже несут `.strict()` с комментариями про `extra="forbid"`).
2. `RecordUpdateSchema`: расцепить с `RecordCreateSchema.partial()` — собственное зеркало PUT-контракта (`activity_id` обязателен, `client_id?`, `comment?`, `custom_price?`, `visits` полной заменой), `.strict()`.
3. Тесты пакета: переписать кейсы с `seats`/`status` в create/update (`schemas.test.ts`, endpoints-тесты); новый тест — name-based визит допущен, `status`/`seats` на уровне записи отвергнуты (тип и рантайм-парс).

### DoD

- vitest `packages/api-client` зелёный; зеркальные тесты из п.3 зелёные.
- `frontend/admin` собирается без правок (живой вызов `createRecord` не шлёт удалённых полей — проверено спекой).

## Task 2: backend — `POST /records` под `records:write`

### Classification: small

### Required Docs

- `docs/domain-rules/auth.md` (Roles & Permissions)
- спека — «Изменение 5»

Шаги:

1. `POST /api/v1/records`: добавить зависимость `require_permission("records:write")` (аноним → 401). Полная схема не меняется; `verify_fetch_metadata` остаётся за #493.
2. Снять публичный статус маршрута из кода-перечислений: запись `("POST", "/api/v1/records")` и строку docstring в `backend/src/auth/public.py`; устаревший комментарий «POST stays public» в `backend/src/api/v1/records.py`; аудит сюит, перечисляющих публичную поверхность (`test_auth_guards.py`, `test_auth_permissions.py`).
3. pytest: аноним → 401; админ с явной ценой визита → 201 (переопределение); админ без телефона → 201. Проверить существующие тесты создания записи — где фикстуры ходили без сессии, добавить аутентификацию.

### DoD

- pytest по записям зелёный; US-4 спеки покрыт.

## Task 3: `is_public`-фильтр списка фото; витрина `/photos/web` удаляется

### Classification: standard

### Required Docs

- спека — «Изменение 4», «Контрактные опоры»
- `docs/domain-rules/photos.md`

Шаги:

1. `PhotoListParams` (pydantic) += `is_public: bool | None`; в выборке списка — фильтр при заданном значении.
2. Удалить маршрут `GET /photos/web` целиком: роутер, запись `("GET", "/api/v1/photos/web")` и строку docstring в публичном перечислении `backend/src/auth/public.py`, его тесты.
3. Обновить кросс-сюиты, перечисляющие удалённый маршрут: `test_master_scope_contract.py`, `test_auth_permissions.py`, `test_auth_guards.py`, `test_list_id_uniform_singles.py`, `test_master_scope_photos.py`, `test_coverage_boost.py`.
4. api-client: удалить `getWebPhotos` и его тест; TS-тип параметров списка фото += `is_public`.

### DoD

- pytest: фильтр `is_public=true/false/не задан` зелёный; `GET /photos/web` → 404; сюиты из п.3 зелёные.
- vitest api-client зелёный.

## Task 4: web — локации: общий кеш react-query и чистка остатков

### Classification: small

### Required Docs

- спека — «Изменение 3» (факт план-ревью: мок локаций уже удалён мержем #491/#492; `useLocations` уже читает справочник через api-client, но на `useState/useEffect`)
- `docs/domain-rules/locations.md`

Шаги:

1. `useLocations`: заменить `useState/useEffect` на react-query с ключом `['locations']` и параметрами как в `useSchedule` (`staleTime` 300 000, `gcTime` 600 000) — общий кеш, один запрос; убрать импорт локального `ApiError` из `@/app/lib/errors`.
2. `LocationView` сузить до полей контракта (`id`, `title`, `address`) — `hours`/`photoUrl` умирают; маппер `toLocationViewFromResponse` правится соответственно; удалить осиротевший `app/lib/model/dto/location.ts` (`LocationDTO`).
3. Обновить тесты: `lib/mappers/__tests__/to-location-vm.test.ts`, тесты страницы/хука.

### DoD

- US-1 спеки: vitest — маппинг `LocationResponse` в опции фильтра; пустой справочник → опции по умолчанию; тесты `useSchedule` (US-3) не деградируют.

## Task 5: web — галерея публичных фото

### Classification: standard

### Required Docs

- спека — «Изменение 4»
- `docs/domain-rules/photos.md`

Шаги:

1. `useGallery`: react-query `['photos', 'public']` поверх `getPhotos({ is_public: true, per_page: 12 })`; убрать импорт локального `ApiError` из `@/app/lib/errors`.
2. Вью-модель из `PhotoResponse`: `url` = `filename` с allowlist (same-origin путь или `http(s)`-URL; посторонние схемы/хосты отбрасываются); подпись = названия тегов через « · », без тегов — без подписи. Маппер `to-gallery-vm` переписывается (+ его тест).
3. Секция `data-testid="guest-gallery"`; единое правило: загрузка, ошибка или пустая выдача — секция не рендерится.
4. Удалить `app/lib/api/gallery.ts`, `app/lib/model/dto/gallery.ts`, `app/lib/api/__tests__/gallery.test.ts`; тесты `GuestGallery`/`useGallery` переписать на контрактные данные (свежий `QueryClient`, `retry: false`).

### DoD

- US-2 спеки: vitest — рендер с контрактными фото, подписи из тегов, скрытие при пустой выдаче и ошибке.

## Task 6: web — удаление самодельного стека

### Classification: trivial

### Required Docs

- спека — «Изменение 2»

Шаги:

1. Удалить `app/lib/api/client.ts`, `app/lib/errors.ts`, `app/lib/api/photos.ts`, `app/lib/api/records.ts`, `app/lib/api/activities.ts`, `app/hooks/useActivities.ts` и их тесты (`lib/api/__tests__/`: `client.test.ts`, `photos.test.ts`, `records.test.ts`, `activities.test.ts`).
2. Греп отсутствия импортов удалённых модулей (`lib/api/client`, `lib/errors`, `lib/api/photos`, `lib/api/records`, `lib/api/activities`, `useActivities`); `BookingPrivateOverlay`/`model/view/booking.ts` не трогаются.

### DoD

- Греп пуст; type-check и vitest веба зелёные; расписание работает (US-3).

## Task 7: скилл архитектуры + финальные проверки

### Classification: trivial

### Required Docs

- `.opencode/skills/frontend-clean-architecture/SKILL.md`
- спека — «Изменение 2» (сопутствующий артефакт)

Шаги:

1. Обновить скилл: транспорт веба = `@memo/api-client`; слои `lib/api`, `lib/errors`, `model/dto` веба упразднены.
2. Полные прогоны: vitest `frontend/web` и `packages/api-client`; pytest backend (затронутые сюиты: records, photos). Ручной smoke `dev.sh`: сидовые локации в фильтре, публичные фото в галерее.

### DoD

- Все наборы зелёные; скилл обновлён в том же PR; smoke по чек-листу спеки (## Visual Compliance Checks) пройден вручную.
