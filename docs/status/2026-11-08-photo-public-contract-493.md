# GH #493 — Публичный фото-контракт: `GET /api/v1/public/photos` + закрытие голых фото-GET от анонима

- **Date**: 2026-11-08
- **Branch**: `493-photo-public-contract`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `f02b474a` — 7 коммитов (`b0110abf..b901a651`), 25 файлов,
  +456/−161
- **Issue**: #493 — публичный фото-контракт: анонимная витрина получает
  собственный маршрут `GET /api/v1/public/photos` с минимальной
  per-audience-схемой `PhotoPublicResponse` (первый резидент ADR-015 —
  `docs/decisions/015-api-url-audience-namespaces.md`, уже на main), а голые
  `GET /photos` / `GET /photos/{id}` закрываются от анонима гардом
  `photos:read`; api-client (`getPublicPhotos`) и web-галерея (`useGallery`)
  переезжают на публичный маршрут
- **Спека**: `docs/specs/2026-11-08-photo-public-contract-design.md` (рев.3)
- **План**: `docs/plans/2026-11-08-photo-public-contract-plan.md` — 6/6
  задач, все done (оба на main, unchanged by IMPL)
- **Domain rules**: `docs/domain-rules/photos.md` (публичная витрина) +
  `docs/domain-rules/auth.md` (фото-словарь больше не анонимный) —
  синхронизированы этой веткой

## Что выполнено

1. **Публичная витрина (T1, `b0110abf`, standard)** —
   `GET /api/v1/public/photos` в новом `src/api/v1/public.py` (router
   включён в `main.py`): пагинированный список только публичных фото —
   `is_public=True` принудителен на сервере и не является параметром,
   зафиксированный сорт `created_at desc, id asc`, владельческие фильтры
   не проводятся, неизвестные query-параметры игнорируются (конвенция
   репо — тихий результат, не 4xx); минимальная per-audience-схема
   `PhotoPublicResponse` (`id`/`filename`/теги — строки-заголовки,
   разрешает сервер; никогда админ-контракт — прецедент `MyPhotoItem`,
   `schemas/my.py`); чтение — свободная функция `list_public_photos_view`
   в `services/photo.py` (коридор 3); префикс сам по себе ничего не
   открывает — явная запись в allowlist `PUBLIC_ROUTES`
   (`src/auth/public.py`, default-deny).
2. **Голые GET закрыты (T2, `e036a88d`, standard)** — `GET /photos` и
   `GET /photos/{id}` под `require_permission("photos:read")` (модульный
   `_READ_GUARD`), аноним → 401; фото-словарь убран из allowlist
   `PUBLIC_ROUTES`; скоуп-сужение вошедшего мастера сохранено
   (`get_optional_scope`); сателлит `8ae17758` — устаревшие
   public-posture докстринги тестов переведены на
   `/api/v1/public/photos`.
3. **api-client (T3, `59ba1a04`, standard)** —
   `PhotoPublicResponseSchema` / `PhotoPublicListResponseSchema`
   (zod-зеркала) + `getPublicPhotos(params?: {id[], page, per_page})`
   на `/api/v1/public/photos`; `is_public` — не параметр.
4. **Web-галерея (T4, `a9561b44`, standard)** — `useGallery` переведён
   на `getPublicPhotos` (публичный маршрут вместо
   `getPhotos({is_public: true})`), маппер `to-gallery-vm` (подписи из
   тегов), юниты хука/маппера/страницы обновлены.
5. **Чистка (T5, `05aef55d`, trivial)** — устаревший wiring-комментарий
   в `records.py` указывает на #499 (актуальный владелец анонимной
   записи).
6. **Domain rules + верификация (T6, `b901a651`, small)** —
   `docs/domain-rules/photos.md`: публичная витрина на собственном
   маршруте; `docs/domain-rules/auth.md`: `photos` убран из анонимного
   перечисления — голые GET только для сотрудников; полный прогон
   верификации (таблица ниже).

## Верификация (финальное дерево, `b901a651`)

| Проверка | Результат |
| --- | --- |
| Backend полный pytest | **3954 passed / 71 skipped / 0 failed** (exit 0) |
| ruff + lint-бюджет | **зелёные** (mypy 0) |
| api-client vitest | **571/571** + `tsc` чист + build чист |
| web vitest | **493/493** + `tsc` чист |
| Визуальный комплаенс-гейт | **exit 0** (секция §7 спеки = N/A) |

## DoD-статус

- Публичный маршрут: минимальная схема, принудительный `is_public`,
  зафиксированный сорт, allowlist-запись ✅.
- Голые GET: `photos:read` на обоих, аноним → 401, allowlist −2,
  мастер-сужение сохранено ✅.
- api-client: `getPublicPhotos` + зеркала, tsc/build чистые ✅.
- Web: `useGallery` на публичном маршруте, тесты зелёные ✅.
- Domain rules: `photos.md` + `auth.md` синхронизированы ✅.
- Сценарии 1–5 спеки покрыты тестами ✅ (4–5 — существующими
  admin/master-сьютами); все DoD плана закрыты.

## Behavioral Delta

Анонимный гость видит галерею как раньше (те же публичные фото), но
теперь через собственный контракт `GET /api/v1/public/photos` с
минимальной схемой — админ-поля (владельцы, `is_public`, служебные
метаданные) больше не утекают в публичный ответ. Голые
`GET /photos` / `GET /photos/{id}` стали сотрудническими
(`photos:read`): аноним получает 401 вместо полного админ-контракта.
Для сотрудников и мастеров поведение обоих эндпоинтов не менялось
(мастер по-прежнему видит сужение к своим строкам). Web-галерея и
api-client — единственные потребители, обе мигрированы.

## PR-заметки

- `Closes #493` — только в описании PR (канон репо), в коммиты не пишется.
- ADR-015 (`docs/decisions/015-api-url-audience-namespaces.md`) уже на
  main — ветка реализует первого резидента namespace `/api/v1/public`.

## Тронутые файлы (`git diff --name-only f02b474a..b901a651`)

```
backend/src/api/v1/photos.py
backend/src/api/v1/public.py
backend/src/api/v1/records.py
backend/src/auth/public.py
backend/src/main.py
backend/src/schemas/photo.py
backend/src/services/photo.py
backend/tests/test_api_photos.py
backend/tests/test_auth_guards.py
backend/tests/test_auth_permissions.py
backend/tests/test_list_id_uniform_guards.py
backend/tests/test_master_scope_contract.py
backend/tests/test_master_scope_photos.py
docs/domain-rules/auth.md
docs/domain-rules/photos.md
frontend/web/app/__tests__/GuestGallery.test.tsx
frontend/web/app/__tests__/page.test.tsx
frontend/web/app/hooks/__tests__/useGallery.test.tsx
frontend/web/app/hooks/useGallery.ts
frontend/web/app/lib/mappers/__tests__/to-gallery-vm.test.ts
frontend/web/app/lib/mappers/to-gallery-vm.ts
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-11-08-photo-public-contract-493.md` — только
мета-доки; код/спеки/планы/domain-rules не тронуты.

## References

- **GitHub Issue**: #493
- **Design Spec**: `docs/specs/2026-11-08-photo-public-contract-design.md` (рев.3)
- **Plan**: `docs/plans/2026-11-08-photo-public-contract-plan.md` (6/6)
- **ADR**: `docs/decisions/015-api-url-audience-namespaces.md`
- **PR**: _(to be added after PR creation)_
