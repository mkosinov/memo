# GH #601 — Флаг «не показывать в web» для локаций

- **Date**: 2026-11-13
- **Branch**: `601-locations-web-visibility` (base `92896269` = origin/main;
  HEAD `78cbd9b2`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `92896269` — 6 задач, 8 коммитов `fecf11fd..78cbd9b2`,
  54 файла, +2113/−120
- **Issue**: #601 — у локаций не было способа скрыть площадку от клиентов
  сайта: анонимный web-фильтр и расписание читали staff-справочник
  `GET /locations` целиком, и любая служебная/неактуальная площадка с её
  занятиями была видна посетителям. Решение — флаг `is_public`
  (true = видна) на локации: анонимный словарь-публикатор по образцу
  публичной витрины #600, охрана старых bare GET, серверное исключение
  занятий скрытых/архивных локаций из публичной витрины занятий и 404 в
  брони поверх #600, переключатель «Видно клиентам» и бейдж «Не в web» в
  админке, сид-колонка.
- **Спека**: `docs/specs/2026-11-12-locations-web-visibility-601-design.md`
  (рев.4) — на main (`43139353`), unchanged by IMPL
- **План**: `docs/plans/2026-11-12-locations-web-visibility-601-plan.md`
  — на main (`ddd77447`), 6/6 задач, все done, unchanged by IMPL
- **Domain rules**: `docs/domain-rules/locations.md` (флаг `is_public`)
  и `docs/domain-rules/auth.md` (словарь покидает/пополняет перечень
  анонимных маршрутов) влиты на main вместе со спекой (`43139353`,
  канон: дом-правила едут со спекой) — отдельной задачи IMPL не требовали

## Что выполнено

1. **Колонка `is_public` на локации (T1, `fecf11fd` small)** —
   `locations.is_public` NOT NULL DEFAULT true (true = видна клиентам);
   миграция `c1d3e5f7a9b1`, поле в `LocationResponse`/`LocationUpdate`,
   zod-зеркало в api-client, мок-литералы дополнены полем (обязателен
   zod-схемой).
2. **Публичный словарь + охрана bare GET (T2, `487e32d9` standard)** —
   `GET /api/v1/public/locations` (ADR-015 неймспейс, образец #600):
   полный список одним массивом без пагинации и параметров (по образцу
   админского `/all`, решение владельца 2026-11-12), потолок
   `BARE_LIST_MAX_ROWS`; отдаёт только неархивированные локации с
   `is_public = true`; детерминированный сорт `sort_order ASC, title ASC,
   id ASC` (дефолт справочников #205); схема `LocationPublicResponse`
   ровно 4 поля (`id`, `title`, `address`, `location_hint`, nullable
   address/hint) — лишних ключей нет; allowlist-запись в `PUBLIC_ROUTES`.
   Параллельно bare `GET /locations` и `GET /locations/{id}` под
   `locations:read` — аноним и клиентская сессия → 401 (механизм #600).
3. **Исключение занятий скрытых/архивных локаций (T3, `e9287d09`
   standard)** — серверный джойн публичной витрины занятий #600
   расширен: занятие локации скрытой (`is_public = false`) или
   архивной не попадает в публичную выдачу; бронь по прямому id —
   предикат пробы существования расширяется тем же условием ДО
   валидации тарифа, ответ 404 паритетен несуществующему (канон #600,
   без бокового канала). Персональные поверхности (админ-сетка, скоуп
   мастера) не тронуты — видят всё как раньше.
4. **Allowlist скоуп-контракта (fixup, `94823fa9` trivial)** — новый
   публичный маршрут добавлен в перечень allowlist-носителя
   scope-contract-теста (третий носитель перечня, канон #600).
5. **Админ: переключатель + бейдж + e2e (T4, `55912ca6` standard)** —
   в модалке локации (создание и редактирование) switch «Видно
   клиентам» (`data-testid="toggle-is-public"`, донор toggle-private,
   aria-checked; дефолт true в обеих режимах, значение едет в payload
   булевым); в таблице бейдж «Не в web» рядом с названием (приглушённая
   пара к «Архив»). Admin-e2e `locations-web-hidden.spec.ts` US-1/US-4:
   скрытие при создании И редактировании (ассерты PUT/POST payload),
   бейдж, позитивная форма «неизменности» админки (карточка занятия
   скрытой локации видна в сетке; локация в опциях дропдауна создания —
   донор `schedule-archived-visibility`), анонимная проба публичного
   словаря после выключения (скрытой нет, контрольная есть), US-4
   round-trip возврата.
6. **Web на публичный словарь + e2e (T5, `cbd55c17` standard)** —
   `useLocations` переведён на `getPublicLocations` (api-client +
   zod-схемы по образцу #600); фильтр локаций и расписание web читают
   только публичный словарь (4 поля покрывают всё чтение web).
   Web-e2e `locations-web-visibility.spec.ts` + фикстура
   `location-visibility-pair.ts`: US-2 — фильтр и расписание без
   скрытой площадки и её занятий с позитивным контролем видимой; US-3 —
   бронь по прямому id под клиентской сессией (storageState) → 404,
   запись не создана (гость без сессии до предиката не доходит — 401,
   находка панели); US-4 — фаза «включил → проверил» после админ-цикла.
7. **Сид: колонка is_public (T6, `7d89e111` small)** — предзагрузка
   прод-справочников принимает и применяет `is_public` из YAML
   (маппинг «да/нет/пусто» → true), контрольный `--check` сходится;
   фикстура теста несёт ОБЕ полярности (минимум одна `is_public: false`
   — иначе молчаливый пропуск колонки остаётся зелёным, находка
   панели); US-5.
8. **Бейдж no-wrap (fix, `78cbd9b2` trivial)** — бейдж «Не в web» не
   переносится в узких вьюпортах (mobile /locations).

## Отклонения и фикс-циклы

- Девиаций от спеки рев.4 нет; спека, план и дом-правила — коммиты
  main (`43139353` спека, `ddd77447` план) ещё до ветки, IMPL их не
  касался.
- **В-скоупе бонус-фиксы:**
  - латентный дефект модалки редактирования локации — PUT нёс
    `tag_ids`, которого нет в `LocationUpdate` (`extra=forbid`) —
    КАЖДОЕ сохранение модалки падало 422 (парити-гэп дом-правил,
    найден новым e2e; окно известно с #203, где его сознательно не
    чинили). Закрыт изъятием `tag_ids` из PUT + пин-тестом
    («boolean is_public, NO tag_ids») (`55912ca6`);
  - бейдж no-wrap на узких вьюпортах (`78cbd9b2`);
  - allowlist-запись нового публичного маршрута в scope-contract
    носителе (`94823fa9`) — плановая мелочь T2/ревью, отдельным
    фикс-коммитом.
- **Visual gate**: §5 спеки — 1 машинная проверка (бейдж «Не в web»
  виден на /locations mobile) пройдена раннером exit 0; 1
  manual-review пункт делегирован admin-e2e по дизайну спеки (раннер
  не кликает — канон харнесса #602); GREEN.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| Backend: публичный словарь + гарды + auth-контракт (T1–T2) | **174 pass** |
| Backend: витрина/бронь/scope-contract (T3) | **63 pass** |
| Backend: сид + is_public регрессия (T6) | **66 pass** |
| admin vitest (T4) | **3171/3171** |
| admin `tsc --noEmit` / `next build` | чистые |
| admin-e2e `locations-web-hidden` US-1/US-4 (T4) | **3/3** |
| web-e2e `locations-web-visibility` US-2/US-3/US-4 (T5) | **3/3** полный + **1/1** изолированный US-2 |
| api-client vitest (T1/T5) | **584/584**, type-check + build чистые |
| web type-check (T5) | чистый |
| Visual compliance gate | **GREEN** (exit 0; 1 машинная + 1 делегирована admin-e2e) |

Приёмка: US-1 ✅ (admin-e2e), US-2 ✅ (web-e2e), US-3 ✅ (web-e2e
клиентская сессия, 404 без записи), US-4 ✅ (admin+web e2e round-trip),
US-5 ✅ (seed-тест обеих полярностей). Все 6 DoD задач плана выполнены;
код-комплаенс ревью пройден на каждой задаче, Tasks 2–5 — ещё и
code-quality ревью.

## Behavioral Delta

Владелец скрывает площадку с сайта одним переключателем «Видно
клиентом» в админке: скрытая локация исчезает из фильтра web и её
занятия — из публичного расписания (серверное исключение в джойне
витрины #600), бронь скрытого занятия по прямому id → 404 для клиента
(гость — 401 до предиката). Админка не меняется: скрытая площадка и её
занятия видны в сетке, дропдаунах создания и таблице (плюс бейдж «Не в
web»). Публичный словарь `GET /api/v1/public/locations` отдаёт
анониму ровно 4 поля только видимых неархивированных локаций; bare
`GET /locations` стал staff-only (401 анониму/клиенту). Предзагрузка
сида понимает колонку «не показывать в web».

## Известные остатки (follow-up-кандидаты, не в этом PR)

- Осознанных остатков нет. Ограничения спеки §9 действуют: любое новое
  поле в публичной схеме локаций — отдельное решение (расширение
  схемы, не «вернуть полную»); релаксаций охраны bare GET не
  предполагается.
- Латентный tag_ids-гэп #203-класса проверен только для локаций — если
  у других словарей в `Update`-схемах есть `extra=forbid`-расхождения
  с payload модалок, это кандидат на отдельную ревизию (здесь не
  искалось).

## PR-заметки

- `Closes #601` — только в описании PR (канон репо), в коммиты не
  пишется.
- Спека рев.4 (`43139353`) и план (`ddd77447`) — на main, unchanged by
  IMPL; docser-коммит — только мета-доки (PLAN.md, CHANGELOG.md, этот
  файл).
- Доска: карточка #601 остаётся `In IMPL` до создания PR (перевод в
  `PR (G7)` — на моменте `gh pr create`, не docser).

## Тронутые файлы (`git diff --name-only 92896269..78cbd9b2`)

```
backend/alembic/versions/c1d3e5f7a9b1_add_is_public_to_locations.py
backend/seed-data/README.md
backend/seed-data/locations.yaml
backend/src/api/v1/locations.py
backend/src/api/v1/public.py
backend/src/auth/public.py
backend/src/models/location.py
backend/src/schemas/location.py
backend/src/seed/reference.py
backend/src/services/activity.py
backend/src/services/location.py
backend/src/usecases/my_booking.py
backend/tests/test_auth_guards.py
backend/tests/test_auth_permissions.py
backend/tests/test_location_is_public.py
backend/tests/test_locations_guard.py
backend/tests/test_master_scope_contract.py
backend/tests/test_my_records_api.py
backend/tests/test_public_activities_api.py
backend/tests/test_public_locations_api.py
backend/tests/test_seed_reference.py
frontend/admin/__tests__/LocationModal.test.tsx
frontend/admin/__tests__/LocationsTable.test.tsx
frontend/admin/__tests__/PhotosContext.test.tsx
frontend/admin/__tests__/buildAdminSchedule.test.ts
frontend/admin/__tests__/helpers/mockData.ts
frontend/admin/__tests__/locationColumns.test.tsx
frontend/admin/__tests__/photos/photoColumns.test.tsx
frontend/admin/__tests__/scheduleIntegration.test.tsx
frontend/admin/__tests__/transformers.test.ts
frontend/admin/__tests__/useDeleteLocation.test.ts
frontend/admin/__tests__/useLocationsMutations.test.ts
frontend/admin/__tests__/useReactQueryHooks.test.tsx
frontend/admin/app/(main)/locations/components/LocationModal.tsx
frontend/admin/app/(main)/locations/components/LocationsTable.tsx
frontend/admin/app/(main)/locations/components/locationColumns.tsx
frontend/admin/app/(main)/locations/components/locationFields.tsx
frontend/admin/e2e/locations-web-hidden.spec.ts
frontend/web/app/hooks/__tests__/useLocations.test.tsx
frontend/web/app/hooks/__tests__/useSchedule.test.tsx
frontend/web/app/hooks/useLocations.ts
frontend/web/app/hooks/useSchedule.ts
frontend/web/app/lib/mappers/__tests__/buildSchedule.test.ts
frontend/web/app/lib/mappers/__tests__/to-location-vm.test.ts
frontend/web/app/lib/mappers/buildSchedule.ts
frontend/web/app/lib/mappers/to-location-vm.ts
frontend/web/e2e/fixtures/location-visibility-pair.ts
frontend/web/e2e/fixtures/visibility-pair.ts
frontend/web/e2e/locations-web-visibility.spec.ts
packages/api-client/src/__fixtures__/backend-responses.json
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
```

## References

- **GitHub Issue**: #601
- **Design Spec**: `docs/specs/2026-11-12-locations-web-visibility-601-design.md` (рев.4)
- **Plan**: `docs/plans/2026-11-12-locations-web-visibility-601-plan.md` (6/6)
- **Domain rules**: `docs/domain-rules/locations.md` (флаг `is_public`),
  `docs/domain-rules/auth.md` (анонимный перечень) — влиты со спекой
  `43139353`
- **Смежные**: #600 (базовый контракт: публичная витрина занятий, охрана
  bare GET, 404-паритет брони — поверх него), #493/#583 (прецедент
  публичного контракта), #205 (дефолт сорта справочников `/all`),
  #203 (первичная фиксация tag_ids-окна модалки)
- **PR**: _(to be added after PR creation)_
