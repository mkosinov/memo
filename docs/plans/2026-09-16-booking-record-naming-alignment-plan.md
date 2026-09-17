# Booking → Record Naming Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести имена кода к домен-правилу юзера («booking» = процесс бронирования, «record» = данные-результат) по спеке `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — переименование `BookingFilters` → `RecordsFilters` и вкладки `NewBookingTab` → `NewRecordTab` со всей цепочкой testid/селекторов/комментов; поведение юзера не меняется.

**Architecture:** Только `frontend/admin` + e2e. Механические переименования через `git mv` (история сохраняется), обновление импортов/testid/e2e-селекторов, миграция visual-базлайнов. Backend, API-контракты, `frontend/web`, `visit*` — вне скоупа (спека D11). Домен-правки (`docs/domain-rules/*`) УЖЕ внесены и закоммичены вместе со спекой (`0b3e9ee`) — в задачах плана их нет.

**Tech Stack:** Next.js/React admin, vitest, Playwright e2e + visual regression (`toHaveScreenshot`, `maxDiffPixels`), commands from `frontend/admin/package.json`: `npm run test`, `npm run test:e2e`, `npm run test:e2e:update`, `npm run type-check`, `npm run lint`.

> **Status:** ✅ Completed 2026-09-17 — IMPL T1–T7 (7 commits `280d167..b4b0882`, base `18a57e9`); PR pending (Step 6, architect). Push/PR-шаг Task 7 намеренно оставлен `- [ ]` до открытия PR.

---

## Behavioral Delta

Как ведёт себя фича для юзера, по критериям спеки §6 (S1–S4) — **поведение не меняется ни в одном сценарии**, меняются только внутренние имена:

- **S1 (фильтр статусов на /records)** → Админ фильтрует записи по статусу — фильтр работает как раньше; у него просто внутреннее имя `records-filters-status` вместо `booking-filters-status`.
- **S2 (создание записи из модалки занятия)** → Админ в quickAdd открывает вкладку формы записи — форма работает как раньше (вкладка и её поля теперь именуются record*, видимый текст не менялся — его и не было).
- **S3 (ошибка сабмита формы записи)** → При некорректном сабмите (неполный телефон) ошибка показывается у вкладки — как раньше.
- **S4 (внешний вид)** → Страница /records и модалка выглядят пиксельно так же; базлайн снапшота переименован, пиксели совпадают со старыми.
- **Критерий именования (спека §8.1)** → `grep -ri booking` по `frontend/admin`, `packages/domain`, `packages/api-client`, живым докам находит только процессные употребления из whitelist'а спеки; ни одного «booking» в значении сохранённых данных.

## File Map

| Файл | Действие |
|---|---|
| `frontend/admin/app/(main)/records/components/BookingFilters.tsx` | git mv → `RecordsFilters.tsx` + переименование имён внутри |
| `frontend/admin/app/(main)/records/page.tsx` | импорт + JSX |
| `frontend/admin/__tests__/BookingFilters.test.tsx` | git mv → `RecordsFilters.test.tsx` + внутренности |
| `frontend/admin/e2e/records.spec.ts`, `e2e/wave6-status-shared.spec.ts`, `e2e/records-view.spec.ts`, `e2e/fixtures/helpers.ts`, `e2e/visual-regression.spec.ts` | селекторы + комменты |
| `frontend/admin/app/(main)/photos/components/PhotosFilters.tsx` | комменты-ссылки |
| `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx` | git mv → `NewRecordTab.tsx` + имена, testid, HTML id |
| `frontend/admin/app/components/modal/ActivityDetailsModal/index.ts`, `ActivityDetailsModal.tsx` | экспорт/импорт/рендер/tab id/хендлер/комменты |
| `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` | import/describes/renders/комменты |
| `frontend/admin/__tests__/helpers/mockData.ts` | коммент |
| `frontend/admin/e2e/activity-details-modal.spec.ts`, `e2e/error-messages.spec.ts`, `e2e/fixtures/server-push.ts` | селекторы + комменты |
| `frontend/admin/e2e/visual-regression.spec.ts-snapshots/modal-new-booking-*.png` | git mv на новые имена |

## Порядок и красные окна

Задачи коммитятся по отдельности; между Task 1 и Task 2 (и между Task 3 и Task 5) e2e-селекторы временно указывают на старые testid — **e2e-файлы красные в промежуточных коммитах, это ожидаемо**; полный зелёный — Task 7. RED-GREEN-REFACTOR в задачах с DoD-строками адаптирован под механическое переименование (нового поведения нет, RED-фаза в классическом смысле не воспроизводима): RED-шаг = обновлённые селекторы/ассерты меняются первыми в задаче, GREEN = прогон после согласованной правки кода.

---

## Task 1: Rename filter component and unit test
### Classification: small
### Required Docs
- `docs/domain-rules/_overview.md` — раздел Naming Conventions: правило «Запись → Record», процессная строка Booking
- `docs/domain-rules/records.md` — сущность Record (контекст фильтруемых данных)
- `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — §4.1 (точный инвентарь строк)

**Files:**
- `frontend/admin/app/(main)/records/components/BookingFilters.tsx` → `RecordsFilters.tsx`
- `frontend/admin/app/(main)/records/page.tsx`
- `frontend/admin/__tests__/BookingFilters.test.tsx` → `RecordsFilters.test.tsx`

**Steps:**
- [x] `cd frontend/admin && git mv "app/(main)/records/components/BookingFilters.tsx" "app/(main)/records/components/RecordsFilters.tsx"`
- [x] `git mv __tests__/BookingFilters.test.tsx __tests__/RecordsFilters.test.tsx`
- [x] В `RecordsFilters.tsx`: интерфейс `BookingFiltersProps` → `RecordsFiltersProps` (:14), компонент `BookingFilters` → `RecordsFilters` (:37 и использование :49), `testIdPrefix="booking-filters-status"` → `"records-filters-status"` (:205)
- [x] В `records/page.tsx`: импорт (:5) и JSX (:23) → `RecordsFilters`
- [x] В `RecordsFilters.test.tsx`: коммент (:2), импорт (:34), все обращения (:45,47,71,75,125,152,157,226,301) → `RecordsFilters`
- [x] `npm run test -- RecordsFilters` — ожидание: все тесты файла passed
- [x] `npm run type-check` — ожидание: ошибок нет
- [x] Commit: `git commit -am "refactor(#103): rename BookingFilters to RecordsFilters (component, props, testid, unit test, page.tsx consumer)"`

## Task 2: Update records-filter e2e selectors and comments
### Classification: small
### Required Docs
- `docs/domain-rules/_overview.md` — Naming Conventions
- `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — §4.1 (e2e-строки)

**Files:** `e2e/records.spec.ts`, `e2e/wave6-status-shared.spec.ts`, `e2e/visual-regression.spec.ts`, `e2e/records-view.spec.ts`, `e2e/fixtures/helpers.ts`, `app/(main)/photos/components/PhotosFilters.tsx`

**Steps:**
- [x] Во всех перечисленных e2e-файлах заменить селектор `booking-filters-status` → `records-filters-status`: `records.spec.ts` — 14 строк (96,112,142,143,148,170,171,204,205,239,572,573,728,729); `wave6-status-shared.spec.ts:27,28`; `visual-regression.spec.ts:65,68`
- [x] Комменты-ссылки на старое имя → `RecordsFilters`: `wave6-status-shared.spec.ts:9,12`; `records-view.spec.ts:35,193`; `fixtures/helpers.ts:348`; `PhotosFilters.tsx:12,186`
- [x] `grep -rn "booking-filters-status" e2e app` — ожидание: пусто
- [x] `npm run test:e2e -- records.spec.ts` — ожидание: passed (все тесты файла; оба шарда, где файл заявлен)
- [x] `npm run test:e2e -- wave6-status-shared.spec.ts` — ожидание: passed
- [x] Commit: `git commit -am "refactor(#103): records filter e2e selectors to records-filters-status"`

**DoD:** E2E test for scenario S1 passes (RED-GREEN-REFACTOR — см. примечание о RED-адаптации выше).

## Task 3: Rename NewRecordTab component and modal wiring
### Classification: small
### Required Docs
- `docs/domain-rules/_overview.md` — Naming Conventions (карв-аут D3: вкладка quickAdd = дата-сторона, хендлер и поля следуют за компонентом)
- `docs/domain-rules/records.md` — сущность Record
- `docs/design-system.md` — только контекст модалки/табов; правки UI нет (файл устарел, обновление = #287)

**Files:** `ActivityDetailsModal/NewBookingTab.tsx` → `NewRecordTab.tsx`; `ActivityDetailsModal/index.ts`; `ActivityDetailsModal/ActivityDetailsModal.tsx`; `__tests__/helpers/mockData.ts`

**Steps:**
- [x] `cd frontend/admin && git mv app/components/modal/ActivityDetailsModal/NewBookingTab.tsx app/components/modal/ActivityDetailsModal/NewRecordTab.tsx`
- [x] В `NewRecordTab.tsx`: тип `NewBookingSubmitData` → `NewRecordSubmitData` (:20, алиас остаётся `= CreateRecordInput`), интерфейс `NewBookingTabProps` → `NewRecordTabProps` (:22,25), компонент `NewBookingTab` → `NewRecordTab` (:29), testid `new-booking-tab` → `new-record-tab` (:134), HTML id + htmlFor: `booking-name`→`record-name` (:147,151), `booking-seats`→`record-seats` (:164,168), `booking-channel`→`record-channel` (:232,236)
- [x] `index.ts:5`: экспорт → `NewRecordTab`
- [x] `ActivityDetailsModal.tsx`: импорт (:12, включая `type NewBookingSubmitData` → `NewRecordSubmitData`), tab id `'new-booking'` → `'new-record'` (:131, :221, :252), хендлер `handleNewBookingSubmit` → `handleNewRecordSubmit` + коммент «New booking submit handler» (~:224,229-230,257), рендер (:254), коммент «activity bookings need…» → «activity records need…» (:149)
- [x] `mockData.ts:172`: коммент «Tariffs (used by SettingsTab, NewBookingTab, ClientTab)» → «…NewRecordTab…»
- [x] `grep -rn "NewBookingTab\|new-booking" app/` — ожидание: пусто
- [x] `npm run type-check` — ожидание: ошибок нет
- [x] Commit: `git commit -am "refactor(#103): rename NewBookingTab to NewRecordTab (tab id, testid, field ids, handler)"`

## Task 4: Rename tab suite in ActivityDetailsModal vitest
### Classification: small
### Required Docs
- `docs/domain-rules/_overview.md` — Naming Conventions
- `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — §4.2 (vitest-строки)

**Files:** `__tests__/ActivityDetailsModal.test.tsx`

**Steps:**
- [x] Импорт (:10) → `NewRecordTab`; section-комменты :411, :977, :1029; describes «NewBookingTab…» → «NewRecordTab…» (:413, :979, :1034, :1160); все `render(<NewBookingTab …>)` — 17 вызовов (:422,427,432,437,442,988,994,999,1005,1010,1022,1054,1117,1138,1179,1196,1208); коммент «Serve the activity's booking records» → «…the activity's records» (:175)
- [x] `grep -rn "NewBookingTab" __tests__/` — ожидание: пусто
- [x] `npm run test -- ActivityDetailsModal` — ожидание: passed
- [x] Commit: `git commit -am "refactor(#103): rename NewBookingTab suite in vitest to NewRecordTab"`

## Task 5: Update modal-tab e2e selectors and comments
### Classification: small
### Required Docs
- `docs/domain-rules/_overview.md` — Naming Conventions
- `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — §4.2/§4.3/§4.4

**Files:** `e2e/activity-details-modal.spec.ts`, `e2e/error-messages.spec.ts`, `e2e/fixtures/helpers.ts`, `e2e/fixtures/server-push.ts`

**Steps:**
- [x] Селектор `new-booking-tab` → `new-record-tab`: `activity-details-modal.spec.ts:61,425`; `error-messages.spec.ts:91`; `fixtures/helpers.ts:300`
- [x] `server-push.ts:260`: «The booking lands on…» → «The record lands on…» (созданная запись прилетает по SSE). `server-push.ts:259`, `error-messages.spec.ts:90` — НЕ трогать (процессные, спека §4.4)
- [x] `grep -rn "new-booking-tab" e2e/` — ожидание: пусто
- [x] `npm run test:e2e -- activity-details-modal.spec.ts` — ожидание: passed
- [x] `npm run test:e2e -- error-messages.spec.ts` — ожидание: passed
- [x] Commit: `git commit -am "refactor(#103): modal tab e2e selectors to new-record-tab"`

**DoD:** E2E tests for scenarios S2 and S3 pass (RED-GREEN-REFACTOR — RED-адаптация, см. выше).

## Task 6: Migrate visual regression baseline
### Classification: standard
### Required Docs
- `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — D10 + §7 (риски)
- `docs/design-system.md` — только контекст; пиксели не меняются

**Files:** `e2e/visual-regression.spec.ts` (:118 title, :127 arg); `e2e/visual-regression.spec.ts-snapshots/modal-new-booking-*.png`

**Steps:**
- [x] `visual-regression.spec.ts:118`: заголовок теста «activity modal — new booking tab» → «activity modal — new record tab»
- [x] `visual-regression.spec.ts:127`: аргумент `toHaveScreenshot('modal-new-booking.png')` → `'modal-new-record.png'`
- [x] `ls e2e/visual-regression.spec.ts-snapshots/modal-new-booking-*` — ожидание: 2 файла (`-chromium-linux.png` и `-shard-rest-linux.png`)
- [x] `git mv` каждого: суффиксы сохранить, имя `modal-new-booking` → `modal-new-record` (например `git mv "e2e/visual-regression.spec.ts-snapshots/modal-new-booking-chromium-linux.png" "e2e/visual-regression.spec.ts-snapshots/modal-new-record-chromium-linux.png"` и второй файл аналогично)
- [x] `npm run test:e2e -- visual-regression.spec.ts` — ожидание: passed БЕЗ флага `--update-snapshots` (доказательство пиксельной идентичности: UI не менялся, менялись только имена)
- [x] Если шаг выше падает по diff — это сигнал, что UI изменился не от переименования: разбирать по `npm run test:e2e:update -- visual-regression.spec.ts` + ручной сверке diff-картинки, НЕ коммитить вслепую
- [x] Commit: `git commit -am "refactor(#103): rename modal-new-booking visual baseline to modal-new-record"`

**DoD:** E2E test for scenario S4 passes (RED-GREEN-REFACTOR — RED-адаптация; пиксельная идентичность доказана прогоном без update).

## Task 7: Final sweep, full DoD and PR
### Classification: standard
### Required Docs
- `docs/specs/2026-09-16-booking-record-naming-alignment-design.md` — §8 (критерий завершённости с whitelist'ом) целиком
- `docs/domain-rules/_overview.md` — Naming Conventions

**Files:** только проверка + PR; правки — любые stragglers, найденные sweep'ом

**Steps:**
- [x] `grep -rni "booking" frontend/admin packages/domain packages/api-client` — каждая находка сверяется со спекой §4.4 + D4/D5 (процессные комменты, BookingVisitor/BookingStep, «Booking Context Types»); «booking» в значении данных = 0
- [x] `grep -rni "booking" docs/domain-rules docs/business-logic.md` — только whitelist спеки §8 (9 строк + `business-logic.md:49`)
- [x] `npm run test` — ожидание: весь vitest passed
- [x] `npm run test:e2e -- records.spec.ts activity-details-modal.spec.ts error-messages.spec.ts wave6-status-shared.spec.ts visual-regression.spec.ts` — ожидание: passed
- [x] `npm run type-check && npm run lint` — ожидание: чисто
- [ ] `git status` — рабочее дерево чистое; push ветки, открыть PR в main с телом: «Implements #103 (booking/record naming alignment). Closes #103.» — закрывающий keyword ТОЛЬКО здесь, в PR-описании
- [ ] Карточка #103 уйдёт в In-main на мерже (пайплайн); убедиться, что `depends-on: #257` в теле issue учтён (IMPL начался только после мержа #257 — инвариант пайплайна)

**DoD:** критерий §8 спеки выполнен; все сценарии S1–S4 зелёные; PR открыт.
