# План: #634 — свободные места и вместимость в карточке занятия + ограничение счётчика брони (web)

## Goal

Клиент публичного расписания видит на карточке занятия остаток мест («Свободно 7 из 10») или «Мест нет» (нулевая вместимость / всё занято); при «Мест нет» вход в форму брони закрыт; в форме сумма счётчиков по тарифам не превышает остаток. Спека: `docs/specs/2026-11-27-web-free-slots-capacity-634-design.md` (поведение и границы — там; этот план поведение не пересказывает).

## Architecture

Правки только в `frontend/web`. Данные уже доходят до `WebScheduleDTO` (`capacity` + `occupied`); работа — протяжка в экранную модель и потребители. Появляются поля `capacity?: number` (как пришло) и производное `free?: number` (вычисляется в мапперах: `capacity − occupied`, floor 0; `undefined` когда вместимость неизвестна). `free === undefined` — прежнее поведение без ограничений (деградация данных); `free === 0` — «Мест нет» + блокировка входа в форму (два слоя: неактивная кнопка в `ActivityDetail`, заслон в `handleBook` на странице). Бэкенд, контракт API и словарь ошибок web (#538 pass-through) не меняются.

## Tech Stack

Next.js (app router) + TypeScript + Tailwind; тесты: vitest + RTL (компонентные), Playwright (web e2e, локально — в CI web-e2e отсутствует до #637); сид/фикстуры: admin-API + прямой SQLite-запрос (`db-query.ts`).

---

## Task 1: e2e-фикстуры — услуга с двумя тарифами и бронирование через API

### Classification: small

Файлы: `frontend/web/e2e/fixtures/admin-activity.ts`, новый `frontend/web/e2e/fixtures/api-booking.ts`.

- В `admin-activity.ts` добавить создание тестовой услуги с двумя тарифами (через admin API) и занятия на завтра на этой услуге: у фабрики занятия появляется явный override `serviceId` (сейчас `createTomorrowActivity` жёстко берёт `services[0].id` — годится как шаблон, но без этого параметра на новую услугу занятие не положить); очистка в `finally` — удалять и занятие, и услугу.
- Новый `api-booking.ts`: помощник `bookViaApi(page, activityId, visits)` — авторизованный `POST /api/v1/my/client/records` от сида-клиента c1 (storageState проекта) для предварительных и конкурентных броней. Число мест кодируется массивом `visits` (схема создания не принимает `seats` — `extra="forbid"`, `seats` на сервере равен числу `visits`), а не полем `seats`.

### Required Docs

`docs/domain-rules/activities.md` (публичная видимость, вместимость 0..99), `docs/domain-rules/records.md`.

Проверка: `pnpm exec tsc --noEmit` в `frontend/web`; фикстуры используются задачами 2/6/7.

## Task 2: e2e US-1/US-3/US-4 — RED на main

### Classification: small

Новый `frontend/web/e2e/free-slots-capacity.spec.ts`:

- **US-1**: `createTomorrowActivity`-аналог с вместимостью 10, 3 места заняты заранее через `bookViaApi` (по 1 месту × 3 — разные клиенты не нужны, три записи c1) → на вкладке «Завтра» карточка содержит «Свободно 7 из 10» и не содержит «Уже».
- **US-3**: вместимость 1, 1 место занято через `bookViaApi` → карточка «Мест нет».
- **US-4**: вместимость 3 на услуге с двумя тарифами (задача 1) → открыть форму, поднять первый счётчик до 2, второй до 1; третья единица на любом счётчике недоступна (кнопка «+» неактивна); отправка → успех, в БД запись с `seats = 3` (`queryDBRow`).

### Required Docs

`docs/domain-rules/activities.md`, `docs/domain-rules/records.md`.

DoD: сценарии 1, 3, 4 падают на main по правильной причине (карточка показывает «Уже N гостя/гостей», сумма не ограничена) — RED-этап RED-GREEN-REFACTOR.

## Task 3: Протяжка capacity/free в экранную модель + строка состояния карточки

### Classification: standard

Файлы (8): `frontend/web/app/lib/model/view/schedule.ts`, `frontend/web/app/lib/model/view/activity.ts`, `frontend/web/app/lib/mappers/to-schedule-vm.ts`, `frontend/web/app/page.tsx` (адаптер `toActivityView`), `frontend/web/app/ui/MKCard.tsx`, `frontend/web/app/ui/__tests__/MKCard.test.tsx`, `frontend/web/app/__tests__/page.test.tsx`, `frontend/web/app/ui/__tests__/MKCarousel.test.tsx` (пути тестов сверить по факту — page/carousel тесты могут лежать иначе).

- В `ScheduleView`/`ScheduleCardView` и `ActivityView` добавить `capacity?: number`; в мапперах (`toScheduleView`, адаптер `toActivityView`) вычислять `free?: number = max(0, capacity − occupied)`, `undefined` при неизвестной вместимости.
- `MKCard` (обычный вариант): props `guestsCount` заменяются на `free`/`capacity`; строка состояния: `free > 0` → «Свободно {free} из {capacity}»; `free === 0` → «Мест нет»; `free === undefined` → прежняя «Уже {N} гостя/гостей» (деградация). Форматирование строки — в компоненте (прецедент `guestsLabel`).
- В `page.tsx` обновляются оба места сборки карточек: адаптер `toActivityView` и `toCardProps` (сейчас передаёт `guestsCount: vm.guestsCount` в `MKCardProps` для `MKCarousel`) — оба переходят на `free`/`capacity`.
- Компонентные тесты: обновить ассерты старой строки в `MKCard.test.tsx`, `page.test.tsx`, `MKCarousel.test.tsx`; добавить кейс деградации (без `capacity`).

### Dispatch:

1. Модели + мапперы (`schedule.ts`, `activity.ts`, `to-schedule-vm.ts`, `page.tsx`) — @frontend-coder — `pnpm exec tsc --noEmit` + юнит-проверка маппера (free/floor 0/undefined).
2. `MKCard.tsx` + `MKCard.test.tsx` (три состояния строки) — @frontend-coder — vitest `MKCard`.
3. Фикстуры/ассерты `page.test.tsx` + `MKCarousel.test.tsx` — @frontend-coder — vitest этих файлов.

### Required Docs

`docs/domain-rules/activities.md` (вместимость, приватность не на расписании).

DoD: E2E test for scenario 1 и 3 passes (RED-GREEN-REFACTOR).

## Task 4: Детальное окно — блокировка «Участвовать» + заслон на странице

### Classification: small

Файлы: `frontend/web/app/ui/ActivityDetail.tsx`, `frontend/web/app/page.tsx` (`handleBook`), `frontend/web/app/ui/__tests__/ActivityDetail.test.tsx`.

- В `ActivityDetail`: при `activity.free === 0` кнопка «Участвовать» рендерится неактивной с видимой подписью «Мест нет» рядом (семантика — нативный `disabled` или `aria-disabled` + причина, по идиомам репозитория; в обоих вариантах клик не открывает форму); `free === undefined` и `free > 0` — как сегодня.
- В `page.tsx`: `handleBook` при `free === 0` форму не открывает (второй слой защиты).
- Тесты `ActivityDetail.test.tsx`: три кейса (`free=0` — неактивна + подпись; `free>0` — активна; `free` отсутствует — активна; существующие `mockActivity` без `capacity` остаются зелёными).

### Required Docs

`docs/domain-rules/activities.md`.

DoD: юнит-нога сценария 2 зелёная (e2e-нога — задача 6).

## Task 5: Форма брони — инвариант суммы + полный сброс

### Classification: small

Файлы: `frontend/web/app/ui/BookingActivityOverlay.tsx`, `frontend/web/app/ui/__tests__/BookingOverlay.test.tsx`.

- Инвариант: для каждого счётчика `max_i = max(0, free − (totalCount − count_i))`, передаётся существующим пропом `max` в `Counter` (компонент не меняется); `free === undefined` — проп не передаётся (потолок по умолчанию 99).
- Полный сброс при открытии и при смене `activityId`: существующий reset-эффект расширяется — в зависимости добавляется `activityId` (сброс и при открытии, и при смене занятия), обнуляются `counts`, `visitors`, `showVisitors` и все контактные поля (`contactName`, `formPhone`, `comment`), плюс `isFormValid`, `submitted`, `pendingPayload`, `otp`, `submission`.
- Vitest `BookingOverlay.test.tsx`: реактивные потолки (занял бюджет одним — у другого упал потолок, «+» погас), один счётчик «Места» (услуга без тарифов) ограничен тем же инвариантом, полный сброс при повторном открытии и при смене занятия.

### Required Docs

`docs/domain-rules/activities.md`.

DoD: E2E test for scenario 4 passes (RED-GREEN-REFACTOR; юнит-нога здесь, e2e-нога из задачи 2 зеленеет).

## Task 6: Переписать booking-closed-activity.spec.ts (US-2)

### Classification: small

Файл: `frontend/web/e2e/booking-closed-activity.spec.ts`.

- `createTomorrowActivity({ capacity: 0 })` → карточка на «Завтра» показывает «Мест нет»; «Подробнее» открывает детальное окно; главный ассерт: «Участвовать» неактивна и панель формы брони не появилась; дополнительные: слушатель запросов фиксирует отсутствие `POST …/records`, `queryDBRow` по записям занятия пуст.

### Required Docs

`docs/domain-rules/activities.md`.

DoD: E2E test for scenario 2 passes (RED-GREEN-REFACTOR).

## Task 7: Перестроить US-1 в booking-error-l10n.spec.ts (US-5)

### Classification: small

Файл: `frontend/web/e2e/booking-error-l10n.spec.ts`.

- US-1 переезжает с сид-занятия (вместимость 1) на занятие вместимости 2 из фикстуры задачи 1: ACT 1 — заполнить 1 место, отправить → успех, строка в БД; ACT 2 — форма открывается повторно (остаток 1), заполнить 1 место, конкурентной бронью через `bookViaApi` унести последнее место, отправить → 409 `ACTIVITY_AT_CAPACITY`, блок `booking-error` содержит «Недостаточно мест», без английского. Сценарий US-2 того же файла (404 «Занятие не найдено») не трогается и остаётся на сид-фикстуре `seed-individual-activity` — единственном её потребителе после переезда US-1.

### Required Docs

`docs/domain-rules/activities.md`, `docs/domain-rules/records.md`.

DoD: E2E test for scenario 5 passes (RED-GREEN-REFACTOR — словарная проверка 409 сохранена на честной имитации гонки).

## Task 8: Полная локальная верификация web

### Classification: standard

### Dispatch:

1. Полный web vitest (`pnpm test` в `frontend/web`) — @tester — зелёный прогон, отчёт о падениях с причинами.
2. Полный web e2e (`pnpm test:e2e` в `frontend/web`; стек по `playwright.config.ts`, `E2E_STACK=1` при предподнятом стеке) — @tester — сценарии US-1…US-5 всех трёх spec-файлов зелёные, остальной набор не порушен.
3. Визуальная проверка по спеке — @tester — прогон VC-раннера (`bash scripts/visual-compliance-check.sh <url> <спека> /tmp/vc-out mobile`; машинный якорь — статичная карточка на `url="/"`), ручные строки чек-листа спеки перечислить в отчёте задачи для приёмки.

### Required Docs

`docs/domain-rules/activities.md`.

DoD: обе сюиты зелёные локально; в CI web-e2e не бежит (#637) — это зафиксированный риск-акцептанс спеки.
