# GH #499 — Клиентские учётки и реальное бронирование из веба (срез «вход + форма»)

- **Date**: 2026-10-21
- **Branch**: `499-web-client-auth-booking`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `4c747c02` (main) — 12 коммитов (`94b24a8e..3a620681`), 79 файлов, +6165/−406
- **Issue**: #499 — клиент подтверждает телефон кодом (OTP), получает клиентскую сессию и бронирует из веб-формы по реальным тарифам услуги; чтение кабинета — вне среза (#513)
- **Спека**: `docs/specs/2026-10-20-web-client-auth-booking-design.md` (рев.2)
- **План**: `docs/plans/2026-10-21-web-client-auth-booking-plan.md` — 9/9 задач, все done; порядок исполнения 1→2→4→3→5→6→7→8→9 (задача 4 до задачи 3 — `verify` выдаёт сессию cookie-именем и резолвером из задачи 4)
- **Domain rules**: `docs/domain-rules/auth.md` + `docs/domain-rules/records.md` — обновлены в DESIGN-фазе (коммит `17d0ff9c` на main), верифицированы против финального кода — **расхождений не найдено** (docser не правил)
- **Характер**: вертикальный срез backend + `packages/api-client` + `frontend/web`; существующие механизмы расширяются (сессии, сценарий создания записи), параллельного ничего не построено

## Что выполнено

1. **Роль `client` и связь учётки с карточкой (T1, `94b24a8e`, standard)** —
   `UserRole` + `client` (в матрицу `ROLE_PERMISSIONS` не добавляется —
   инвариант-тест «ровно admin + master» зелёный); `User.client_id`
   (unique FK → `clients`, миграция `f8d2a4c6b9e1`, зеркало `staff_id`);
   инвариант «клиентская учётка без пароля»: `/auth/login` и
   password-setup отказывают роли `client` (тайминговая чёткость).
2. **Хранение OTP-кодов и лимиты (T2, `2f047e35`, standard)** — таблица
   `otp_codes` (миграция `d3b5f7a9c1e3`): один код на телефон (ротация
   отправкой), код 6 цифр TTL 5 минут, `code_hash` = HMAC-SHA-256 с
   серверным перцем из настроек (вне БД, сравнение за постоянное время),
   атомарное поглощение; счётчик неудачных вводов 5/15 мин — отдельно от
   строки кода, ротацией не сбрасывается; лимиты отправки в существующем
   in-memory сторе (5/телефон, 20/IP, 5 номеров/IP, отказы verify — в
   IP-счётчик). Fallout-фикс после ревью: `9cd0603d` (явный `OTP_PEPPER`
   в тесте SECRET_KEY, изоляция `_env_file=None`).
3. **Клиентская сессия (T4, `ba66a2da`, small)** — cookie
   `memo_client_session` (те же атрибуты, что у `memo_session`;
   сосуществует в одном браузере), зависимость `require_client_session`
   (только своя cookie, `role=client`, активная учётка — перекрёстное
   предъявление даёт 401, staff-резолвер не тронут); `GET /api/v1/my/client`
   → `{phone, name}`; `POST /auth/logout` удалает предъявленную сессию
   любого вида, идемпотентен.
4. **OTP-эндпоинты и транспорт (T3, `0bf7588c`, large)** —
   `POST /auth/otp/request`: всегда 202 на валидный номер, для телефона
   сотрудника код молча не генерируется (202 байт-в-байт тот же — нет
   оракула перечисления); `POST /auth/otp/verify`: HMAC+срок+попытки с
   атомарным поглощением, учётка + карточка «найди-или-создай по точному
   телефону» идемпотентно (конфликт уникальности → перечитать и продолжить),
   `phone_is_confirmed=true`, `UserSettings` в той же транзакции, на успехе
   — `Set-Cookie` клиентской сессии; обе точки в `PUBLIC_ROUTES` явно +
   Origin-сверка против CORS-списка (403 при несовпадении); транспорт
   fail-closed — без настроенного транспорта 503
   `NOTIFY_TRANSPORT_UNAVAILABLE` в любом окружении, dev-транспорт и
   `dev_code` только при точном `ENV == "development"`, в лог — маскированная
   запись без сырого кода.
5. **Бронирование `POST /api/v1/my/records` (T5, `1f4d9e93`, large)** —
   схема `MyRecordCreate` (`extra="forbid"`; из провода нет
   `client_id`/`visitor_id`/`price`/`custom_price`/`notify`/`status`);
   владелец только из клиентской сессии; цена сервером из `tariff_id`
   (обязателен, если у услуги есть тарифы — 422 `TARIFF_REQUIRED`; без
   тарифов — 0; чужой тариф — 422 `TARIFF_NOT_FOUND`, тарифы одним
   запросом); 1–20 визитов с границами `VisitItem`; наследует 404
   активность / 409 вместимость; анти-спам 20 записей/40 визитов за
   15 минут на учётку → 429; защита мутации `Sec-Fetch-Site` + Origin;
   CORS — точные origins с credentials, `*` запрещён.
6. **api-client клиентской ветки (T6, `721a17fc`, small)** — zod-зеркала
   `OtpRequestSchema`/`OtpVerifySchema`/`MyClientSchema`/
   `MyRecordCreateSchema`/`MyRecordResponseSchema`; функции
   `requestOtpCode`/`verifyOtpCode`/`getMyClient`/`createMyRecord` с
   credentials (та же транспорта-основа, что у админки).
7. **Web — реальные тарифы в оверлее (T7, `981a5aa1`, large)** — тарифы
   услуги доходят до модели экрана активности (маппер расписания) и в
   оверлей: счётчик мест на каждый тариф (`tariff-counter-{id}`, цена
   рядом), услуга без тарифов — один счётчик + «Стоимость уточняется»
   (`booking-price-hint`); таблица «Указать имена посетителей»
   (`visitors-names-table`: имя/возраст/тариф read-only, незаполненные
   имена — анонимные визиты); состояния загрузки/ошибки тарифов; селектор
   канала не тронут.
8. **Web — вход кодом и создание записи (T8, `24725bde`, standard)** —
   отправка без сессии → шаг «подтвердите телефон» (отправка кода → ввод →
   подтверждение → автоматическая повторная отправка записи; ошибки шага —
   в шаге, 503 → «Вход временно недоступен»); с сессией — сразу, телефон
   readonly из сессии; успех по 201 — `booking-success`, отказ —
   `booking-error` с повторной отправкой. Фиксы ревью (`02eca526`): сброс
   ошибки при повторном открытии, строгий возраст, фолбэк сообщений без
   кода.
9. **Web — «Личный кабинет» и чистка мока (T9, `077e3d95`, small)** —
   `/cabinet`: анониму форма входа (тот же OTP-шаг), вошедшему телефон
   (`cabinet-phone`) + «Выйти», без заглушек разделов (#513); пункт меню
   ведёт на `/cabinet`; удалены мок-страница `/booking` и мёртвый
   самодельный путь `app/lib/api/records.ts`.
10. **Chore (`3a620681`)** — `OTP_TRANSPORT=dev` в `.env.dev`
    (ENV=development; approved deviation, см. ниже), `.env.example`
    задокументирован (пусто = fail-closed).

## Верификация (финальное дерево, `3a620681`)

| Проверка | Результат |
| --- | --- |
| Backend — целевые сьюты (#499 + регрессия auth/records/CORS/migration) | **зелёные** (крупнейшие прогоны 263/0 и 183/0) |
| Backend ruff + mypy | **clean** |
| api-client vitest | **497/0** |
| frontend/web vitest | **406/0** (47 файлов), tsc + lint **clean** |
| Визуальный гейт (§8) | пассивный скрипт exit 1 → компенсирующий scripted-Playwright обход **8/8 PASS** (см. ниже) |

## Визуальный гейт (§8) — зелёный по evidence

- Пассивный `visual-compliance-check.sh`: **exit 1** — все 7 якорей §8
  (счётчики тарифов, подсказка без тарифов, шаг OTP, `booking-error`,
  `booking-success`, таблица имён, `/cabinet`) лежат **за интеракцией**
  (форма открывается кликом, шаги требуют ввода) — артефакт пассивной
  проверки, не дефект; UI здоров по vision-диагностике.
- Компенсирующий контроль: **scripted-Playwright обход 8/8 PASS** — все
  якоря §8 + бонусные состояния, evidence `/tmp/visual-evidence-499/`
  (e1–e7.png), кросс-чек vision **3/3 CONFIRMED**.

## DoD-статус

- Все DoD 9 задач плана выполнены; US-1…US-6 спеки проверены (pytest +
  vitest-парами — браузерного e2e-харнеса для `frontend/web` в репозитории
  нет, спека §6).
- Чтение кабинета (`GET` записей клиента) — вне среза, шов к #513.

## Ревью

- Каждая задача — ревью зелёное (compliance + quality по классификации);
- 2 фикс-итерации: T2 — test fallout (`9cd0603d`: перец в тестовых
  настройках), T8 — web-фиксы (`02eca526`: сброс ошибки/возраст/фолбэк
  сообщений) — обе верифицированы повторным ревью;
- Латентный шов отмечен ревьюером T3 (не отклонение): router отдаёт
  `dev_code` при любом не-None транспорте — сегодня единственный не-None
  транспорт это dev (сам gated точным `ENV=development`), поведению доков
  соответствует; закрыть шов при заведении реального транспорта — #476.

## Отклонения от плана

1. **`OTP_TRANSPORT=dev` в `.env.dev`** (chore `3a620681`) — решение
   архитектора: dev-стек должен уметь полный OTP-флоу; default-deny
   сохранён (селектор требует точного `ENV == "development"`,
   `.env.example` остался пустым).
2. Латентный шов `dev_code` (см. «Ревью») — поведенческого отклонения нет,
   зафиксирован как follow-up для #476.

## Follow-ups (вне среза)

- Локализация текстов `booking-error` по кодам ошибок (сейчас 409 отдаёт
  английский текст сервера).
- Рефакторинг общих test-моков `ApiError` в 6 файлах web.
- Guard от interleaved refresh в `useClientSession`.
- Flaky-таймауты 3 старых web-тестов под нагрузкой (Hero/cookies/Overlay —
  изолированно зелёные).
- Шов `dev_code` при не-dev транспорте — учесть в #476.

## Behavioral Delta

Аноним в вебе бронирует по реальным тарифам: отправка формы без клиентской
сессии ведёт через OTP-подтверждение телефона (создание/переиспользование
клиентской учётки), с сессией — создаёт запись `POST /api/v1/my/records`
с ценой, вычисленной сервером из тарифа. Параллельное гостевое создание
`POST /api/v1/records` и админский поток не изменены. Без транспорта OTP
(production сегодня) вход отвечает 503 — честный fail-closed до системы
оповещений #476.

## PR-заметки

- `Closes #499` — только в описании PR (канон репо), в коммиты не пишется.
- Спека и план — на ветке с базы (`4c747c02` = план-коммит на main),
  IMPL их не менял.

## Тронутые файлы (`git diff --name-only 4c747c02..3a620681`)

```
backend/.env.dev
backend/.env.example
backend/.env.test
backend/alembic/versions/d3b5f7a9c1e3_otp_codes_table.py
backend/alembic/versions/f8d2a4c6b9e1_users_client_id_link.py
backend/src/api/v1/my_client.py
backend/src/auth/otp.py
backend/src/auth/otp_service.py
backend/src/auth/otp_transport.py
backend/src/auth/permissions.py
backend/src/auth/public.py
backend/src/auth/router.py
backend/src/auth/service.py
backend/src/core/config.py
backend/src/errors.py
backend/src/main.py
backend/src/models/__init__.py
backend/src/models/enums.py
backend/src/models/user.py
backend/src/schemas/auth.py
backend/src/schemas/my.py
backend/src/services/client.py
backend/src/usecases/my_booking.py
backend/src/usecases/otp_login.py
backend/src/usecases/password_setup.py
backend/tests/conftest.py
backend/tests/test_auth_api.py
backend/tests/test_auth_contract.py
backend/tests/test_auth_otp.py
backend/tests/test_auth_otp_api.py
backend/tests/test_auth_password_setup_api.py
backend/tests/test_auth_permissions.py
backend/tests/test_client_session_api.py
backend/tests/test_cors.py
backend/tests/test_my_records_api.py
backend/tests/test_notify_migration.py
backend/tests/test_settings_secret_key.py
backend/tests/test_user_client_link.py
backend/tests/test_user_client_migration.py
frontend/web/app/__tests__/cabinet.test.tsx
frontend/web/app/__tests__/page.test.tsx
frontend/web/app/__tests__/pages.test.tsx
frontend/web/app/booking/page.tsx
frontend/web/app/cabinet/page.tsx
frontend/web/app/hooks/__tests__/useClientSession.test.tsx
frontend/web/app/hooks/__tests__/useCreateMyRecord.test.tsx
frontend/web/app/hooks/__tests__/useOtpLogin.test.tsx
frontend/web/app/hooks/useClientSession.ts
frontend/web/app/hooks/useCreateMyRecord.ts
frontend/web/app/hooks/useOtpLogin.ts
frontend/web/app/lib/__tests__/errors.test.ts
frontend/web/app/lib/api/__tests__/records.test.ts
frontend/web/app/lib/api/records.ts
frontend/web/app/lib/errors.ts
frontend/web/app/lib/mappers/__tests__/buildSchedule.test.ts
frontend/web/app/lib/mappers/__tests__/to-schedule-vm.test.ts
frontend/web/app/lib/mappers/buildSchedule.ts
frontend/web/app/lib/mappers/to-schedule-vm.ts
frontend/web/app/lib/model/domain/__tests__/build-my-record-create.test.ts
frontend/web/app/lib/model/domain/booking.ts
frontend/web/app/lib/model/view/activity.ts
frontend/web/app/lib/model/view/schedule.ts
frontend/web/app/lib/model/view/tariff.ts
frontend/web/app/page.tsx
frontend/web/app/ui/BookingActivityOverlay.tsx
frontend/web/app/ui/Button.tsx
frontend/web/app/ui/ContactForm.tsx
frontend/web/app/ui/Counter.tsx
frontend/web/app/ui/HamburgerMenu.tsx
frontend/web/app/ui/OtpStep.tsx
frontend/web/app/ui/__tests__/BookingOverlay.test.tsx
frontend/web/app/ui/__tests__/Counter.test.tsx
frontend/web/app/ui/__tests__/HamburgerMenu.test.tsx
frontend/web/app/ui/__tests__/OtpStep.test.tsx
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
packages/api-client/src/schemas.test.ts
packages/api-client/src/schemas.ts
scripts/e2e-shard-start.sh
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-21-web-client-auth-booking-499.md` — только
мета-доки; код/спеки/планы/domain-rules не тронуты.

## Scope guards

Чтение кабинета не строилось (#513); реальный транспорт OTP не строился
(#476); гостевой `POST /api/v1/records` и админский поток — без изменений;
спека/план на ветке с базы, docser их не касался; `Closes #499` — только в
описании PR (канон репо).

## References

- **GitHub Issue**: #499
- **Design Spec**: `docs/specs/2026-10-20-web-client-auth-booking-design.md` (рев.2)
- **Plan**: `docs/plans/2026-10-21-web-client-auth-booking-plan.md` (9/9)
- **Visual evidence**: `/tmp/visual-evidence-499/` (scripted-Playwright 8/8)
- **PR**: _(to be added after PR creation)_
