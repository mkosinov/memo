# План: #231 — deep-link клиентов: один запрос вместо двух

- **Issue:** #231
- **Спека:** `docs/specs/2026-09-19-clients-deeplink-single-request-design.md` (rev3)
- **Дата:** 2026-09-20
- **Статус:** Gate C

## Goal

Переход по `/clients?clientId=X` стреляет ровно **один** суженный GET вместо двух (мусорный дефолтный умирает), карточка открывается по первому ответу. Обычный `/clients`, поиск, сортировка, «Сбросить фильтры», механика снятия параметра — без изменений. Behavioral Delta — в спеке §4.

## Architecture

Две точки правки (спека §5):

1. **Фабрика** `frontend/admin/contexts/createPagedListContext.tsx` — необязательный проп провайдера `initialFilters?: Partial<F>`: ленивый инициализатор `useState` мержит проп поверх `config.filters?.defaults` однократно при монтировании; тип добавляется только в with-filters перегрузку экспортного типа. URL фабрика не читает.
2. **Страница** `frontend/admin/app/(main)/clients/page.tsx` — перестройка границы (спека §5.2): `Suspense` наверх; новый `ClientsPageInner` читает `useSearchParams()` во время рендера и монтирует `ClientsProvider` с затравкой `{ search: clientId, status: 'all' }` (значение дословно, без валидации); `GridSettingsProvider` внутри, порядок #138 сохранён; **удаляется только** эффект `setFilters` (:32-36) — эффекты сброса latch (:40-44), поиска-и-открытия модалки (:49-61), зачистки мёртвой ссылки (:63-76) и снятия параметра при закрытии (:117-120) не трогаются.

Канон `docs/domain-rules/clients.md` уже обновлён коммитом спеки (`774dc57`) — реализация обязана ему соответствовать (сид при монтировании, параметр после монтирования не подхватывается).

## Tech Stack

React 18 + Next.js App Router (`useSearchParams` требует Suspense-границу — прецедент #138), React Query v5 (ключ включает объект фильтров целиком), vitest + Testing Library (unit), Playwright (e2e, приём US-1 `page.on('request')`). Без изменений бэкенда, API-контракта и api-client.

## Task 1 — Фабрика: проп `initialFilters` + сид

**Классификация:** small
**Сценарии:** базис S1/S2 (сид — общая точка обоих), строка дельты «Сбросить фильтры».
**Required Docs:** спека §5.1, §6 (unit, фабрика); канон `docs/domain-rules/clients.md` (пункт Deep-link).

- Внутренний провайдер (:143): сигнатура получает `initialFilters?: Partial<F>`; сид (:150) — ленивый инициализатор `useState<F | undefined>(() => initialFilters ? { ...filtersDefaults, ...initialFilters } : filtersDefaults)`. Merge-семантика = `setFilters` (:201-204). Смена пропа после монтирования игнорируется.
- Экспортный тип: проп только в with-filters перегрузке (:121); классическая (:125) остаётся `{ children }`.
- Не трогать: `setFilters`/`resetFilters`, ключ запроса (:160-166), кламп (:155), `keepPreviousData`.
- Unit (`__tests__/ClientsContext.factory.test.tsx`): сид мержится поверх дефолтов; без пропа — дефолты конфига; смена пропа после монтирования не меняет состояние; `resetFilters` возвращает конфиговые дефолты, не сид.

## Task 2 — Страница: перестройка границы + перепись тестов эффект-эры

**Классификация:** standard
**Сценарии:** S1 (сужение без второго запроса — структурная часть), S2 (обычный монтаж), S3 (закрытие сохраняет сужение — эффекты не тронуты).
**Required Docs:** спека §5.2, §5.3, §6 (unit, страница); канон `docs/domain-rules/clients.md`.

- Целевое дерево: `ClientsPage` → `Suspense` (фолбэк прежний) → `ClientsPageInner` (читает параметр во время рендера; при наличии — затравка `{ search: clientId, status: 'all' }`, иначе проп не передаётся) → `ClientsProvider initialFilters?` → `GridSettingsProvider` → `ClientsPageContent`.
- Удалить эффект `setFilters` (:32-36). Остальные четыре эффекта #216 — построчно без изменений.
- Переписать два юнит-теста `__tests__/ClientsPage.test.tsx` эффект-эры: «deep-link narrows via setFilters» (:337-350) → ассерт, что мок `ClientsProvider` получил `initialFilters={ search: id, status: 'all' }`; «no param: setFilters not called» (:354-366) → ассерт, что проп не передан. Проверить мок-каркас на новую структуру (Suspense/Inner) — мок `GridSettingsProvider` и анти-регрессия `ScheduleProvider` (:12-26) сохраняются.
- Тесты find-эффекта/закрытия модалки не меняются (эффекты живы).

## Task 3 — E2E: счётчик «ровно один запрос»

**Классификация:** small
**Сценарии:** S1.
**Required Docs:** спека §6 (e2e), §3 S1; приём US-1 `frontend/admin/e2e/clients.spec.ts:770-786`.

- Новый тест в describe «Deep-link ?clientId= — #216»: слушатель `page.on('request')` регистрируется **до** `goto` и считает **все** `/api/v1/clients*` (предфильтр по `q=` запрещён — скрыл бы убитый дефолтный запрос); подготовка данных через `request`-фикстуру (в счётчик не попадает); окно: `goto('/clients?clientId=' + id)` → ожидание суженного ответа → +500 мс; ассерты: длина счётчика === 1 и URL запроса содержит `q=<uuid>` и `status=all`.
- Тест 19 не правится; S2-счётчик сознательно не строится (спека §6).

## Task 4 — Зелёная верификация перед PR

**Классификация:** trivial
**Сценарии:** S2, S4 (неизменное поведение под существующими зелёными тестами), S3 (хвост теста 19).
**Required Docs:** спека §7.

- vitest: `ClientsContext.factory.test.tsx`, `ClientsPage.test.tsx` (+ смежные клиенты-тесты).
- Playwright: `clients.spec.ts` целиком — тест 19 зелёный без правок ассертов; новый счётчик стабильно зелёный (3 прогона подряд при сомнении — остаточный риск флейка принят в спеке §6).
- Линт/тайпчек фронта, штатный green-check перед пушем PR.

## Out of scope

Живая URL-синхронизация фильтров (#349), `?id=` + серверное разрешение страницы (#232), подхват параметра после монтирования, верхний кламп длины затравки (спека §5.3).
