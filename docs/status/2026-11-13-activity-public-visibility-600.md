# GH #600 — Публичная витрина занятий: приватные (is_private) не видны клиентам в web

- **Date**: 2026-11-13
- **Branch**: `600-activity-public-visibility` (rebase на origin/main `ddd77447`; HEAD `c31127ee`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `ddd77447` — 7 задач, 7 коммитов `ffe3f74a..c31127ee`, 25 файлов, +1204/−77
- **Issue**: #600 — приватные занятия (`is_private`) отдавались анониму и
  клиенту на всех поверхностях: общий `GET /api/v1/activities` был
  публичен и вёз приватные строки с `is_private`/`comment`/`record_info`
  в схеме; точечный GET читал приватное по id; бронирование приватного
  id проходило. Решение — выделенная публичная витрина (неймспейс
  ADR-015, образец публичных фото #493): минимальная схема 8 полей,
  серверное исключение приватных, старые GET под охрану персонала,
  404-паритет в бронировании, web переезжает на публичный маршрут.
- **Спека**: `docs/specs/2026-11-12-activity-private-visibility-600-design.md`
  (рев.4) — на main (`26a6b830`), unchanged by IMPL
- **План**: `docs/plans/2026-11-12-activity-public-visibility-600-plan.md`
  — на main, 7/7 задач, все done, unchanged by IMPL
- **Domain rules**: `docs/domain-rules/auth.md` (раздел Public Access:
  занятия покидают перечень анонимных словарей) влит в main вместе со
  спекой (`26a6b830`, канон: дом-правила едут со спекой) — отдельной
  задачи IMPL не требовали

## Что выполнено

1. **Публичный список `GET /api/v1/public/activities` (T1, `ffe3f74a`
   standard)** — схема `ActivityPublicResponse` ровно из 8 полей,
   читаемых маппером web (`id`, `service_id`, `master_id`,
   `location_id`, `start`, `duration`, `capacity`, `occupied`; никогда
   `is_private`/`comment`/`record_info`/метки времени/`service_title`);
   отдельный view-метод сервиса — приватные исключены NULL-безопасным
   предикатом `is_private IS NOT TRUE`; детерминированный сорт
   `start asc, id asc` (ради стабильной пагинации — образец публичных
   фото); `date_from`/`date_to` — канон целых дней, при отсутствии
   `date_from` окно по умолчанию от текущей даты (аноним без параметров
   не получает дамп всей истории); `occupied` считается как в общем
   списке; конверт `PaginatedResponse`; allowlist-запись в
   `PUBLIC_ROUTES` (`src/auth/public.py`) при сохранённом default-deny.
   Общий `ActivityService.list` не тронут — админ-сетка и скоуп мастера
   на нём.
2. **Охрана старых GET-маршрутов (T2, `175b09e7` small)** —
   `GET /api/v1/activities` и `GET /api/v1/activities/{id}` под
   `require_permission("activities:read")`: аноним и клиентская сессия
   → 401; записи обоих GET удалены из allowlist во всех трёх носителях
   (список `PUBLIC_ROUTES`, докстринга модуля, контракт-теста);
   WRITE-маршруты не тронуты (охрана записи уже была). Попутно:
   readiness-проба admin-e2e `globalSetup` переведена на публичный
   маршрут (была на staff-GET — стал бы красным после охраны).
3. **Бронирование приватного id → 404 (T3, `15144b0e` small)** —
   `POST /api/v1/my/records`: предикат `is_private IS NOT TRUE` в пробе
   существования занятия, ДО валидации тарифа — проверка после тарифа
   раскрывала бы факт существования боковым каналом (422 на приватном
   против 404 на несуществующем); ответ на приватный id байт-в-байт
   паритетен несуществующему. Точечный публичный маршрут
   `/public/activities/{id}` сознательно не строится (решение владельца,
   гейт B спеки рев.4) — потребителя нет, добавим аддитивно при
   появлении.
4. **api-client (T4, `3d695772` small)** — `getPublicActivities` по
   образцу `getPublicPhotos` (тонкий эндпоинт), zod-схемы
   `ActivityPublicResponseSchema` + пагинационная обёртка,
   request-shape тесты.
5. **Web-хук расписания (T5, `993fe5d0` small)** — `useSchedule`
   переключён на `getPublicActivities` с явным `per_page=100` (сегодняшний
   вызов без `per_page` молча упирался в серверный дефолт 20 строк —
   усечение уже жило на старом маршруте и чинится здесь, потому что
   место вызова и так правится); ключ кэша сохраняет сегменты дат:
   `['activities','public', from, to]`. Маппер расписания не менялся —
   читает те же 8 полей. Dev-стенд: страница ходит ТОЛЬКО в публичный
   маршрут (0 обращений к staff-маршруту).
6. **Web e2e US-1/US-2 (T6, `8baca973` standard)** —
   `activity-visibility.spec.ts` + фикстура `visibility-pair.ts`
   (пара публичное/приватное через API): US-1 — приватное отсутствует в
   сетке + позитивный контроль (публичное на месте); US-2 — бронь
   приватного id → 404, тела ответов паритетны несуществующему. 2/2
   GREEN, RED доказан в обе стороны; sentinel-спека 2/2.
7. **Селектор ромба + e2e страж мастера US-4 (T7, `c31127ee` small)** —
   стабильный `data-testid="activity-private-badge"` на ромбе приватного
   занятия в `ActivityCard` (админка); новый
   `master-private-visibility.spec.ts` (RED→GREEN 1/1) — мастер видит
   своё приватное занятие в сетке. Регресс US-5: `copy-last-week` 8/8
   без правок (приватные пропускались при копировании недели и до —
   серверная логика не тронута).

## Отклонения и фикс-циклы

- Девиаций от спеки рев.4 нет; спека, план и дом-правило `auth.md` —
  коммиты main (`26a6b830`) ещё до ветки, IMPL их не касался.
- Точечный публичный маршрут `GET /public/activities/{id}` отложен
  владельцем (гейт B, рев.4) — фиксируется как осознанное «не строим»,
  не как остаток.
- **Visual gate**: спека §7 = «N/A» as-approved — пользовательского UI
  фича не добавляет (только вырезание строк из анонимной выдачи +
  testid-атрибут на существующем ромбе); скрипт visual-compliance exit 0.
  Визуальная дельта покрыта e2e-ассертами отсутствия и dev-стенд пробой.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| Backend unit-суит публичного маршрута + охраны (T1–T2) | зелёный |
| Бронирование приватного id (T3, вкл. 404-паритет + RED-проба) | **37/37** |
| api-client vitest (T4) | **580/580**, tsc/eslint/build чистые |
| web vitest (T5) | **571/571**; dev-стенд: 0 обращений к staff-маршруту |
| web e2e US-1/US-2 (T6, RED доказан в обе стороны) | **2/2** |
| sentinel-спека (T6) | **2/2** |
| e2e страж мастера US-4 (T7, RED→GREEN) | **1/1** |
| Регресс `copy-last-week` US-5 (T7, без правок ожиданий) | **8/8** |
| ActivityCard vitest (T7) | **50/50** |
| Visual compliance gate | **exit 0** (§7 «N/A» as-approved) |

Приёмка: US-1 ✅ (web e2e), US-2 ✅ (web e2e + unit 404-паритет),
US-3 ✅ (backend unit, T2), US-4 ✅ (e2e мастер), US-5 ✅ (регрессионный
прогон).

## Behavioral Delta

Аноним и клиент больше не получают приватные занятия ни на одной
поверхности: витрина читает новый `GET /api/v1/public/activities`
(8-полевая схема, серверное исключение приватных, дефолт окна «от
текущей даты», явный `per_page=100` — попутно закрыто молчаливое
усечение серверным дефолтом 20 при окнах до 30 дней); старые
`GET /activities` и `GET /activities/{id}` — только для персонала
(аноним/клиент → 401); бронирование приватного id → 404, неотличимое от
несуществующего. Персонал без изменений: админ видит все занятия,
мастер — свои приватные в сетке (плюс testid на ромбе), копирование
недели как раньше пропускает приватные. Админка, кабинет, галерея не
тронуты; DB-схема и миграции не менялись.

## Известные остатки (follow-up-кандидаты, не в этом PR)

- Точечный публичный маршрут `/public/activities/{id}` — добавить
  аддитивно при появлении потребителя (глубокие ссылки на занятие);
  спека рев.4 фиксирует контракт: публичная схема + 404 на приватный id.
- #601 (видимость локаций в web) — сознательно строится поверх этого
  контракта отдельной веткой.

## PR-заметки

- `Closes #600` — только в описании PR (канон репо), в коммиты не пишется.
- Спека рев.4 (`26a6b830`), план и дом-правило `auth.md` — на main,
  unchanged by IMPL; docser-коммит — только мета-доки (PLAN.md,
  CHANGELOG.md, этот файл).
- Доска: карточка #600 остаётся `In IMPL` до создания PR (перевод в
  `PR (G7)` — на моменте `gh pr create`, не docser).

## Тронутые файлы (`git diff --name-only ddd77447..c31127ee`)

```
backend/src/api/v1/activities.py
backend/src/api/v1/public.py
backend/src/auth/public.py
backend/src/auth/scope.py
backend/src/schemas/activity.py
backend/src/services/activity.py
backend/src/usecases/my_booking.py
backend/tests/test_activities_guard.py
backend/tests/test_auth_contract.py
backend/tests/test_auth_guards.py
backend/tests/test_auth_permissions.py
backend/tests/test_list_id_uniform_guards.py
backend/tests/test_master_scope_contract.py
backend/tests/test_my_records_api.py
backend/tests/test_public_activities_api.py
frontend/admin/app/components/schedule/ActivityCard.tsx
frontend/admin/e2e/globalSetup.ts
frontend/admin/e2e/master-private-visibility.spec.ts
frontend/web/app/hooks/__tests__/useSchedule.test.tsx
frontend/web/app/hooks/useSchedule.ts
frontend/web/e2e/activity-visibility.spec.ts
frontend/web/e2e/fixtures/visibility-pair.ts
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.ts
```

## References

- **GitHub Issue**: #600
- **Design Spec**: `docs/specs/2026-11-12-activity-private-visibility-600-design.md` (рев.4)
- **Plan**: `docs/plans/2026-11-12-activity-public-visibility-600-plan.md` (7/7)
- **Domain rules**: `docs/domain-rules/auth.md` — Public Access (занятия
  покинули анонимный перечень; влит со спекой `26a6b830`)
- **Смежные**: #493 (прецедент публичного контракта и охраны голых GET —
  фото), #583 (канон тестов публичной витрины), #601 (видимость локаций
  в web — строится поверх), #584 (серверный джойн справочников — волна)
- **PR**: _(to be added after PR creation)_
