# План: фильтры Записей/Клиентов/Фото в строку таблицы (#412)

## Goal

Реализовать спеку `docs/specs/2026-10-19-filters-inline-412-design.md`: панели фильтров трёх страниц админки (Записи, Клиенты, Фото) переезжают в шапку общего `DataTable` (слот `toolbarLead`), внешние карточки упраздняются, тулбар допускает перенос левой группы; справочники не меняются. Behavioral Delta — в спеке §5.

## Architecture

Только `frontend/admin`. Общий компонент `DataTable` получает растягиваемую левую группу тулбара с переносом (правая группа — действия/настройки — без изменений); три страницы монтируют существующие панели фильтров в `toolbarLead` вместо внешней карточки; корневой контейнер `ClientsFilters` переводится с вертикального стека на плоский перенос; чип глубокой ссылки клиента — рядом с панелью. URL-хуки (#349), состав полей, бэкенд — без изменений; правки доменных правил не планируются (`docs/domain-rules/clients.md` — только сверка формулировок, Task 3/4). Машинные проверки чеклиста `## Visual Compliance Checks` спеки автоматизируются в существующем `frontend/admin/e2e/visual-compliance-checks.spec.ts` (по задачам 2–5). Эталонные снимки трёх страниц перегоняются штатным `update-snapshots.yml` с гардами спеки §7.

## Tech Stack

Next.js (App Router), React, TypeScript, Tailwind CSS (`flex flex-wrap items-end gap-3`); Vitest + Testing Library — юнит-тесты панелей и страниц; Playwright — e2e и визуальные прогоны; GitHub Actions — `update-snapshots.yml` (перегон базлайнов), `test.yml` (контрольный прогон после бото-коммита).

## Task 1: Переносимая левая группа тулбара DataTable + канон в design-system

### Classification: standard

Реализует основу сценариев US-1–US-3; гард-основа US-6.

- `app/components/shared/DataTable.tsx`: левая группа тулбара растягивается на доступную ширину и допускает перенос (`flex-1 min-w-0` + `flex-wrap` на контейнере панели); правая группа (поиск/статус, шестерёнка) — без переноса, прижата вправо первой строки, разметка не меняется. `role="toolbar"` не добавляется — панель фильтров остаётся группой полей формы.
- Существующие потребители `toolbarLead` (справочники) не правятся: их 2–3 контрола переношены не будут.
- `docs/design-system.md`: новый подраздел о табличном тулбаре (структура лево/право, слот, перенос левой группы, «фильтры всех списковых страниц — в строке тулбара», граница фильтры-действия) — содержание по спеке §3.4.
- Юнит-тесты: обёртка тулбара рендерит `toolbarLead` в левой группе (существующие тесты DataTable зелёные; при отсутствии — добавить минимальный рендер-кейс).
- DoD: юнит-тесты зелёные; страница «Локации» визуально идентична прежней (базлайны не перегоняются, полный гард — Task 7). E2E test for scenario US-6 (справочники без регресса) passes (RED-GREEN-REFACTOR — финальная сверка в Task 7).

### Required Docs

- `docs/design-system.md` (новый подраздел табличного тулбара)
- `docs/specs/2026-10-19-filters-inline-412-design.md` (§3.1, §3.4)

## Task 2: US-1 — панель Записей в тулбаре

### Classification: standard

- `app/(main)/records/page.tsx`: `RecordsFilters` монтируется в `toolbarLead` таблицы; внешняя карточка удаляется; встроенные поиск/статус `DataTable` остаются выключенными.
- `RecordsFilters.tsx`: на корневой контейнер добавляется `data-testid="records-filters"`; состав полей, подписи, debounce 300 мс, префиксы (`records-filters-status` и остальные) — без изменений.
- Тесты: `__tests__/RecordsFilters*.test.tsx` — зелёные без правок контрактов (уточнить точку монтирования при необходимости); page-тесты страницы Записей — обновить композицию (карточка → тулбар).
- E2E `e2e/records.spec.ts`: существующие кейсы фильтров проходят без правки локаторов (`records-filters-status-trigger` сохранён); добавить кейс US-1: панель в шапке таблицы, применение статуса и периода обновляет таблицу и адрес.
- DoD: E2E test for scenario US-1 passes (RED-GREEN-REFACTOR).

### Required Docs

- `docs/design-system.md` (подраздел табличного тулбара из Task 1)
- `docs/specs/2026-10-19-filters-inline-412-design.md` (§3.2)

## Task 3: US-2 — панель Клиентов в тулбаре

### Classification: standard

- `app/(main)/clients/components/ClientsFilters.tsx`: корневой контейнер `space-y-3` → `flex flex-wrap items-end gap-3` (поиск — обычный контрол строки, полноширинность снимается); добавляется `data-testid="clients-filters"`; состав полей и поведение — без изменений.
- `app/(main)/clients/page.tsx`: панель монтируется в `toolbarLead`; внешняя карточка удаляется.
- Тесты: `__tests__/ClientsFilters.test.tsx` (32 кейса) — правки только на компоновку корня; `__tests__/ClientsPage.test.tsx` (34) — обновить композицию страницы.
- E2E: узкий viewport — поля раскладываются в несколько строк без горизонтальной прокрутки; применение пары дат («записи от/до») фильтрует таблицу; «Сбросить фильтры» очищает поля и адрес.
- DoD: E2E test for scenario US-2 passes (RED-GREEN-REFACTOR).

### Required Docs

- `docs/domain-rules/clients.md` (семантика deep-link — не меняется, сверить формулировки)
- `docs/design-system.md` (подраздел табличного тулбара)

## Task 4: US-4 — чип глубокой ссылки клиента в тулбаре (после Task 3)

### Classification: small

- `app/(main)/clients/page.tsx`: чип (компонент `ClientDeepLinkChip`) монтируется в `toolbarLead` рядом с панелью (фрагмент), вне корня `clients-filters`, визуально после панели.
- Контейнер чипа: `data-testid="client-deep-link-chip"`; кнопка закрытия — доступное имя «Убрать фильтр по клиенту: <имя>»; после закрытия фокус переходит на панель фильтров (не на страницу).
- E2E: переход по адресу с выбранным клиентом (`clientIds`) — фильтры применены, чип виден в шапке; закрытие чипа снимает фильтр; фокус — на панели.
- DoD: E2E test for scenario US-4 passes (RED-GREEN-REFACTOR).

### Required Docs

- `docs/domain-rules/clients.md` (контракт `clientIds`)
- `docs/specs/2026-10-19-filters-inline-412-design.md` (§3.2, доступность чипа)

## Task 5: US-3 — панель Фото в тулбаре

### Classification: standard

- `app/(main)/photos/page.tsx`: `PhotosFilters` монтируется в `toolbarLead`; внешняя карточка удаляется; `data-testid="photos-filters"` на корень.
- Блок тегов без изменений: чипы над typeahead в ячейке прежней ширины (`w-56`), перенос чипов внутри блока; механика сброса с `resetKey` сохраняется; новых key-обёрток не добавляется.
- Тесты: `__tests__/photos/PhotosFilters.test.tsx` (11), `PhotosPage.test.tsx` — точки монтирования.
- E2E: добавление тега через typeahead — чип в шапке таблицы; закрытие чипа «×» снимает тег; сценарий с несколькими тегами (вложенный перенос) — все чипы видимы и доступны.
- DoD: E2E test for scenario US-3 passes (RED-GREEN-REFACTOR).

### Required Docs

- `docs/design-system.md` (подраздел табличного тулбара)
- `docs/specs/2026-10-19-filters-inline-412-design.md` (§3.2)

## Task 6: US-5 — старые ссылки открывают отфильтрованное состояние

### Classification: small

- E2E-сценарий на три страницы: переход по адресам с параметрами фильтров, сохранённым до переезда (`/records?from=…&to=…&q=…`; `/clients?clientIds=…&status=…`; `/photos?tag_id=…`) — фильтры применены, значения отражаются в контролях шапки.
- Изменений кода не предполагает; падение = нарушение контракта #349 — фиксить в месте поломки, не в тесте.
- DoD: E2E test for scenario US-5 passes (RED-GREEN-REFACTOR).

### Required Docs

- `docs/specs/2026-10-19-filters-inline-412-design.md` (§3.3 — что не меняется)

## Task 7: US-6 — перегон базлайнов тройки с гардами и контрольный прогон

### Classification: small

- Диспетчеризация `update-snapshots.yml` (режим `changed`) на ветке импла — перегон эталонных снимков records (8), clients (7), photos (7).
- Гард полноты бото-коммита: diff трогает только базлайны тройки; файлы базлайнов остальных таблиц побайтово не меняются; новые файлы базлайнов вне тройки отсутствуют. Нарушение = стоп и разбор, не перегон и не правка чужих базлайнов.
- Контрольный прогон CI (`test.yml`) на коммите после бото-пуша (пуш от токена GitHub Actions не запускает workflows сам) — визуальный прогон зелёный, справочники не деградировали (US-6). Мерж PR только после зелёного контрольного прогона.
- DoD: E2E test for scenario US-6 passes (визуальный прогон CI без перегона чужих базлайнов).

### Required Docs

- `docs/specs/2026-10-19-filters-inline-412-design.md` (§7 — DoD и гарды)
