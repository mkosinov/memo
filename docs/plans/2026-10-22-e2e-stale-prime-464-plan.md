# План: убрать 33с ожидание устаревания из S3 + единая константа окна отмены (#464)

## Цель

Выполнить спеку `docs/specs/2026-10-22-e2e-stale-prime-464-design.md` (рев. 1; Gate B пройден 2026-10-22 — спека в main, коммит fb029d88): закрыть временную половину ветки «перечитать при устаревании» юнит-тестом, удалить 33-секундную реальную выдержку из e2e-сценария S3 и свести интервал окна отмены к единой константе `UNDO_WINDOW_MS`. Продукт не меняется.

## Архитектура

Продукт не меняется; три зоны правки. Порядок задач фиксирован: задача 1 добавляет юнит-покрытие временной ветки ДО того, как задача 3 удалит e2e-носитель этой ветки (33-секундная выдержка — единственное текущее покрытие); задача 2 (константа) независима от обеих, но идёт до задачи 3, чтобы e2e-хелпер уже потреблял константу к моменту правки файла S3.

## Тех-стек

Vitest + @testing-library/react (юнит-тесты `frontend/admin/__tests__/`), фейковые таймеры Vitest (`vi.useFakeTimers` — прижившийся паттерн: `UIContext.test.tsx`, `Menubar.test.tsx`), React Query v5 (`queryClient`/`setQueryDefaults` в харнессе тестов контекста), Playwright (e2e, config `frontend/admin/playwright.config.ts`).

## Task 1: юнит-тест временной ветки устаревания

### Классификация: small

### Required Docs

- `docs/specs/2026-10-22-e2e-stale-prime-464-design.md` — «Контекст» (выявленный пробел: `dataUpdatedAt` не упоминается ни в одном юнит-тесте), «Изменения» (часть 3), «Нерушимые границы».
- `frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx` — существующий тест `:1281` (`isInvalidated` → `refetched=true`) как образец; харнесс `renderDataProvider`/`queryClient` того же файла.

1. Новый тест рядом с `:1281`, парный по форме: «кэш недели старше порога по возрасту данных → ensure-fresh срабатывает, `refetched=true`». Механика (все параметры зафиксированы): `vi.useFakeTimers()` ставится ДО заполнения кэша — метка `dataUpdatedAt` обязана лежать на фейковых часах; заполнить кэш недели данными через `queryClient` (как в существующих тестах файла); порог — `queryClient.setQueryDefaults(weekKey, { staleTime: 30_000 })` (значение приложения); состарить кэш одним сдвигом часов без срабатывания таймеров: `vi.setSystemTime(new Date(Date.now() + 31_000))`; вызвать `deleteActivityDeferred`; ассерты — по образцу `:1281`: счётчик вызовов запроса недели вырос и `refetched=true` в исходе (`delete-outcome`). Разбор: `vi.useRealTimers()` в `afterEach`/`finally` этого теста — файл после `:1281` полон тестов на реальных таймерах, утечка фейковых подвесит их `waitFor`.
2. Контраст-ветку (свежий кэш → `refetched=false`) НЕ дублировать — она закрыта тестом `:1302` (дедуп тестов).
3. Проверка дискриминируемости: временно убрать условие возраста из `ScheduleDataContext.tsx:429` (`Date.now() - state.dataUpdatedAt > staleTime`, оставить только `isInvalidated`) → новый тест обязан покраснеть; вернуть условие → зелёный. Правка продукта не коммитится — это ручная проверка с откатом внутри той же задачи; в диффе PR файла контекста нет.

DoD (сценарий 2 спеки): новый тест зелёный и дискриминирующий (шаг 3); тела существующих тестов файла не изменены; `pnpm exec vitest run __tests__/schedule/ScheduleDataContext.test.tsx` зелёный целиком.

## Task 2: константа UNDO_WINDOW_MS — единый источник интервала

### Классификация: standard

### Required Docs

- `docs/specs/2026-10-22-e2e-stale-prime-464-design.md` — «Изменения» (часть 2), «Нерушимые границы» (литерал `5000` в `__tests__/` остаётся намеренно).
- `frontend/admin/lib/constants.ts` — существующий листовый модуль констант (без React-импортов; `PASSWORD_POLICY_HINT_RU`, #262).

1. `export const UNDO_WINDOW_MS = 5_000;` в `frontend/admin/lib/constants.ts`.
2. Заменить 13 литералов `delayMs: 5000` на импорт константы в 12 файлах (инвентарь спеки, «Контекст»): `useVisitorsMutations.ts:145`, `useRecordMutations.ts:580,629`, `useTagsMutations.ts:140`, `usePhotosMutations.ts:147`, `useClientsMutations.ts:186`, `useStaffMutations.ts:175`, `useServicesMutations.ts:181`, `useMaterialsMutations.ts:172`, `useDeleteRecord.ts:126`, `contexts/schedule/ScheduleDataContext.tsx:398`, `usePositionsMutations.ts:153`, `useLocationsMutations.ts:170` (все пути — `frontend/admin/hooks/…` кроме оговорённого контекста).
3. `frontend/admin/contexts/UIContext.tsx:126`: дефолт жизни undo-тоста `cd ?? 5000` → `cd ?? UNDO_WINDOW_MS` (правило «undo-тост живёт окно отсчёта» #285 D4 остаётся единым с константой; поведение сегодня то же — в потоке отложенного удаления отсчёт всегда приходит явным `action.delayMs`).
4. `frontend/admin/e2e/fixtures/helpers.ts`: `:751` — `const advanceMs = opts?.advanceMs ?? UNDO_WINDOW_MS + 500;`; импорт относительный `../../lib/constants` — оба реальных прецедента импорта app-модулей в e2e относительные: `wave6-status-snapshots.spec.ts:3-6` (константы из `../app/components/shared/config/…`) и `staff-s7-create-composite.spec.ts:24` (функция из app-компонента); JSDoc `:742-745` («default 5_500») обновить на ссылку константы.
5. Самопроверка: `grep -rn 'delayMs: 5000' frontend/admin --exclude-dir=__tests__` → 0 вхождений вне определения константы (в `lib/constants.ts` литерал `5_000` с подчёркиванием — паттерн не матчит, это нормально); type-check и vitest локально зелёные.

DoD (сценарий 3 спеки): grep чист, юнит-тесты хуков зелёные (литералы `5000`/`.toBe(5000)` в `__tests__/` не тронуты — независимая фиксация значения). DoD (сценарий 4): контракт хелпера не меняется — 13 вызывающих `withUndoWindow` спек-файлов зелёные в CI PR без правки их тел.

## Task 3: S3 без выдержки

### Классификация: small

### Required Docs

- `docs/specs/2026-10-22-e2e-stale-prime-464-design.md` — «Изменения» (часть 1), «Нерушимые границы», «Риски» (устойчивость к медленному CI).
- `frontend/admin/e2e/activity-deferred-delete.spec.ts` — S3 `:204-275`.

1. Удалить `await page.waitForTimeout(33_000)` с комментарием stale-prime (`:225-227`).
2. Убрать ассерт баннера `delete-dialog-refetch-note` (`:240-243`, включая комментарий «the banner is the dialog's FIRST line») — на свежем кэше баннер недостижим; покрытие баннера остаётся за юнит-тестом диалога (`ActivityDeleteConfirmDialog.test.tsx:139/:149`).
3. Вычистить описывающие удалённую механику комментарии: секционный заголовок `:204` («stale-prime refresh banner») и пояснительный блок `:206-210` («In e2e the reachable trigger is TIME…»).
4. Переименовать тест: `S3: activity with a record — dialog shows dependency one-liners (table path)`.
5. Ассерты однострочников зависимостей, отмена диалога, проверка БД в конце сценария (тело try) — без изменений; остальные 7 сценариев файла не трогаются.
6. Локальный прогон S3 (или файла целиком) по канон-рецепту standalone (`docs/tests_workflow.md`, «Canonical standalone invocation»): зелёный; зафиксировать длительность файла/сценария — она ниже прежней примерно на 33 с.

DoD (сценарий 1 спеки): модифицированный S3 зелёный, длительность в логе прогона ниже прежней на ~33 с, тела остальных сценариев не изменены; в диффе PR нет `frontend/admin/playwright.config.ts` — таймауты, retries и бюджеты не тронуты (граница «бюджеты и таймауты не растут»).

## Закрытие

PR с `Closes #464` в описании (ключевое слово — только там), мерж по гейту репозитория: зелёный CI — единственный триггер, `gh pr merge <PR> --squash --delete-branch` после `gh pr checks --watch` с exit 0.
