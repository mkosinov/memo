# GH #606 — Волна ADR-015 (словари): витринные справочники, гарды bare GET, флаг видимости услуг

- **Date**: 2026-11-21
- **Branch**: `606-adr015-dictionaries` (base `923ad95e` = main;
  HEAD `8a9aa085`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `923ad95e` — 8 задач, 15 коммитов `94a28a9f..8a9aa085`,
  67 файлов, +3265/−217
- **Issue**: #606 — остаток волны словарей ADR-015 clause 4: веб-форма
  записи (`useSchedule`) до сих пор читала мастеров и услуги со
  staff-маршрутов `GET /masters` / `GET /services` (полный админ-контракт
  в `PUBLIC_ROUTES` — аноним получал его целиком), теги были публичны
  дважды. Решение — витринные справочники `GET /public/masters` /
  `GET /public/services` по прецедентам #493/#600/#601, гарды на все 5
  bare GET словарей с уборкой из allowlist, плюс (решение владельца,
  Gate B рев.2) флаг «не показывать в web» для услуг — точное зеркало
  #601 для локаций, с серверной фильтрацией всех публичных витрин
  (справочник, занятия #600, фотогалерея #493) и 404-паритетом в брони.
- **Спека**: `docs/specs/2026-11-13-adr015-dictionaries-606-design.md`
  (рев.4) — на main, unchanged by IMPL
- **План**: `docs/plans/2026-11-14-adr015-dictionaries-606-plan.md` —
  на main, 8/8 задач, все done, unchanged by IMPL
- **Смежные волны**: #600 (витрина занятий + механизм гардов/404-паритета
  — переиспользован), #601 (зеркало флага `is_public` + канон записи
  PATCH-строкой), #493 (прецедент публичного контракта и guard-фабрики)

## Что выполнено

1. **Флаг `is_public` услуги: миграция, модель, staff-контракт, аудит
   (T1, `94a28a9f` standard)** — миграция `d4f6a8b0c2e1`:
   `services.is_public` boolean NOT NULL server_default `true` (зеркало
   `c1d3e5f7a9b1` #601); колонка в модели; `ServiceBase.is_public: bool
   = True` (наследуется Create/Update/Response), `ServicePatch.is_public:
   bool | None = None` отдельной строкой (канон записи #601: PUT модалки
   несёт значение, патч — строкой); поле в `NOT_NULL_FIELDS` сервиса и
   в аудите услуг (`_SERVICE_MARK_FIELDS`).
2. **Сид-полярности (T1, `d3426753`)** — `seed-data/services.yaml`
   несёт обе полярности флага; предзагрузка применяет `is_public`
   из YAML, контрольный `--check` сходится (US-сид-сценарий).
3. **Витринный справочник мастеров (T2, `42062198` standard)** —
   `GET /api/v1/public/masters`: только действующие мастера
   (`is_active`), минимальная 5-поле схема `MasterPublicResponse`;
   `specialty` — plain string (адаптация под несмерженный #599,
   спека §3.5); allowlist-запись в `PUBLIC_ROUTES`.
4. **Витринный справочник услуг (T2, `c07e82ca` standard)** —
   `GET /api/v1/public/services`: только активные с `is_public = true`;
   схема `ServicePublicResponse` — поля формы записи + поля деталей
   (`description`, `min_age`, `max_age` — единственный nullable скаляр:
   null = без верхней границы) + `specialty`, вложенные
   `ServicePublicTariff`/`ServicePublicMaterial`, теги как
   отсортированные строки-заголовки; поля деталей едут «транспортом»
   под будущий экран деталей услуги — показ в текущем UI не строится
   (решение владельца, вариант 2); allowlist-запись.
5. **Гарды 5 bare GET словарей (T3, `c5243d99`+`9b6e235a` standard)** —
   `GET /masters` → `masters:read`, `GET /services` и
   `GET /services/{id}` → `services:read`, `GET /tags` и
   `GET /tags/{id}` → `tags:read` — аноним и клиентская сессия → 401;
   5 записей вычищены из `PUBLIC_ROUTES` (последний анонимный bare
   словарь — теги — закрыт; собственной витрины у тегов нет — без
   анонимного потребителя, осознанное сужение волны относительно
   формулировки ADR-015 clause 4).
6. **Scope-контракт + зеркала докстрингов (T3 фикс, `4699a2f8`)** —
   витринные маршруты внесены в `_PUBLIC_GETS` (носитель перечня
   allowlist в scope-contract-тесте, канон #600/#601); докстринги
   носителей и витринных схем синхронизированы.
7. **Предикаты видимости витрин (T4, `cfa3ddca` standard)** — публичная
   витрина занятий #600 и публичная фотогалерея #493 исключают услуги
   скрытые (`is_public = false`) или архивные (NULL-безопасно,
   серверная фильтрация); админ-поверхности не тронуты — видят всё.
8. **Бронь скрытой услуги → 404 (T4, `a321686a` standard)** — предикат
   видимости в пробе существования `my_booking` ДО валидации тарифа —
   ответ байт-в-байт паритетен несуществующему (канон #600, без
   бокового канала 422-против-404).
9. **api-client (T5, `9ed1c0dd`+`47108ee6` standard)** —
   `getPublicMasters`/`getPublicServices` + zod-схемы по прецеденту
   #600/#601; легаси `getMasters` удалён — admin-потребители
   переехали на `getAllMasters`.
10. **Web-форма записи на витрины (T6, `29e47b26` standard)** —
    `useSchedule`/`buildSchedule` переведены на публичные словари:
    все 4 справочника формы (занятия, локации, мастера, услуги)
    теперь с витринных маршрутов; staff-словари из web не читаются.
11. **Админ-UI (T7, `ffd1c3a9` small)** — switch «Видно клиентам» в
    модалке услуги + бейдж «Не в web» в таблице /services (зеркало
    #601, донор toggle-private/бейджа локаций).
12. **E2E (T8, `da4f8336`+`8a9aa085` standard)** — admin
    `services-web-hidden.spec.ts` (3/3) + web
    `services-web-visibility.spec.ts` (3/3, фикстура
    `service-visibility-pair.ts`) + анонимная регресс-сеть (14/14 —
    словари/витрины под анонимом на новом base).

## Отклонения и фикс-циклы

- Девиаций от спеки рев.4 нет; спека и план — на main до старта волны,
  IMPL их не касался.
- **DoD-заметки:**
  - #599 (мастера: structured specialty) не смержен — витринный
    `specialty` оставлен plain string с комментарием-провенансом;
    адаптация — на IMPL этой волны по спеке §3.5 (владелец адаптации —
    волна #606, зафиксировано рев.4).
  - #584-пересечение (волна /my на том же сегменте auth/public.py)
    закрыто ребейзом на новый base: пин-тесты `_PUBLIC_GETS` и
    клиентская ветка 401 живут на актуальном перечне.
- **Visual gate**: §7 спеки — машинная проверка (бейдж «Не в web» на
  /services desktop) пройдена раннером **EXIT 0**; пункт модалки —
  MANUAL_REVIEW по дизайну спеки (раннер не кликает — канон харнесса
  #602), автоматизация делегирована admin-e2e.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| Backend: флаг/миграция/staff-контракт/аудит/сид (T1) | **21/21** (+**135/135** регрессия) |
| Backend: витринные справочники (T2) | **115/115** |
| Backend: гарды 5 bare GET + auth-контракт (T3) | **117/117** |
| Backend: предикаты видимости/бронь (T4) | **152/152** |
| api-client vitest (T5) | **611/611** |
| admin vitest (T7) | **3204/3204**, typecheck + lint чистые |
| web vitest (T6) | **572/572**, typecheck чистый |
| admin-e2e `services-web-hidden` (T8) | **3/3** |
| web-e2e `services-web-visibility` (T8) | **3/3** + анонимная регресс-сеть **14/14** |
| Visual compliance gate | **EXIT 0** (бейдж на /services desktop; модалка — MANUAL_REVIEW → admin-e2e) |
| Полный CI | гейт PR (manager-owned) |

Приёмка: все 10 сценариев спеки §4 покрыты (юнит/API/e2e); behavioral
delta §5 реализована. Код-комплаенс ревью пройдено на каждой задаче.

## Behavioral Delta

Владелец скрывает услугу с сайта одним переключателем «Видно клиентам»:
скрытая услуга исчезает из витринного словаря `GET /public/services`,
её занятия — из публичной витрины занятий #600, её фото — из публичной
фотогалереи; бронь по прямому id скрытой услуги → 404 для клиента
(паритет несуществующей). Все 5 bare GET словарей (мастера, услуги,
услуга по id, теги, тег по id) стали staff-only — аноним и клиентская
сессия получают 401; анонимные потребители — только витрины
`/public/masters` (5 полей действующих мастеров) и
`/public/services` (форма + детали + specialty, вложенные тарифы/
материалы, теги строками). Веб-форма записи читает все 4 справочника
с витринных маршрутов; `getMasters` удалён из api-client. Админка не
меняется (видит всё), получает switch и бейдж «Не в web».

## Известные остатки (follow-up-кандидаты, не в этом PR)

- Вне волны по спеке §2: rate limiting и `Cache-Control` для
  `/public/*` (#609), витринные by-id эндпоинты (без потребителей),
  видимость фото ЛОКАЦИЙ в галерее (унаследовано из #601 — кандидат
  в отдельную задачу, §8), отображение полей деталей услуги в web
  (вместе с будущим экраном деталей).
- Адаптация витринного `specialty` под structured-формат — при мерже
  #599 (комментарий-провенанс в схеме).

## PR-заметки

- `Closes #606` — только в описании PR (канон репо), в коммиты не
  пишется.
- Спека рев.4 и план (8/8) — на main, unchanged by IMPL; docser-коммит —
  только мета-доки (PLAN.md, CHANGELOG.md, этот файл).
- Доска: карточка #606 остаётся `In IMPL` до создания PR (перевод в
  `PR (G7)` — на моменте `gh pr create`, не docser).

## Тронутые файлы (`git diff --name-only 923ad95e..8a9aa085`)

```
backend/alembic/versions/d4f6a8b0c2e1_add_is_public_to_services.py
backend/seed-data/README.md
backend/seed-data/services.yaml
backend/src/api/v1/masters.py
backend/src/api/v1/public.py
backend/src/api/v1/services.py
backend/src/api/v1/tags.py
backend/src/auth/public.py
backend/src/models/service.py
backend/src/schemas/master.py
backend/src/schemas/service.py
backend/src/seed/reference.py
backend/src/services/activity.py
backend/src/services/master.py
backend/src/services/photo.py
backend/src/services/service.py
backend/src/usecases/my_booking.py
backend/tests/test_api_my.py
backend/tests/test_api_photos.py
backend/tests/test_auth_guards.py
backend/tests/test_auth_permissions.py
backend/tests/test_dictionaries_guard.py
backend/tests/test_master_scope_contract.py
backend/tests/test_my_records_api.py
backend/tests/test_public_activities_api.py
backend/tests/test_public_masters_api.py
backend/tests/test_public_services_api.py
backend/tests/test_seed_reference.py
backend/tests/test_service_is_public.py
frontend/admin/__tests__/ClientQuickCard.test.tsx
frontend/admin/__tests__/PhotosContext.test.tsx
frontend/admin/__tests__/RecordsFilters.test.tsx
frontend/admin/__tests__/ServiceModal.test.tsx
frontend/admin/__tests__/ServicesTable.test.tsx
frontend/admin/__tests__/buildAdminSchedule.test.ts
frontend/admin/__tests__/helpers/mockData.ts
frontend/admin/__tests__/photos/PhotosFilters.test.tsx
frontend/admin/__tests__/photos/photoColumns.test.tsx
frontend/admin/__tests__/recordsTimeParity.test.ts
frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx
frontend/admin/__tests__/scheduleIntegration.test.tsx
frontend/admin/__tests__/serviceColumns.test.tsx
frontend/admin/__tests__/timezone-dnd-bug.test.ts
frontend/admin/__tests__/transformers.test.ts
frontend/admin/__tests__/useDeleteService.test.ts
frontend/admin/__tests__/useReactQueryHooks.test.tsx
frontend/admin/__tests__/useRecordData.test.tsx
frontend/admin/__tests__/useServicesMutations.test.ts
frontend/admin/app/(main)/services/components/ServiceModal.tsx
frontend/admin/app/(main)/services/components/ServicesTable.tsx
frontend/admin/app/(main)/services/components/serviceColumns.tsx
frontend/admin/app/(main)/services/components/serviceFields.tsx
frontend/admin/e2e/services-web-hidden.spec.ts
frontend/web/app/hooks/__tests__/useLocations.test.tsx
frontend/web/app/hooks/__tests__/useSchedule.test.tsx
frontend/web/app/hooks/useSchedule.ts
frontend/web/app/lib/mappers/__tests__/buildSchedule.test.ts
frontend/web/app/lib/mappers/__tests__/integration-schedule.test.ts
frontend/web/app/lib/mappers/buildSchedule.ts
frontend/web/e2e/fixtures/service-visibility-pair.ts
frontend/web/e2e/locations-web-visibility.spec.ts
frontend/web/e2e/services-web-visibility.spec.ts
packages/api-client/src/__fixtures__/backend-responses.json
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
```

## References

- **GitHub Issue**: #606
- **Design Spec**: `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` (рев.4)
- **Plan**: `docs/plans/2026-11-14-adr015-dictionaries-606-plan.md` (8/8)
- **ADR**: `docs/decisions/015-api-url-audience-namespaces.md` (clause 4 — словари)
- **Смежные**: #600 (витрина занятий, механизм гардов/404-паритета),
  #601 (зеркало флага `is_public`, канон записи PATCH-строкой),
  #493 (прецедент публичного контракта), #599 (structured specialty —
  не смержен, адаптация у IMPL), #609 (rate limiting `/public/*`)
- **PR**: _(to be added after PR creation)_
