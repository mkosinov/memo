# GH #479 — веб на единый транспорт `@memo/api-client`: второй fetch-стек удалён, данные живые

- **Date**: 2026-10-20
- **Branch**: `479-web-apiclient-transport`
- **Status**: Completed (PR/приёмка — у архитектора; PR pending, CI-watch/merge на finishing/@manager)
- **Range**: base `e34f3ad7` (main — docs-коммит спеки рев.10 + плана рев.2) — 8 коммитов (`d0d136eb..aed1b4de`), 52 файла, +1055/−1282 (+ этот docs-коммит)
- **Issue**: #479 — веб-приложение на единый транспорт `@memo/api-client`
- **Спека**: `docs/specs/2026-10-19-web-apiclient-transport-design.md` рев.10 — на main, unchanged by IMPL
- **План**: `docs/plans/2026-10-20-web-apiclient-transport-plan.md` рев.2 — 7 задач (T1–T7 закрыты) — на main, unchanged by IMPL
- **Характер**: миграция транспорта + контрактные зачистки; гостевое бронирование и клиентская авторизация — вне задачи (#499), форма бронирования веба остаётся в текущем декоративном виде

## Что выполнено

1. **api-client — зеркала `RecordCreate`/`RecordUpdate` (T1, `d0d136eb`, small)** —
   `RecordCreateSchema`: визиты += `name`/`age`/`tariff_id` (name-based режим
   контракта), `price` визита остаётся обязательным; на уровне записи убраны
   `status` и `seats`; `RecordUpdateSchema` расцеплен с `RecordCreateSchema.partial()`
   — собственное зеркало PUT-контракта (`activity_id` обязателен, `visits` полной
   заменой); обе схемы `.strict()` (паритет `extra="forbid"` бэкенда) — см. таблицу
   Parity Notes в `docs/domain-rules/records.md`.
2. **backend — анонимный `POST /records` закрыт (T2, `abce7884`, small)** —
   зависимость `require_permission("records:write")`: аноним → **401** (проба
   подтверждена); `POST /api/v1/records` снят из публичного перечисления
   `auth/public.py`; `verify_fetch_metadata` остаётся за #493.
3. **backend + api-client — `is_public`-фильтр фото, витрина `/photos/web` удалена
   (T3, `c56891c4` + `84994c58`, standard)** — `GET /api/v1/photos` принимает
   `is_public` (прямое равенство, применяется только когда передан); роут
   `GET /photos/web` и его показушный перечислитель удалены (проба → **404**);
   api-client — `getWebPhotos` удалён, `PhotoListParams` += `is_public`; публичная
   галерея веба едет общим списком с `is_public=true` (анонимный гость без скоупа,
   master-скоуп не задет); кросс-сюитный аудит + правки 8 затронутых pytest-сьютов.
4. **web — локации на живых данных (T4, `7437346b`, small)** — `useLocations`
   переведён на `getLocations()` через общий `['locations']` кеш react-query;
   `LocationView` сужен до контракта (`LocationResponse`); локальные DTO
   (`LocationDTO`) удалены.
5. **web — галерея публичных фото (T5, `5bae3b1a`, standard)** — `useGallery` на
   `getPhotos({ is_public: true })` через react-query; зашитый мок-стек галереи
   (`lib/api/gallery.ts`, `model/dto/gallery.ts`) удалён; новые маппер
   `to-gallery-vm` (подписи из тегов фото) и секция `GuestGallery` с
   `data-testid="guest-gallery"`.
6. **web — самодельный стек удалён (T6, `1f38756e`, trivial)** — собственный
   fetch-клиент (`lib/api/client.ts`), свой `ApiError` (`lib/errors.ts`) с другим
   порядком аргументов, DTO-оверлеи и мёртвый `useActivities` — всё снесено вместе
   с тестами; единственный транспорт веба — `@memo/api-client` (клиент, `ApiError`,
   типы, zod-разбор, таймауты 30/120 с).
7. **Скилл + финальные прогоны (T7, `aed1b4de`, trivial)** —
   `.opencode/skills/frontend-clean-architecture/SKILL.md` v2.1: web-транспорт —
   `@memo/api-client`, самодельные fetch-стеки запрещены (−198/+96 строк).

## Верификация (это дерево, `aed1b4de`)

| Проверка | Результат |
| --- | --- |
| vitest `frontend/web` | **336/336** |
| vitest `packages/api-client` | **483/483** |
| pytest — 8 затронутых сьютов (`test_api_records`, `test_api_photos`, `test_master_scope_contract`, `test_auth_permissions`, `test_auth_guards`, `test_list_id_uniform_singles`, `test_master_scope_photos`, `test_coverage_boost`) | **327/327** |
| `frontend/admin` type-check | чист (Task 1 DoD — живые вызовы не шлют удалённых полей) |
| `frontend/web` type-check + `next build` | чист, exit 0 |
| Визуальный гейт (VCC спеки) | **EXIT=0** — `guest-gallery` найден, фото с подписями из тегов |
| Ручной smoke (закрыт тулингом VCC) | локации в фильтре = сид-справочник (Альпика, Гранд Отель Поляна, Поляна 1389); подписи галереи «гость», «гость · новинка», «новинка · хит» |
| Пробы контракта | `GET /photos/web` → **404**; анонимный `POST /records` → **401** |

## DoD / приёмка

- AC спеки все зелёные; behavioral delta — «всё живое»: локации и галерея питаются
  реальными данными API, витрина — фильтр общего списка, зеркала строгие,
  гостевое создание записи закрыто до #499.
- E2E-харнес для `frontend/web` не существует (создание — отдельная задача, спека
  §Нецели); проверки сценариев — vitest.
- Domain-rules `auth.md`/`photos.md`/`records.md` синхронизированы имплементаторами
  (проверено docser, коммиты в ветке).
- Docs discipline: спека/план/domain-rules — на русском; скилл
  `frontend-clean-architecture` — на английском.
