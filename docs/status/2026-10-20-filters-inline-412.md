# GH #412 — Фильтры Записей/Клиентов/Фото в строку таблицы (единый DataTable)

- **Date**: 2026-10-20
- **Branch**: `412-filters-inline`
- **Status**: Completed (PR pending — открывается после этого docs-коммита; CI-watch/merge на finishing/@manager)
- **Range**: base `f7190cae` (merge-base) — 11 коммитов (`59a2814f..7765edcf`, pushed) + merge `a41095e7` origin/main (PR #502/#503 + docs #479 — авто-мерж, единственный общий файл `e2e/fixtures/helpers.ts`); feature-диф 47 файлов (+1116/−166) = 24 кода/доков + 23 PNG-базлайна
- **Issue**: #412 — фильтры трёх табличных страниц в строку таблицы (тулбар DataTable)
- **Спека**: `docs/specs/2026-10-19-filters-inline-412-design.md` (рев.1 после панели 6 ревьюеров) — на main, unchanged by IMPL
- **План**: `docs/plans/2026-10-19-filters-inline-412-plan.md` — 7 задач, 7/7 DONE, two-stage reviews passed — на main, unchanged by IMPL
- **Характер**: frontend/admin-only + docs — бэкенд, api-client, URL-контракты #349 не тронуты (проверено: в feature-дифе нет файлов `backend/` и `packages/`)

## Что выполнено

1. **Переносимая левая группа тулбара DataTable (T1, `59a2814f`, standard)** —
   выделенная левая группа тулбара в общем `DataTable.tsx` (слот под панели
   фильтров), канон табличного тулбара зафиксирован в `docs/design-system.md`
   (T1-доки `b6f996b6`, спека §3.4).
2. **US-1 — панель Записей в тулбаре (T2, `1b22eecb`, standard)** — фильтры
   `RecordsFilters` переехали из блока над таблицей в тулбар DataTable; новый
   `__tests__/RecordsPage.test.tsx`; e2e US-1 в `records.spec.ts`.
3. **US-2 — панель Клиентов в тулбаре (T3, `2f161bbd`, standard)** — аналогичный
   переезд на `/clients` (корень страницы → `flex flex-wrap`); fix-loop:
   e2e-пара «Записи от/до» вместо «Создан» (`836d05c1`).
4. **US-4 — чип глубокой ссылки клиента в тулбаре (T4, `97aadd4b`, small)** —
   чип `?clientId=` переехал в тулбар (компонент
   `ClientDeepLinkChip.tsx` + юнит); fix-loop: stale locator в
   `clients-url-filters.spec.ts` — новое доступное имя ✕-чипа (`513e3326`).
5. **US-3 — панель Фото в тулбаре (T5, `ce58d913`, standard)** — фильтры
   `/photos` в тулбаре; блок тегов нетронут. **Approved deviation**: встроенный
   поиск Фото остался включён — был включён до переезда, инвариант §3.3 спеки.
6. **US-5 — e2e старых ссылок (T6, `0305bd0c`, small)** — контракт #349
   подтверждён: старые ссылки с параметрами фильтров открывают
   отфильтрованное состояние. **Факт, зафиксирован**: реальный URL-параметр —
   `clientId` (singular, канон #349/#231); плановское `clientIds` — только имя
   внутреннего состояния, в URL не живёт.
7. **US-6 — перегон базлайнов тройки (T7, `7765edcf` — бото-коммит)** —
   `update-snapshots.yml` (mode=changed, run 39) регенерировал ровно
   **23 базлайна** тройки (clients 7, photos 7, records 9); гард §7 пройден —
   чужие базлайны байтово нетронуты, новых нет.
8. **Внеплановый фикс (mid-phase)** — `be3c7821`: e2e
   `clients-status-column.spec.ts` — коллизия `getByLabel('Статус')` с новым
   именем чипа после US-4; локатор переведён на role+name чекбокса.
9. **Merge origin/main (mid-phase)** — `a41095e7`: PR #502 (#429 телефонная
   гигиена тестов) + #503 (снос sqladmin-тестов) + docs #479; авто-мерж,
   единственный содержательный общий файл — `e2e/fixtures/helpers.ts`.

## Верификация

| Проверка | Результат |
| --- | --- |
| Admin vitest (полный) | **3080/3080** (185 файлов, exit 0) |
| e2e records (локально) | **31/31** |
| e2e clients (локально) | **32/32** |
| e2e clients-url-filters | **4/4** |
| e2e photos-crud | **21/21** |
| e2e clients-status-column | **3/3** |
| Контрольный прогон CI `test.yml` (run 39443080031) | **18/18 checks SUCCESS** |
| US-6 гард §7 (чужие базлайны) | байтово нетронуты, новых нет |

## DoD-статус (спека §7)

- US-1–US-5 закрыты E2E (RED-GREEN). ✅
- US-6 — зелёный визуальный CI без перегона чужих базлайнов. ✅
- Юнит-тесты панелей зелёные без правки контрактов. ✅
- `docs/design-system.md` дополнен каноном тулбара. ✅
- Ветка не содержит изменений бэкенда и URL-контрактов. ✅

## PR-заметки

- `Closes #412` — только в описании PR (канон репо), в коммиты не пишется.
- Визуальная дельта ожидаемо затронула только базлайны тройки
  records/clients/photos (тулбар с фильтрами выше таблицы).
- Approved deviation (поиск Фото) и факт `clientId` (singular) задокументированы
  выше — расхождений с каноном #349 нет.

## Тронутые файлы (feature-диф `59a2814f^..7765edcf`, 47 файлов +1116/−166)

```
docs/design-system.md
frontend/admin/__tests__/ClientDeepLinkChip.test.tsx
frontend/admin/__tests__/ClientsFilters.test.tsx
frontend/admin/__tests__/ClientsPage.test.tsx
frontend/admin/__tests__/DataTable.test.tsx
frontend/admin/__tests__/RecordsPage.test.tsx          (новый)
frontend/admin/__tests__/helpers/mockData.ts
frontend/admin/__tests__/photos/PhotosPage.test.tsx
frontend/admin/app/(main)/clients/components/ClientDeepLinkChip.tsx
frontend/admin/app/(main)/clients/components/ClientsFilters.tsx
frontend/admin/app/(main)/clients/components/ClientsTable.tsx
frontend/admin/app/(main)/clients/page.tsx
frontend/admin/app/(main)/photos/components/PhotosFilters.tsx
frontend/admin/app/(main)/photos/components/PhotosTable.tsx
frontend/admin/app/(main)/photos/page.tsx
frontend/admin/app/(main)/records/components/RecordsFilters.tsx
frontend/admin/app/(main)/records/components/RecordsTable.tsx
frontend/admin/app/(main)/records/page.tsx
frontend/admin/app/components/shared/DataTable.tsx
frontend/admin/e2e/clients-status-column.spec.ts
frontend/admin/e2e/clients-url-filters.spec.ts
frontend/admin/e2e/clients.spec.ts
frontend/admin/e2e/fixtures/helpers.ts
frontend/admin/e2e/photos-crud.spec.ts
frontend/admin/e2e/records.spec.ts
+ 23 PNG-базлайна (clients 7, photos 7, records 9)
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` + `docs/status/2026-10-20-filters-inline-412.md`
— только мета-доки; код/спеки/планы/базлайны не тронуты.

## Scope guards

Продуктовый код тронут только в `frontend/admin` (фичевые коммиты); `backend/`,
`packages/` (api-client/domain) — ноль изменений в фичевых коммитах (файлы
бэкенда в диффе merge-base — только из смёрженного origin/main, PR #502/#503);
спека/план на main, docser их не касался; `Closes #412` — только в описании PR
(канон репо).

## References

- **GitHub Issue**: #412
- **Design Spec**: `docs/specs/2026-10-19-filters-inline-412-design.md` (рев.1)
- **Plan**: `docs/plans/2026-10-19-filters-inline-412-plan.md` (7/7 DONE)
- **PR**: _(to be added after PR creation)_
