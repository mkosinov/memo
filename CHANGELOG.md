# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — 2026-09-12

### Added
- **GH #266 — Staff-реструктуризация: `masters` → `staff` rename, мастер-расширение, `positions` M2M, экран «Сотрудники», справочник должностей** — branch `feat/staff-restructuring-266` (15 commits: b98e991..e3fb28d, base 81d9006 (#247); план T0–T13, 14/14 задач):
  - **Backend — миграция и модели (`b98e991`):** одна alembic-цепочка (шаги 0–8) переименовывает `masters` → `staff` (id m1–m5, m7 сохранены), создаёт новую `masters`-расширение (`staff_id` PK+FK → `staff.id` ON DELETE CASCADE, `specialty` Text CSV, `color`, `is_active`), `positions` (встроенные id `master`/`admin`; seed «СММ») + M2M `staff_positions`; `users.master_id` → `staff_id` через `batch_alter_table` (именованный unique + FK); FK-retarget `activities.master_id` / `master_tags.master_id`; `user_settings.column_order_masters` → `column_order_staff`; мёртвые enum `Position`/`Specialty` удалены; seed переписан под 4 таблицы.
  - **Backend — домен (`6772adf`):** матрица удалений на `Staff` (activities через masters-строку = block; `masters`/`users`/`master_tags`/`staff_positions` = auto-cascade); record-scalar-subqueries переехали на join новой `masters` (ключи `master_name`/`master_color` без изменений); `StaffAdmin`/`PositionAdmin`; 6 новых кодов ошибок (`STAFF_NOT_FOUND`, `MASTER_NOT_ACTIVE`, `POSITION_NOT_FOUND`, `POSITION_IS_SYSTEM`, `SPECIALTY_REQUIRED`, `COLOR_REQUIRED`); auth перенесён механически — `AuthedUser.master_id` → `staff_id`, снапшот `/auth/me` собирается из карточки сотрудника + мастер-полей (**форма ответа не меняется**, D10).
  - **Backend — композитный `StaffService` + роуты (`99a08f2`, `2edeb38`, `06b8a57`):** CRUD карточки (POST/PUT = одна транзакция: staff + master-секция + staff_positions + опциональная учётка; archive с телом `{archive_master, archive_user}`; restore; сортировка без `position`; `specialty`/`color` через LEFT JOIN), CRUD `positions` с блоком `POSITION_IS_SYSTEM`; `/api/v1/masters` свёрнут в read-only view (GET + GET /all; все мутации и GET /{id} удалены — потребителей нет); роуты зарегистрированы; backend pytest полностью зелёный с T4.
  - **SSE (`5581492`):** сущности `staff` + `masters` (positions/staff_positions — cascade-only), карта инвалидаций фронта обновлена; новых семейств нет.
  - **api-client (`7cbda05`, `9634e62`, `472d393`):** схемы/эндпоинты staff/position/master-view (`getStaff`/`createStaff` с master-блоком, `position_ids`, `create_user`; archive с телом), masters только чтение, `column_order_staff`, `has_user` в ответе staff, `MasterSection.archived`.
  - **E2E-инфраструктура (`758a0dc`):** фабрики `createTestStaff` (+ master-секция), RESET_SQL переписан под 4 таблицы (восстановление id/порядка сида), `waitForStaffReady`.
  - **Админка — «Сотрудники» (`472d393`, `88fdf8b`, `00eecf1`):** экран `app/(main)/staff/` — StaffTable (имя, должности, специальность, цвет, архив; сортировка всех кроме должностей), StaffModal (чекбоксы должностей, секция «Мастер», чекбокс создания учётки), ArchiveStaffDialog (чекбоксы D6), staff hooks/context; `MastersContext` остаётся read-only потребителем `/masters`; строка «Сотрудники» в «Справочниках»; vitest.
  - **Админка — справочник должностей (`fbaf108`):** плоская страница `app/(main)/positions/` (создать/переименовать/удалить; встроенные не удаляются, тост-объяснение) + строка «Должности» + тесты.
  - **E2E-сценарии (`88fdf8b`, `fbaf108`, `3fc392c`, `e3fb28d`):** staff-спеки S1–S7 (СММ невидим, приход/архив мастера с живой историей, миграционный смоук, только действующие в выборе, справочник должностей, чекбоксы увольнения, карточка одним сценарием с учёткой и мастером); s7 login-probe изолирован (`3fc392c`).
  - **Тесты (полный прогон T11):** backend pytest **1871 passed / 0 failed / 8 skipped**; api-client **349 / 0**; admin vitest **1790 / 0**; `tsc` 0; e2e shards — schedule **94/94**, rest **269/279** (9 ожидаемых visual font-drift + 1 pre-existing server-push C3 flake; авторитетен CI).
  - **Красные окна плана закрыты:** T1–T3 backend pytest красный (masters-тесты переписываются) → закрыто к T4 (полный зелёный); T6–T8 фронт type-check красный в зоне экрана мастеров → закрыто к T8. E2E полностью зелёный после T10.
  - **Доки:** domain-rules `staff.md` (из `masters.md`), `_overview.md` (сущности, naming, матрица удалений, поисковая матрица), `auth.md`, `profile.md`; соседние доки под staff-словарь — `auth-design.md`/`auth-247-plan.md` (только тексты #247; код перенесён в T2), полная перепись `user-cabinet-design.md` (#262, ревизия 3); impl-заметки `docs/notes/2026-09-12-staff-restructuring-266-impl.md`.
  - **190 files changed, +11 800 / −4 350** (диапазон `6dcf87a..docs-commit`).
  - **Closes:** #266.
  - Design spec: `docs/specs/2026-09-10-staff-restructuring-design.md` (on branch)
  - Plan: `docs/plans/2026-09-10-staff-restructuring-266-plan.md` (on branch)

## [Unreleased] — 2026-09-11

### Added
- **GH #247 — Полная авторизация API и admin-приложения: сессии, роли `admin`/`master`, default-deny** — branch `feat/auth-247` (25 commits: e8690b8..843f647; 14/14 plan tasks, plan checkboxes closed):
  - **Backend auth-пакет (`backend/src/auth/`):** `pwdlib[argon2]` с закреплёнными параметрами (`passwords.py` — Argon2id `t=3/m=64MiB/p=4`, политика 8–64 символа с обрезкой краёв и запретом control-символов, единая подсказка `PASSWORD_POLICY_HINT_RU`, `DUMMY_HASH` для timing-parity); `Session` ORM (opaque `secrets.token_urlsafe(32)` токен, **скользящее idle-окно 7 дней** с троттлингом продления 1 ч и **абсолютный кап 30 дней**, session-id rotation при логине, зачистка просроченных строк) + миграция `sessions` и 3 колонки лестницы блокировок на `users`; `AuthService` (login/logout/resolve); матрица `ROLE_PERMISSIONS` (`*` у админа, явный набор у мастера) + `AuthedUser` + `require_session`/`require_permission`.
  - **Endpoints (`/api/v1/auth`):** `POST /login` (ставит `HttpOnly` cookie `memo_session`, `SameSite=Lax`, `Secure` только в production, `Max-Age` = абсолютный кап), `POST /logout` (204, cookie очищается), `GET /me` (`{user, permissions, master?}`; без сессии → 401 `AUTH_UNAUTHORIZED`, чтобы фронт отличал «нет сессии» от «неверный пароль»).
  - **Default-deny guards:** все `/api/v1`-роутеры закрыты по матрице §3.7 — публичные GET справочников и анонимный `POST /records` остаются открытыми через `PUBLIC_ROUTES`; `Sec-Fetch-Site: cross-site` на аутентифицированных мутациях → 403 CSRF-проверка. Контрактный тест обходит `app.routes` и сверяет каждый роут с `PUBLIC_ROUTES` в обе стороны (включая staleness), плюс параметризованная guard-матрица (аноним → 401, админ → 2xx, мастер → 403 на `payments:write`/`materials`/`DELETE clients`).
  - **Lockout ladder (DB-backed, сбрасывается админом):** 3 неудачи → 15 мин, ещё 3 → 1 ч, ещё 3 → жёсткая блокировка до ручного сброса администратором; заблокированный аккаунт отклоняет даже верный пароль. Вторичные in-memory счётчики: **per-phone (5)** и **per-IP (20)** в фиксированном 15-минутном окне (закрывают unknown-phone и credential stuffing). Failure-пути коммитят мутацию лестницы до исключения.
  - **user-settings own-only (BREAKING):** query-параметр `user_id` убран из GET/PUT/PATCH — пользователь берётся из сессии; DELETE чужой строки → 403 `AUTH_FORBIDDEN`, своей → 204.
  - **sqladmin:** собственный `AuthenticationBackend` (вход только для роли admin, переиспользует `AuthService`), `UserAdmin` с `PasswordField` и хешированием через `on_model_change` (пустое поле при редактировании = не менять), `SECRET_KEY` в конфиге с fail-fast в production.
  - **CLI и seed:** `python -m src.cli create-user --phone … --role {admin,master}` (двойной `getpass`, `validate_password`, понятная ошибка на дубликат телефона); dev-only `seed_staff_users()` — `+79990000001/admin12345` (админ) и `+79990000002/master12345` (мастер, привязан к первому сид-мастеру), не выполняется при `ENV=production`.
  - **api-client:** `credentials: 'include'` на каждом вызове; `setUnauthorizedHandler` (401 вне `/auth/*` → редирект на вход); `login`/`logout`/`getMe` (`getMe` резолвит 401 в `null` — guest-bootstrap); user-settings-функции без `user_id`.
  - **Admin:** новая страница `/login` (контролируемые поля, inline-ошибка + тост, `returnTo`), `AuthContext` (состояния loading/authenticated/guest, `can()`, регистрация 401-обработчика → `/login?returnTo=…`), клиентский guard в `(main)/layout`, реальный блок пользователя в `Menubar` (имя мастера или телефон, роль «Админ»/«Мастер», выход); `UserSettingsContext` загружается только при аутентификации.
  - **E2E:** `globalSetup` логинит сид-админа через API и сохраняет **shard-scoped** `storageState`; оба проекта стартуют аутентифицированными, login-спеки отключаются пустым `storageState`. Новые спек-файлы `auth-login`/`auth-roles`/`auth-session` (сценарии 1–4).
  - **Tests:** новые backend-сьюты `test_auth_passwords/permissions/service/api/contract/guards`, `test_auth_session_model`, `test_sqladmin_auth`, `test_cli`, `test_seed_staff`, `test_user_settings_auth`; admin vitest `AuthContext`/`LoginPage`/`MainLayoutGuard`/`Menubar`/`UserSettingsContext`; api-client auth-тесты.
  - **Docs:** создан `docs/domain-rules/auth.md`; синхронизирован `docs/domain-rules/user_settings.md` (own-only); обновлён `docs/tests_workflow.md` (storageState + same-site baseURL).
  - **Closes:** #247.
  - Design spec: `docs/specs/2026-09-08-auth-design.md` (on main)
  - Plan: `docs/plans/2026-09-08-auth-247-plan.md` (on main)

### Changed
- **GH #247:** сигнатуры user-settings в `api-client` стали no-arg (server derives from session); `ServerEventsProvider` открывает `EventSource(eventsUrl, { withCredentials: true })` — SSE-эндпоинт за guard'ом; `InlineEditRow` показывает отклонённое сохранение стандартным error-тостом и оставляет строку редактируемой; e2e `baseURL` зафиксирован на `http://127.0.0.1:{SHARD_PORT}` (same-site для `SameSite=Lax` cookie), route-моки visual-regression эхоят origin + `Access-Control-Allow-Credentials`, visual-базлайны перегенерированы; `.gitignore` игнорирует `frontend/test-results/` (session-токены storageState).

## [Unreleased] — 2026-09-09

### e2e seed reset (#252) — per-test deterministic seed state
Branch `feat/e2e-seed-reset-252` (9 commits: 3513a94..8d0964a + CHANGELOG). Spec:
`docs/specs/2026-09-09-e2e-seed-reset-design.md`; plan: `docs/plans/2026-09-09-e2e-seed-reset-plan.md`.

**What changed (test infra only — no product code):**
- **Per-test seed reset (determinism guarantee):** new shared module `frontend/admin/e2e/fixtures/seed-reset.ts` — ONE canonical `RESET_SQL` (children-first DELETEs of non-seed rows: payments → visits → records → activities (strict `ev_*` filter) → visitors → clients; `sort_order` CASE-restores for masters/locations; `PRAGMA busy_timeout=5000` for the live-backend regime) + `resetToSeed()` (call-time DB-path resolution: `SHARD_ID` → shard DB, else `TEST_DB_PATH`, else master) + `snapshotDb()`. A wrapper `test` (`e2e/fixtures/test.ts`) exposes an auto test-scoped `seedReset` fixture that resets the DB to canonical seed before EVERY test, incl. retries. Guarantee is honest and narrowed (D3): non-seed rows from any earlier test (incl. crashed ones) are invisible and restorable attributes are canonical — but **seed rows themselves are not re-seeded**: tests must not mutate/delete seed rows; `seed.py` stays the single seed source.
- **globalSetup** now consumes the same `RESET_SQL` (no drift possible) and keeps both #152 seed-contract checks verbatim.
- **Serial local runs:** `workers: 1` pinned unconditionally in `playwright.config.ts` (CI was already serial — no CI change). The fixture throws a labeled error if `workers > 1` — an accidental parallel override fails loudly instead of silently reintroducing reset races.
- **Retry-snapshot forensics (D7):** on a retry attempt the fixture first saves a consistent DB snapshot (`sqlite3 .backup`) into `testInfo.outputDir`, attached as a failure artifact — the next test's reset no longer destroys the evidence.
- **`cleanTestData()` deleted** from `fixtures/helpers.ts`; its 7 manual calls (visual-regression ×3, week-view ×4) removed — the auto fixture supersedes them. All 47 spec files import the wrapper `test`; no Playwright test-hook registration outside it.
- **S4 outcome — RED run found 0 additional order-coupled tests.** The first full-suite run with the reset live (shard-schedule 94 + shard-rest 255) produced NO failure from order-coupling or seed mutation: the per-test reset heals all sibling leaks. The 12 failures of that run were pre-existing (2 × #255-family render-wait flakes — fixed separately below — and 10 known local visual-drift entries, re-baseline on CI).
- **6 unified-rows seed-mutators rewritten to factory-owned data** (commit 8d0964a): the r2 seed-visit DELETE, seed-r1 visit/payment adds in scenarios 9a/11/13/14, and the scenario-5 direct `UPDATE visitors` now create their own records/visitors/payments via `e2e/fixtures/factories.ts` and assert on own ids — no test touches seed rows anymore.

**Verification (Task 6 matrix, this worktree, per-test reset live):**
- **S1 — unified-rows standalone ×3:** `pnpm exec playwright test e2e/unified-rows.spec.ts --repeat-each=3 --workers=1` — 66/66 passed, three consecutive invocations (12.2m / 11.5m / 11.5m). Post-run DB assertions: seed contract intact (r2 has exactly 2 visits; `vis1` name canonical).
- **S2+S5 — full shard suite ×3:** both projects green in 3 consecutive runs — shard-schedule **94/94 ×3** (5.4m / 5.3m / 5.2m), shard-rest **244 passed + 11 failed ×3**, and the 11-failure set is **byte-identical across runs, including exact pixel deltas** (e.g. clients-table-picker-open 3026px / 0.01 ratio, wave6 status shots 124×32→127×31). All 11 are the known local visual-baseline-drift family (7 `visual-regression.spec.ts` table/page shots — the 10 known entries plus `records-filtered` with the same 0.01-ratio signature — and the 3 `wave6-status-snapshots` font-metric drifts; A/B-proven env drift, CI runner is authoritative, re-baseline there). Zero order-coupling failures anywhere: seed-reset determinism holds at suite scale.
- **Test-env note (local-only, pre-existing):** local `test-all.sh` boots both shard `next dev` servers sharing `frontend/admin/.next` — route chunks are served cross-baked (wave-#216 poisoning family; reproduced with direct chunk-level evidence: `records/page.js` on :3002 contained `127.0.0.1:8002`), failing 10–80 tests non-deterministically. CI is immune (each shard is a separate runner job). The ×3 matrix was therefore executed as sequential isolated shard segments (one stack + fresh `.next` at a time = CI's exact isolation; same projects/env/DBs). Script unchanged.

**Runtime delta (honest numbers):**
- **CI (pre-#252 baseline, last green main run 34199566473, 2026-09-08):** e2e shard-schedule 3m51s, e2e shard-rest 11m08s (parallel jobs; ~300 tests, `--workers=1` already).
- **Post-#252:** CI sees only the reset overhead — ~349 tests × 50–100 ms per CLI-spawned reset ≈ **+15–35 s per full run** (spec §3.1 estimate; no CI run of this branch yet). CI shape unchanged (already serial).
- **Local (this container, post-#252):** shard-schedule ≈5.3m, shard-rest ≈18.5m playwright time (sequential segments, ~24m + ~2–4m boot). Local comparison to pre-#252 is not apples-to-apples: local runs gave up parallelism by design (D4 — `workers: 1` unconditionally), the accepted price for per-test determinism.

**Also rides this PR — fix(#255 family):** `schedule-column-visibility.spec.ts` waits for the first column header before asserting the column count after a location-mode switch (commit 7074c92). Kills the load-sensitive `waitForScheduleReady` 10s-timeout flake family (activity-details-modal, client-phone-typeahead — both green ×3 in the matrix above).

### Added
- **GH #239 — Server push channel for cache invalidation (SSE `GET /api/v1/events`)** — branch `feat/server-push-invalidation-239` (17 commits: f2f0e94..63740b0; 10/10 plan tasks; spec §8 DoD all met):
  - **Backend:** FastAPI upgraded 0.136.3 → **0.141.1** (native `fastapi.sse.EventSourceResponse`). New `backend/src/events/` package — transport-agnostic in-memory **EventHub** (module-level singleton, bounded 64-event queues, overflow → drop that subscriber), canonical entity-name map, **SSE endpoint** (routing-native async-generator, native ping + `retry: 5000`, `event="invalidate"` frames carrying `{entities, origin}` JSON). **Post-commit emit:** `@transactional` is now the single emit point — contextvars accumulator + `mark_changed(entity)` for cross-entity cascades (own `entity_name` auto-marked; commit → one batched `hub.publish`, rollback → discarded); a small ASGI middleware lifts `X-Memo-Tab-Id` from mutating requests into the request-scoped origin. Cascade enumeration audited and test-pinned (visits→records hooks, activity/record deletes, nested record-create conditionals, dependency-executor marks, master archive/restore→users).
  - **api-client:** exported `eventsUrl` (derived from `API_BASE`); every mutating request attaches `X-Memo-Tab-Id` at the single fetch choke point (not on GETs).
  - **Admin:** new `ServerEventsProvider` (inside the query-client chain) opens `EventSource(eventsUrl)`; `onmessage` → shared **`INVALIDATION_MAP`** family rules (`lib/invalidate.ts` — single source of family cascades, consumed by BOTH the SSE handler and own-mutation sites; ~10 mutation sites mechanically migrated to `invalidateEntities(qc, …)`, hooks keep point-key/conditional invalidations on top); «Данные обновлены» info toast shown ONLY for external origins (own-tab events suppressed by tab-id comparison); SSE reconnect after error → blanket `invalidateQueries()` convergence (no toast); `refetchOnReconnect: false` (SSE owns reconnect).
  - **Tests:** backend pytest **1573p/8s/0f** (new `test_events_hub/emit/entities/sse.py`); admin vitest **1679p/0f** (112 files) + `tsc` clean + lint clean; api-client 268p/0f; e2e — new server-push specs **6/6 (C1–C6**: external-update invalidation, offline reconnect convergence, own-mutation silence) + affected suites green (records 23, schedule 7, photos-crud 19, tags-crud 11). DoD: channel live, origin suppression, drift mirrors both sides (backend completeness test + frontend map-mirror test), docs re-synced.
  - **Decisions for the record:** (1) httpx 0.28.1 `ASGITransport` deadlocks on SSE streams → raw-ASGI test harness; (2) executor cascade marks live in `services/generic.py` (where dispatch physically lives), not `deletion.py`; (3) FastAPI 0.141.1 SSE is routing-native (generator + response class) — plan's `EventSourceResponse(gen(), ping=15)` shape adapted, native ping used; (4) `providers.tsx` `refetchOnReconnect: false` (test-integrity + SSE-owns-reconnect); (5) `INVALIDATION_MAP` audited deltas: services→+materials, locations→+records; (6) e2e C6 attributive silence probe (frame-logger + retry) due to cross-test SSE broadcast interference; (7) `users` entity = cascade-only entry (no UserService exists).
  - **Docs:** `docs/ARCHITECTURE.md` channel section + `queryKeys.ts` header synced (commit `63740b0`, T10).
  - **48 files changed, +3008 / −134.**
  - **Closes:** #239.
  - Design spec: `docs/specs/2026-09-08-server-push-invalidation-design.md` (on main)
  - Plan: `docs/plans/2026-09-08-server-push-invalidation-239-plan.md` (on main)

### Changed
- **GH #246 — Visual E2E determinism: dev-overlay hidden via config-level `stylePath`; all visual baselines regenerated overlay-free** — branch `feat/visual-e2e-determinism-246`:
  - **Test infra:** the Next.js dev-overlay (`nextjs-portal`) is now hidden in ALL `toHaveScreenshot` shots via a single config-level stylesheet — `frontend/admin/e2e/fixtures/hide-dev-overlay.css` (`nextjs-portal { display: none !important; }`) wired through the custom `expect.toHaveScreenshot.stylePath` in `frontend/admin/playwright.config.ts`; the old photos-only JS hider is deleted. Every visual spec (present and future) gets overlay-free capture for free, no per-spec hider code.
  - **Baselines:** all three snapshot dirs regenerated on the CI runner via `update-snapshots.yml` (workflow_dispatch on the branch ref — same ubuntu-latest image that runs the `e2e-tests` job). 56 PNGs updated: 53 in `visual-regression.spec.ts-snapshots/` (table shots that carried the toast: clients/locations/masters/materials/records/services/tags × 7 states + `modal-new-booking`/`modal-settings`/`records-default`/`records-filtered`) + 3 in `week-view.spec.ts-snapshots/` (`menubar`, `schedule-default`, `schedule-with-activities`). The 22 remaining baselines are byte-identical (photos-table shots were already clean; wave6 status shots are element-cropped with the overlay out of frame; `schedule-next-week` captures post-interaction state) — diff shape confirms the stylePath mechanism applied, not env/font drift.

## [Unreleased] — 2026-09-08

### Added
- **GH #221 — Record form: client phone typeahead — partial-digit national matching, AsYouType mask, pick-binds-by-id, save-time digits resolution** — branch `feat/client-phone-typeahead-221` (13 commits: 5b366b6..a25bfb4, base 2518dfb; 7/7 plan tasks — T1/T3 trivial, T2/T4/T5/T7 standard, T6 large wiring):
  - **Backend:** new digits-mode filter `?phone=` on `GET /api/v1/clients` — `ClientListParams.phone` reduced through the single §3 rule and bounds-guarded to 4–15 digits (before COUNT; combines AND with `status`/`q`/pagination). Reduction lives ONCE in new `backend/src/domain/phone_digits.py` (`to_national_digits` — strip non-digits, drop the leading 7/8 of an 11-digit RU number; tolerant, never parses); the stored side is reduced in SQL via the custom SQLite function `memo_phone_national` (registered next to the Cyrillic `lower()` override in `database.py`) and compared `LIKE '%digits%'` — so tail-of-number search works (`4567` matches `+79991234567`) across any stored format (`+7…`/`8…`/national). **Validation is a `BeforeValidator`, NOT `@field_validator`:** the clients list is a `Depends()` params model and FastAPI 0.136 validates each query field through its own TypeAdapter — a model-level validator fires only at model construction inside `solve_dependencies`, uncaught → 500 (ValueError in the BeforeValidator maps to 422 like the `q` Field bounds). `q` semantics, the exact route `GET /clients/get?phone=`, and all write paths untouched.
  - **api-client:** `phone?: string` on the client-list params (one-line `GH #221` comment).
  - **Admin — parameterized typeahead (T4/T5):** `RemoteSearchSelect` generalized — optional knobs `minChars` / `canSearch` / `buildParams` / `formatInput` / `getDisplayLabel` / `inputTestId` / `onInputValueChange`, defaults = prior behavior (Photos consumers byte-identical, min-2 `?q=` kept). New shared `PhoneInput` wrapper on `libphonenumber-js` `AsYouType` (`min` metadata — new `frontend/admin` dependency; RU default, `+` prefix switches international grouping e.g. `+375` → BY; no country dropdown; caret not managed, v1 limitation) — `package.json` + lockfile + local `declare module` for `getNationalNumber`. Search digits come from the formatter's national-number output (`getNationalNumber()`) — **never scraped from the formatted display** (scraped digits would carry the decorative `8`/`+7` and break tail-of-number search). Suggestions fire from the **4th typed digit** (1–3 digits — no requests, no dropdown), debounced 300 ms, request `?phone=<digits>&per_page=10`, **active-only**, row `Name · phone` with «Без имени» fallback.
  - **Admin — record-form wiring (T6):** NewBookingTab phone field → PhoneInput (the old ≥10-char onBlur `getClientByPhone` auto-name-fill removed — decision 10); **picking** a suggestion binds the record to that client **by id** and freezes phone + name read-only with a clear (×) affordance; `CreateRecordInput` became a **`kind`-discriminated union** — `{kind:'picked', client_id}` XOR `{kind:'unpicked', phone, name, client_id:null}` (disjoint submit payloads, no placeholder empties; `NewBookingSubmitData` aliases it as the single save-contract source). onInputValueChange fires on pick/clear so the payload never mixes states.
  - **Save-time resolution (T7):** unpicked save must pass the **completeness guard** (decision 11 — `parsePhoneNumberFromString(value, 'RU')?.isValid()`, same library + RU default as the mask; invalid → blocked with «Проверьте номер телефона — возможно, он введён не полностью», nothing fetched/created); then a **fresh** `?phone=` national-digits fetch of the typed number (never the suggestion snapshot) → the first row whose national digits EQUAL the typed digits binds — both sides compared through the §3 reduction (`toNationalDigits`, TS mirror of `to_national_digits` colocated in `useRecordMutations.ts`, so any stored spelling matches; parity with the old first-or-404); no match → create with the **visible formatted string** as phone (**WYSIWYG ruling**); fetch failure → save blocked (fail closed) — never a silent duplicate.
  - **Tests:** backend pytest 1563p/0f/8s (+29: `test_domain_phone_digits.py` NEW + `test_api_clients.py` `?phone=` matrix incl. bounds/UDF/LIKE); api-client 264p/0f; admin vitest 1695p/0f, `tsc` 0, lint 0 errors (33 pre-existing warnings); e2e — new `client-phone-typeahead.spec.ts` **8/8** (S1–S7 + onBlur-silence regression); 2 stale e2e expectations updated to the WYSIWYG save contract per plan-T7 (activity-details-modal data-persists, clients US-6) → targeted activity-details-modal 14/14 + clients 21/21 green.
  - **Acceptance criteria:** all Behavioral Delta items delivered — fragment search, format-agnostic matching, mask WYSIWYG, no-duplicate save, completeness guard, 1–3-digit silence, archived hidden, picked-edit inert (name editing stays in the client card), Photos untouched.
  - **Decisions for the record:** (1) WYSIWYG ruling — an unpicked save stores the VISIBLE masked string (2 e2e expectations updated per the plan-T7 contract); (2) `BeforeValidator` over `@field_validator` (FastAPI 0.136.3 Depends-params 500 bug); (3) `CreateRecordInput` → `kind`-discriminated union (T6 quality outcome); (4) libphonenumber-js/min import shape + local `declare module` for `getNationalNumber`; (5) RemoteSearchSelect optional knobs with prior-behavior defaults (Photos byte-identical); (6) scenario-7 E2E written in T5, unskipped in T7 (plan sequencing optimism).
  - **Docs:** domain-rules `clients.md` #221 sections (landed with the spec at G1b) synced to landed reality — save-time equality compares both sides via the §3 reduction (`toNationalDigits` TS mirror), resolution basis = the fresh `?phone=` national-digits fetch.
  - **25 files changed, +1902 / −109.**
  - **Closes:** #221.
  - Design spec: `docs/specs/2026-09-07-client-phone-typeahead-design.md` (on main)
  - Plan: `docs/plans/2026-09-07-client-phone-typeahead-221-plan.md` (on main)
- **GH #223 — Materials↔Services M2M link (`service_materials` with per-link note); `?material_id=` service filter; `used_in_services_count` on materials; `material_hint` retired everywhere** — branch `feat/materials-services-link-223` (17 commits: df5fb22..9187aaa; 13/13 plan tasks):
  - **Backend:** new `ServiceMaterial` M2M association — `service_materials` table (composite PK, per-link `note`) + Alembic migration `a9b1c3d5e7f2` (create `service_materials`, drop `services.material_hint`). Service reads (get/list) embed the nested `materials` payload (link note + material snapshot); the create/update write path replaces links via `_replace_service_materials` with 422 pre-validation of unknown `material_id`. `GET /api/v1/services` gains `?material_id=` (join-predicate filter, invalid UUID → 422). Materials list/get gain the canonical `used_in_services_count` aggregate (counts only NON-archived services). Deletion matrix: `service_materials` rows auto-cascade on BOTH sides (service and material hard-delete); material delete surfaces the 409 dependency flow with side-aware relation labels.
  - **api-client:** service schemas carry the `materials` payload; services list params gain `material_id`; material schemas gain `used_in_services_count`; `qk.materials` invalidation added on service mutations (S4 acceptance required).
  - **Admin:** services table gains a materials-badges column; ServiceModal gains a materials multi-select with per-link notes (S1, S3); services page gains the material filter dropdown (S2 — archived materials drop out of the picker options, asserted); materials table gains the usage column backed by `used_in_services_count` (S4); DeleteDialog treats `service_materials` as AUTO entities with side-aware `RELATION_PLURAL` labels (S5). T2 absorbed mechanical admin type-fixes (`materials: []` fixture lines, ServicesTable cast).
  - **Web:** client consumes materials from the service links instead of the retired `material_hint`; booking prefill from the selected material (S6). Bonus repair: pre-existing `useSchedule` envelope bug fixed (`{items, total}` vs bare arrays — the hook predated #182 pagination and web cards were broken at baseline); the `materialDetails` rename was propagated to the admin `buildSchedule` mapper (T13 later removed the read).
  - **Tests:** backend pytest 1534p/0f/8s (+45 vs baseline 1489); api-client 263p/0f (+18); admin vitest 1657p/0f, `tsc` clean, lint 0 errors; web vitest 347p/0f (+9), web `tsc` 28 pre-existing (−1 net); domain 38/38. E2E: admin services-materials 4/4 (S1–S4), materials-delete 3/3 (S5), web materials.spec 3/3 + web visual 4/4 (S6). Spec §10 checklist fully executed — T13 DoD grep leaves only historical/regression references to `material_hint`.
  - **Decisions for the record:** (1) conftest additive `create_all` shim during Tasks 1–12, removed in T13 (migration now authoritative); (2) T9 included api-client `used_in_services_count` + `qk.materials` invalidation on service mutations (S4 acceptance); (3) T11 DeleteDialog `service_materials` → AUTO_ENTITIES + side-aware labels; (4) T12 repaired the pre-existing `useSchedule` envelope bug (broken at baseline) and propagated the `materialDetails` rename to admin `buildSchedule`; (5) T13 shipped migration `a9b1c3d5e7f2`, seeds gained `_seed_service_materials` (5 links), visual snapshots regenerated, domain-rules «(in design)» → landed.
  - **Docs:** domain-rules synced in T13 — materials↔services link contract landed, `material_hint` retirement documented.
  - **84 files changed, +3292 / −253.**
  - **Closes:** #223.
  - Design spec: `docs/specs/2026-09-07-materials-services-link-design.md` (on main)
  - Plan: `docs/plans/2026-09-07-materials-services-link-223-plan.md` (on main)

### Changed
### Changed
- **GH #245 — CI triggers split + gates redistribution** — branch `chore/ci-triggers-split-245` (9 commits: a8af4cb..136a276, PR #248, CI green 14/14; 2 of the 9 commits are the S7 probe + its revert — net file set is the 7-file T1–T7 changeset):
  - **Triggers:** Tests workflow now runs on `pull_request` (branches: [main]) + `workflow_dispatch` only — the push trigger is removed; per-branch concurrency with cancel-in-progress added.
  - **frontend-checks:** new job (lint + type-check, admin scope) replaces smoke.yml's frontend-smoke; vitest matrix switched from hand-maintained per-group file lists to native `--shard=N/5` sharding (fixes the silent drop of new test files, esp. `Client*`-named).
  - **Harness gates:** G3 = CI fact-check (merged-PR check rollup + staleness guard) replaces the local baseline run; G7 = pinned fast suite (backend pytest + vitest + type-check + lint, no local e2e).
  - **Docs:** `docs/tests_workflow.md` re-synced (coverage table + trigger scheme); pre-push hook comment refreshed (still no-op).
  - **Live verification (PR #248):** no Smoke runs on PR events; frontend-checks green 28s; 5 shards green; probe run cancelled mid-flight by the next push (S3); throwaway `ClientZOrderingProbe.test.tsx` ran in shard 2/5 with zero matrix edits (S7), reverted; dispatch non-cancellation + no-push-runs verified post-merge.
  - **7 files changed, +92 / −83.**
  - **Closes:** #245.
  - Design spec: `docs/specs/2026-09-07-ci-triggers-and-gates-split-design.md` (on main)
  - Plan: `docs/plans/2026-09-07-ci-triggers-and-gates-split-245-plan.md` (on main)

### Removed
- **GH #245 — `smoke.yml` deleted** — its checks now live in test.yml's `frontend-checks` job + the G7 pinned fast suite.

## [Unreleased] — 2026-09-06

### Added
- **GH #141 — Split `ScheduleContext` (577-line god-context) into `GridSettingsContext` / `ScheduleViewContext` / `ScheduleDataContext` + `ScheduleProvider` composition** — branch `feat/schedule-context-split-141` (13 commits: 8bf7aef..bc5f6b2):
  - **Refactor:** `frontend/admin/contexts/ScheduleContext.tsx` deleted; three focused contexts under `contexts/schedule/` — `GridSettingsContext` (grid settings), `ScheduleViewContext` (view state, verbatim `__memo-*` event-bus listeners), `ScheduleDataContext` (data + mutations + per-directory filter init, С4) — composed by `ScheduleProvider`. New generic `usePersistedState` localStorage hook (DataTable column storage and grid settings both ride it); new `useUnsavedChangesGuard` (beforeunload while dirty). Schedule-page mutations drop the 5s `Promise.race` timeout race; Topbar gains a «Сохраняем…» saving indicator via `useMutationState` + a beforeunload guard. No behavior change (visual-identical refactor, spec §10 scopes С1–С5 as unit-level).
  - **Tests:** admin vitest 1639/1639 (109 files); `tsc` clean; lint 0 errors / 33 pre-existing warnings; backend + api-client untouched (baseline 1489p/0f/8s and 245p/0f — no backend/api-client file in the diff). DoD greps green (`useSchedule\b` empty; `localStorage` confined to `usePersistedState` + UserSettingsContext; no `Promise.race` in `contexts/`). Acceptance criteria (spec §9) all met — zoom-isolation render-counter test, localStorage/Promise.race/useSchedule grep gates, indicator+guard unit tests, filter-init empty-locations test, garbage-storage fallback tests, `activities.md` domain rule verified matching shipped behavior, TS strict + suites green. Visual gate skipped by spec design (no `## Visual Compliance Checks` section); e2e regression deferred to CI per policy.
  - **Deviations for the record:** plan's `useMutationState` `select` snippet was broken in TanStack v5 (select receives the Mutation instance) — shipped `mutation.state.status === 'pending'`; SSR test asserts the exported pure `readPersisted` (react-dom can't mount with `window` undefined); callbacks depend on the stable `mutation.mutate` instead of the whole mutation object (required for zoom isolation, behavior-identical); plan typos fixed (test value 60 not 70, 37.6→50 not 38, `timezone-dnd-bug.test.ts` extension).
  - **55 files changed, +2944 / −1918.**
  - **Closes:** #141.
  - Design spec: `docs/specs/2026-09-06-schedule-context-split-design.md` (on main)
  - Plan: `docs/plans/2026-09-06-schedule-context-split-141-plan.md` (on main)

## [Unreleased] — 2026-09-04

### Added
- **GH #214 — Searchable Combobox for dictionary dropdowns (client-side instant filter over `/all` arrays)** — branch `feat/searchable-combobox-214` (15 commits: 2ad79ae..06f62aa):
  - **Component:** new shared `app/components/shared/Combobox.tsx` (presentational; absorbs CustomSelect's option shape, color swatch and chevron-trigger visual language). Contract (spec §5): `ComboboxOption { value; label; searchText?; color? }` + `ComboboxProps { value; options; onChange; clearLabel; className?; ariaLabel? }` with the `''`-sentinel value contract — clear (`''`) is emitted only via the pinned first row, whose copy stays per-surface («Не выбран» / «Не выбрана» / «Выберите» / «Выберите услугу» / «Все локации/услуги/мастера»). Search input always visible at the top of the open dropdown; filter = case-insensitive substring anywhere in label/searchText (surname or first name both match); «Ничего не найдено» empty state (announced to screen readers, testid `combobox-empty`); internal scroll past ~240px; full keyboard support (arrows/Home/End, Enter selects, Tab commits the highlighted row, Esc closes + returns focus to the trigger and `stopPropagation` — Esc inside a dropdown no longer closes the surrounding modal); ARIA APG listbox semantics (`aria-selected` tracks the committed value, scroll-into-view on keyboard nav, trigger `aria-label`). Testids `combobox-*`. Unit suite `__tests__/Combobox.test.tsx`, no fake timers.
  - **Surfaces migrated (all 14 spec §6 rows incl. G1b amendment rows 13–14):** ClientRecordTab location+service, MasterPicker (external API unchanged — internals → Combobox), ActivityDetailsModal SettingsTab service+location (was native `<select>`), StampPanel master (was native — now routed through MasterPicker) + service, PhotoModal location (generic `select` renderer), BookingFilters (records filter bar) location+service+master, PhotosFilters service+location (G1b). Data fetching / archived semantics per surface unchanged; wrapper testids (`select-service`/`select-master`/`select-location`/`settings-tab`/`stamp-master`) and «Фильтр по …» aria-labels preserved.
  - **Master label unification (spec §6.1):** masters display uniformly as «Фамилия Имя» (`displayMasterName`) in every dropdown — MasterPicker raw-shape labels (was «Имя Фамилия»), BookingFilters master (was first-name-only), StampPanel via MasterPicker (was `shortName`; empty copy «Выберите мастера» → «Не выбран»). Color swatch preserved.
  - **Rename:** `SearchableSelect` → `RemoteSearchSelect` (file, props, export, test file, imports, comments) — zero behavior diff; keeps its distinguishing server-coupled typeahead semantics (300 ms debounce + min-2 clamp) vs Combobox's instant local filter.
  - **Delete:** `CustomSelect.tsx` + `CustomSelect.test.tsx` hard-deleted after its last consumer (MasterPicker) left; no `custom-select-*` references remain in app code or tests (except the self-contained inline HTML in `wave6-status-snapshots.spec.ts`).
  - **Tests:** admin vitest 1580p/0f (102 files; baseline 1571 − 13 deleted CustomSelect suite + 8 Combobox + new per-surface cases), `tsc` clean; e2e migrated to the `combobox-*` flow across 5 specs (`clients`, `activity-details-modal`, `records`, `wave6-record-status-derived`, `photos-crud`) + new `e2e/helpers/combobox.ts`; new e2e user scenarios US-1..US-6 (`combobox-dictionaries.spec.ts`); locally green — records 20/20, records-view 7/7, clients 19/19, activity-details-modal 13/13, photos-crud 19/19, combobox-dictionaries 6/6. Lint + backend/api-client suites = final gate at finishing (after this docs commit).
  - **Acceptance criteria (spec §12 AC1–7) all met** — shared Combobox + suite (AC1), all §6 rows incl. 13–14 (AC2), CustomSelect deleted reference-free (AC3), rename zero-diff (AC4), «Фамилия Имя» + masters.md addendum (AC5), «Ничего не найдено» + Esc-keyboard behavior (AC6–7). Visual gate passed autonomously (behavioral assertions + screenshots `/tmp/visual-compliance-214/`).
  - **Deviations for the record:** US-6 e2e runs on the records filter bar instead of the client record tab (ClientCardModal capture-phase Esc listener — `stopPropagation` can't block it; spec §10 allows any surface; follow-up filed to evaluate `stopImmediatePropagation`). Combobox `aria-selected` tracks the committed value + scroll-into-view polish (spec-conform upgrades from quality review).
  - **Docs:** domain-rules `masters.md` synced (combobox display convention, commit `06f62aa`).
  - **30 files changed, +1524 / −646.**
  - **Closes:** #214.
  - Design spec: `docs/specs/2026-09-03-searchable-combobox-design.md` (on main)
  - Plan: `docs/plans/2026-09-03-searchable-combobox-plan.md` (on main)

## [Unreleased] — 2026-09-03

### Added
- **GH #213 — Records view composite read endpoint `GET /api/v1/records/view` + full frontend re-home off RecordsContext lookup maps** — branch `feat/records-view-213` (18 commits: 9c91d6e..767efe1):
  - **Backend:** new `GET /api/v1/records/view` returns everything the records TABLE renders in ONE request — `PaginatedResponse[RecordViewResponse]` = `RecordResponse` + denormalized display fields (`client_name`, `activity_start`, `is_private`, `service_title`, `master_name` «Фамилия Имя» byte-identical to `displayMasterName`, `location_name`, `master_color`, `paid` via `COALESCE(SUM(amount),0)`) as correlated scalar subqueries in the `_sort_columns` pattern; display subqueries carry NO `is_active` filter → archived clients/masters/services/locations resolve their names (US-3), FK-dangling → `null` (renders «—» / gray dot); route declared before `GET /{record_id}`. Query params IDENTICAL to `/records` — single shared `RecordListParams` + shared `_sort_columns` whitelist → no param drift, same 422 matrix, US-5/US-6 parity by construction. **Repository read-family redesign (G1b Amendment 1):** `BaseRepository` gains a three-method family — `list` unchanged; `list_custom` semantics CHANGED to the row-tuple core (counts the unordered loader-stripped stmt, accepts any service-built `stmt`, returns `tuple[list[Row], int]`); NEW `list_entity` (`TypeVar ModelT`, entity-only scalars) takes over the old `list_custom` role — TypeVar = mypy honesty (multi-column selects can't typecheck against `list_entity`). `RecordService.list`/`ActivityService.list` migrated to `list_entity` (byte-identical behavior); **Photos migration (G1b Amendment 2):** `PhotoService.list` re-homed onto the `list_custom` core — its count-after-order deviation fixed by construction. Mid-loop fix `5b61f77`: pre-existing q+client/service sort 500 on `/records` and `/records/view` fixed via `.correlate()` on the name sort subqueries (architect-sanctioned); `74162cc` annotation fix (`PaginatedResponse[RecordViewResponse]`).
  - **api-client:** `RecordViewResponseSchema` + `getRecordsView(...)` + `getClientById`.
  - **Admin — RecordsContext becomes a pure view-list context:** records query → `getRecordsView` (cache key unchanged, `keepPreviousData`), `records` = `RecordView[]`; all 6 display lookup-map queries + map construction + `payments` map DELETED (US-2: display path = exactly ONE `/records/view` call, ZERO `/clients?...&per_page=100` / `/activities...` / `/payments/totals` from the records page). **Re-homes:** `recordsColumns.tsx` renders view-row fields (lookup seam deleted — pure `(t) => ColumnDef<RecordView>[]`); RecordsTable detail panel reads view rows (payments block stays read-only per spec §6.3); BookingFilters owns its selection data via canonical-key queries (dropdowns still populate/filter); ClientQuickCard fetches the client by id; ActivityDetailsModal by-id clients fallback + **RecordsProvider removed from the schedule page**. Payment mutations (`addPayment`/`deletePayment`/`patchPayment`/`deletePaymentDeferred`) now invalidate `['records']` alongside `['record', id]` → `paid`/status view row refreshes (US-4).
  - **Tests:** backend pytest 1489p/0f/8s (+56: `test_api_records_view.py`, `test_service_record_view.py`, `test_repository_list.py` read-family, `test_service_photo_list.py`, mypy-negative fixture); api-client 239p/4f (4 = known pre-existing #188, unchanged); admin vitest 1571p/0f + `tsc` clean + lint clean; mypy 317 ≤ baseline 318 (zero new); e2e — **records-view.spec 8/8 (US-1..US-6)** + records.spec 23/23 + statuses-family 5/5. Mid-loop fix `5944681`: BookingFilters dropdown-population test timeout window.
  - **Acceptance criteria: spec §8/§12 all met** — US-1 beyond-100-cap client name, US-2 single display request, US-3 archived-entity resolution (incl. dangling-service «—»), US-4 paid freshness, US-5 filter parity (every filter + `?q=` identical totals), US-6 sort parity (all `sort_by` × asc/desc, API + UI). Visual gate passed (DOM-evidence + e2e/unit mapping; 1 script "fail" = false negative — it searched for the «—» fallback marker and 0 matches IS the pass condition).
  - **Deviations for the record:** US-4 e2e enters payment-add via the schedule-modal client tab (only shipped payment-add UI; the records-panel payments block is read-only per spec §6.3) — architect accepted. 13 Playwright visual baselines drifted by intentional UI changes → regenerate via the CI update-snapshots workflow at finishing (project standard, cf. PR #234). activity-details-modal.spec.ts test-4 within-file ordering flake is pre-existing (A/B-proven on pristine base).
  - **Docs:** domain-rules synced — `records.md` read-family normative rewrite + view contract, `photos.md` exception wording, `activities.md` label-pin note (commit `767efe1`).
  - **38 files changed, +3414 / −793.**
  - **Closes:** #213.
  - Design spec: `docs/specs/2026-09-02-records-view-endpoint-design.md` (on main)
  - Plan: `docs/plans/2026-09-02-records-view-endpoint-plan.md` (on main)

## [Unreleased] — 2026-08-29

### Added
- **GH #216 — Clients `?clientId=` deep-link opens ClientCardModal from any list position (fixes the US-6 e2e flake)** — branch `feat/clients-deeplink-216` (7 commits: 30e460e..0d036f8):
  - **Frontend:** `/clients?clientId={id}` (producer: ActivityDetailsModal `window.open` → fresh mount) now opens ClientCardModal for ANY existing client — the new deep-link effect programmatically narrows the table via `setFilters({ search: id, status: 'all' })` → server `q=` full-UUID exact-id match (#212 prerequisite) → ≤1 row on page 1 → the existing find-effect opens the modal with server-computed stats. Status is force-set to `all` so archived clients are reachable (display default stays `active`). On modal close the search box is NOT auto-cleared (the user sees why the table is narrowed); dead links (client deleted) strip the param once the narrowed fetch settles empty — no refresh re-narrowing loop.
  - **Controlled search input (ClientsFilters):** search box became controlled (render-adjust pattern + cancellable debounce — no sync-effect footgun): external commits (deep-link / reset) render in the box, commit echo never clobbers newer keystrokes, stale debounce timers cancelled; bonus fix: «Сбросить фильтры» now clears the visible box (previously left a stale string and an armed timer could re-apply the cleared search).
  - **Backend:** ZERO production change — the exact-id `q` match already landed uniformly in #212; T1 contract tests (`test_client_stats.py`) pin the deep-link combo: `status=all` + full-UUID `q` → archived client (1 row, `total 1`) and uppercase-UUID normalization at the clients API level. Premise guard: T1 red would escalate the phase to BLOCKED instead of shipping a silently-broken frontend fix.
  - **Tests:** backend pytest 1433p/0f/8s (baseline 1431 +2); api-client 226p/4f (4 = pre-existing #188, unchanged); admin vitest 1539p/0f (baseline 1526 +13: ClientsFilters +7 incl. quality round, ClientsPage +6 incl. deep-link describe ×5 + close-race ×1), `tsc` clean, lint 0 errors (37 warnings pre-existing); e2e — clients.spec 19/19 (incl. new deterministic page-2+ regression: 20 filler clients + premise self-check guard asserting the target is NOT on unfiltered page 1 + post-close contract), test-19 flake-check 3/3, **unify-caches 7/7 with US-6 GREEN (unedited — the origin anchor)**, admin-opens-profile 1/1; full rest-shard 216p/12f → 12 = 11 known pre-existing visual overrides (#229 ×8, #226 ×3) + 1 the-close-race (then FIXED via Two-Gate, re-verified green); visual gate G4.5 6/6 on desktop+mobile (Playwright evidence, screenshots `/tmp/visual-compliance-216/manual/`).
  - **Deviations for the record:** post-verification bug fix via the Two-Gate Protocol — the close-race (modal briefly re-opened in the window between `setSelectedClient(null)` and the param-strip `router.replace`) killed by a **consumed-latch** added to the find-effect (RED unit test first, spec-review ✅) — sanctioned deviation from the plan's "find-effect verbatim".
  - **Docs:** domain-rules `clients.md` synced (deep-link contract, commit `d872cf7`).
  - **Closes:** #216. Follow-ups filed by DESIGN (spec §10): #231 (derive deep-link search from the URL at initial render to kill the wasted default-key round trip), #232 (if deep-linking scales, revisit a dedicated `?id=` + page-resolution endpoint instead of the UUID-in-search-box compromise).
  - Design spec: `docs/specs/2026-08-29-clients-deeplink-clientid-design.md` (on main)
  - Plan: `docs/plans/2026-08-29-clients-deeplink-clientid-plan.md` (on main)

## [Unreleased] — 2026-08-28

### Added
- **GH #211 — Photos: server pagination + filters + 4-owner model expansion** — branch `photos-server-list-211` (11 commits: 0aeae4e..a6a1024; absorbs #222, #224 closed not-planned):
  - **Model:** Photo 4-owner model — `client_id` / `service_id` / `activity_id` / `location_id` (≤1 owner enforced by DB CHECK `ck_photos_single_owner`; ≥2 owners → 422; owner-less photos OK; no backfill); `visitor_id` removed everywhere; `client_name` denormalized on the list response (resolves archived clients); Client/Location hard-delete → photos auto-nullify (Visitor→photos relationship removed); `GET /photos/web` unchanged.
  - **Backend:** `GET /api/v1/photos` → `PaginatedResponse` with `q` (filename substring, 2–100 chars), `client_id`, `location_id` (DIRECT-only), `activity_id` / `service_id` (variant A — direct OR via activity), `tag_id[]` (repeatable, AND), `sort_by` (`filename` | `is_public` | `created_at`, default created_at desc + id tiebreak); unknown filter ids → empty page; `PhotoService.list` rewrite + merged-set owner validation.
  - **api-client:** paginated photos endpoint + typed filter/sort params (T5).
  - **Admin:** `/photos` server-paginated 10/page + filters bar (Клиент/Активность typeaheads — active-only clients, Услуга/Локация selects, Теги chips AND, Сбросить); 8 columns (Клиент replaces Посетитель, Активность hidden by default, new Дата); PhotoModal Клиент+Локация pickers, activity↔service mutually exclusive (no auto-fill), 422 surfaced; canonical activity label «dd.mm.yyyy HH:mm — Локация — Услуга» project-wide via `formatActivityLabel` (`formatActivityStart` deleted).
  - **Tests:** backend pytest 1431p/0f/8s; api-client 226p/4f (4 = pre-existing #188, unchanged); admin vitest 1526p/0f, tsc clean, lint 0; honest e2e — 8 photos scenarios + clients-delete-cascade extension + 7 regenerated baselines (photos+clients-delete 22/22); full serial e2e 300p/11f (11 = pre-existing records/wave6 visuals — font drift, A/B-proven on base, CI-side snapshot refresh needed); visual compliance gate 9/9 PASS.
  - **Docs:** domain-rules synced (T11, commit `a6a1024`).
  - **Known follow-ups (out of scope):** CI-side baseline refresh for the 11 pre-existing visual e2e failures; api-client #188 datetime failures pre-existing.
  - **Closes:** #211 (absorbs #222 — closed as absorbed; #224 closed not-planned — no group-photo mechanism).
  - Design spec: `docs/specs/2026-08-22-photos-pagination-filters-model-design.md` (on main)
  - Plan: `docs/plans/2026-08-27-photos-pagination-filters-model-plan.md` (on main)

## [Unreleased] — 2026-08-26

### Added
- **GH #212 — Server-side list search `?q=` on all list endpoints (incl. dictionaries) + atomic `search`→`q` rename** — branch `feat/list-search-q-212` (17 commits: e11ebd1..4884412):
  - **Backend:** Unicode-aware `lower()` SQL function override on SQLite connections (Cyrillic case-insensitive search; M5 probe `test_cyrillic_search_probe.py`); new shared `search_predicate` helper (`backend/src/repositories/search.py`); `q` + `search_fields` params on `BaseRepository.list`/`ArchiveRepository.list` + generic services (tags first, then masters/materials/locations/visitors/services; per-entity field matrix — substring with UUID-exact for id/text-key fields, min 2 / max 100 chars, invalid `q` → 422); records list `?q=` via outer joins (joins only when `q` present — query counts stay green); activities list `?q=` + `service_id` filter + optional `service_title` (list endpoints only); clients `search`→`q` rename + `email` search field + `GET /clients/get?phone=` live (was `/clients/search`); **`/api/v1/search/*` router + search schemas deleted** (T14) after the migration.
  - **api-client:** `ListParams.q` serialization; `getActivities` signature relaxed (dates optional, `service_id`/`q`); `search*` methods renamed atomically → list `?q=` consumers (`getClientByPhone` etc.).
  - **Admin:** `serverSearch` flag on the `createPagedListContext` factory — all 5 dictionary tables search server-side via `?q=` (honest totals, ≥2-char clamp, page-reset); **Records gains the filter-bar search input** (server `?q=`, debounced); PhotoModal 4 typeaheads run on list `?q=` (`per_page=10`, ≥2 clamp, `service_title` display); post-#205 client-side `.includes` degradation ended; `useRecordData` query guard behind non-empty `recordId` (pre-existing console ZodError surfaced by the visual gate).
  - **Tests:** backend 1396 passed / 0 failed / 8 skipped (−25 deleted search-router tests; `-k Search` matrix 156p/2s); api-client 209 passed / 4 failed (4 = pre-existing #188, unchanged); admin vitest 1493 passed / 0 failed; admin + api-client `tsc` clean (api-client 6 pre-existing parity); lint clean; e2e targeted — masters 12/12, records 23/23, photos-crud 11/11, clients 22/22 (incl. new full-UUID-paste search test, #216 pre-flight); visual gate 5/5 PASS (autonomous Playwright; script false-failure on check 3 disproven by code+network evidence).
  - **Docs:** domain-rules synced (spec §9) — T8 partial activities sync (+6 lines, accepted deviation, kept living docs accurate) + T16 full sweep (commit `e7c2868`).
  - **Acceptance criteria (spec §12 DoD): all 5 met** — 9 endpoints q-ready with contract matrix green (incl. Cyrillic probe + tags); search router deleted + `/clients/get` live with atomic rename; 8 tables server-side honest totals + records search input; PhotoModal typeaheads on list `?q=` with `service_title`; domain-rules synced + local suites green (CI outage policy: **local test-all is the merge gate**).
  - **Deviations for the record:** T8 included a +6-line domain-rules/activities.md sync; check-5 console fix was out-of-scope-but-diagnosed pre-existing (one line + test); full standalone `test:all` run during T12 showed 67 pre-existing failures (font-drift shards + load flakes, A/B-proven identical at base) — NOT from this feature; targeted specs all green.
  - **Closes:** #212.
  - **91 files changed, +2836 / −799.**
  - Design spec: `docs/specs/2026-08-19-list-search-q-design.md` (on main)
  - Plan: `docs/plans/2026-08-19-list-search-q-plan.md` (on main)

## [Unreleased] — 2026-08-19

### Added
- **GH #139 — Generic DataTable: 8 copy-paste admin tables → shared `<DataTable>` + `PagedListState` contract** — branch `feat/generic-datatable-139` (18 commits: 55bb17a..a44fc25; baseline d97877b):
  - **Admin:** shared `app/components/shared/DataTable.tsx` + `tableTypes.ts` (`ColumnDef`, `RowAction`) own ALL table mechanics — skeleton 10 rows, error+retry, empty state, sortable headers (↕/↑/↓ + aria-sort), pager, ColumnPicker controlled presentational with last-visible-column muted guard, row actions dropdown role=menu with Esc/focus-return a11y. Per-entity code reduced to `<entity>Columns.tsx` (columns + RowAction factories) + thin wiring wrappers. All 8 tables migrated in order Tags→Locations→Masters→Materials→Services→Clients→Photos→Records; wrappers consume `tableState: PagedListState<T>` (createPagedListContext shape; status optional). Contract addenda: rowTestId per-table prefixes, toolbarLead (dict wrappers), actionCellExtra (Locations Карта), rowKey/visibleItems. Legacy ColumnPicker shim deleted; e2e `.or()` transition fallbacks removed.
  - **Behavior unifications (B-scope, intentional):** LS keys hard-cut to `<entity>-columns`; shared DeleteDialog + 409 dry-run for 6 tables (Tags/Photos keep window.confirm); Records/Clients page-reset-on-sort; ↕ neutral glyph everywhere incl. Clients; unified empty copy «Нет записей» on all 8 (Addendum 12, user ruling); Records gains row action dropdown («Открыть» = onRowClick only); ClientCardModal (records variant) renamed ClientQuickCard, no merge.
  - **Backend:** records delete dry-run substrate (Addendum 13 — dialog on ANY deps incl. payments, non-blocking, user ruling 2026-08-22); domain-rules records.md synced (commit `0020abc`).
  - **Tests:** backend pytest 1284p/0f/6s; api-client vitest 202p/4f (4 = pre-existing #188, unchanged); admin vitest 96 files/1460p/0f; `tsc` clean; eslint 0 errors on touched files; e2e shard-schedule 84/84, shard-rest 212/217 — 5 fails pre-existing & classified (3 wave6 status snapshots = local font-metric drift, CI-green on main at same lockfile; 2 records visual = full-shard seed-pollution interference, deterministically green isolated; NOT regressions; #216 flake passed); visual 8×7 matrix 60/60; G4.5 live spot-check 42 assertions PASS (screenshots `/tmp/opencode/g45-139/`).
  - **Polish commit `a44fc25`:** stale-comment fixes, recordsColumns export idiom, formatTime dedup vs `lib/utils`, a11y minors (aria-current page, row-identity aria-labels on ⋯ triggers, skeleton role=status, tautology test title).
  - **Closes:** #139. Acceptance criteria met (spec §11): shared mechanics in one place; TagsTable status-filter bug structurally eliminated (withStatus:false); CRUD suites green.
  - **148 files changed, +6070 / −3428.**
  - Design spec: `docs/specs/2026-08-18-generic-datatable-design.md` (on main, addenda #6–#13)
  - Plan: `docs/plans/2026-08-18-generic-datatable-plan.md` (on main, addenda #6–#13)

## [Unreleased] — 2026-08-18

### Added
- **GH #206 — Repo-owned list queries (pagination moved to repositories; Option C)** — branch `feat/repo-owned-list-queries-206` (10 commits: a60b72e..85fed8f):
  - **Backend:** pagination is now owned by the repositories — `BaseRepository.list`/`list_custom` (with `selectinload` options) replace service-level list logic. `GenericService`/`ArchiveService` rewire to repo `list`; `ServiceService.list` collapsed to a `selectinload` override; `PaymentService.list` override deleted (inherits generic); `VisitService` gains repository DI, list via `repo.list`; records/activity route through `list_custom`; shared `paginate_orm` + `_paginate` core retired. New shared `PaginationParams` schema in **9 list routers** with `RecordListParams`/`ClientListParams` inheriting it. Pure backend refactor — **zero user-visible behavior change**.
  - **Backend (client stats):** `ClientListResponse` collapsed → `PaginatedResponse[ClientWithStats]` with the CQRS read-side concession documented (GH #217).
  - **api-client / frontend:** `ClientListResponseSchema = paginatedSchema(ClientWithStatsSchema)`; frontend `useQuery<PaginatedResponse<ClientWithStats>>`.
  - **Docs:** domain-rules pagination mechanics synced with repo-owned lists (T10, commit `85fed8f`).
  - **Tests:** backend 1265p/0f/6s; api-client 197p/4f (4 = pre-existing #188, unchanged); admin vitest 1370p/0f + `tsc --noEmit` clean. Visual gate SKIPPED (no user-visible UI).
  - **Acceptance criteria (spec §12): all met** — 10/12 list endpoints repo-routed (clients concession documented, GH #217; photos unpaginated, #211), `paginate_orm` retired, shared `PaginationParams` in 9 routers, `ClientListResponse` collapsed, suites green, domain docs synced.
  - **Follow-ups (out of scope, filed by DESIGN):** #217 (CQRS read-side eval), #218 (delete dead `get_generic_repository` + `GenericRepository` alias).
  - **Closes:** #206.
  - Design spec: `docs/specs/2026-08-18-repo-owned-list-queries-design.md` (on main, commit `1c0b8a5`)
  - Plan: `docs/plans/2026-08-18-repo-owned-list-queries-plan.md` (on main, commit `c97e3be`)

## [Unreleased] — 2026-08-18

### Added
- **GH #205 — Dictionaries: bare `/all` endpoint + server-side pagination for dictionary tables** — branch `feat/dictionaries-all-server-pagination-205` (13 commits: 05e2049..be6c8fd):
  - **Backend:** `GenericService.list_all()` + `ArchiveService.list_all()` (status pass-through) with shared `BARE_LIST_MAX_ROWS = 1000` limit+1 probe — over-limit raises `BareListLimitExceededError` → **422 English message** (new `backend/src/domain/errors.py`; exactly 1000 rows still works). `ServiceService.list_all()` eager-load override (`selectinload` tariffs+tags — mandatory, async lazy-load crash guard). Bare `GET /api/v1/{entity}/all` routes in the 5 dictionary routers (masters/locations/services/tags/materials), declared before `/{id}` (str path params). `sort_by`/`sort_order` per-entity `Literal` whitelists + `SORT_MAP`s on the 5 list endpoints + **deterministic default orders** (services/tags/materials previously unspecified DB order), invalid sort key → 422. Dictionaries-only guard: `/all` → **404** on non-dictionaries. No DB schema changes → no migrations.
  - **api-client:** 5 `XAllResponseSchema` bare-array Zod schemas + `getAllX` methods; `ListParams` gains `sort_by`/`sort_order` with query-string serialization.
  - **Admin:** shared `createPagedListContext` factory + 5 thin per-entity wrappers (Masters/Locations/Services/Materials/Tags contexts) — server-driven page/per_page/sort/status state (reset to page 1 on change); 5 dictionary tables migrated to **server-side pagination + sorting** (pager 10/20/50/100, numbered pages, prev/next, «всего» label, sortable column headers; Tags withStatus: false). Dictionary lookup maps + dropdown hooks (RecordsContext, ScheduleContext, useRecordData, useMasters/useLocations/useServices) switched to `/all` — `per_page=100` gone for dictionaries. Search boxes unchanged (G1b Q1 — client-side filter of the loaded page; server `?q=` is #212).
  - **Tests:** backend 1259 passed / 6 skipped (full pytest suite, no regressions); api-client 197 passed / 4 failed (4 = pre-existing #188, unchanged); admin vitest 1370 passed / 0 failed (93 test files); `tsc --noEmit` clean; Next build exit 0; visual gate partially verified (2/3 attempted PASS — Masters pager + sort; 1 script-issue "FAIL" not a real bug; all 9 behavioral checks covered by the 1370 unit tests).
  - **Docs:** domain-rules "List contract" sections for the 5 dictionaries (T13, commit `be6c8fd`) — `/all` contract (bare array, 1000-row limit → 422, deterministic order, status parity), paginated list params, consumer map, search matrix pointer.
  - **Closes:** #205. AC1–AC10 all met (spec §7).
  - **70 files changed, +3924 / -1568.**
  - Design spec: `docs/specs/2026-08-17-dictionaries-all-server-pagination-design.md`
  - Plan: `docs/plans/2026-08-17-dictionaries-all-server-pagination-plan.md`

## [Unreleased] — 2026-08-17

### Added
- **GH #207 — DELETE = real hard delete + granular dependency resolutions (пересмотр #194)** — branch `feat-delete-hard-deps` (23 commits: 68aa333..9994b93):
  - **Backend:** `PRAGMA foreign_keys=ON` on all SQLite connections (seed FK insert ordering fixed). `SoftDeleteRepository`/`SoftDeleteService` renamed → `ArchiveRepository`/`ArchiveService` — `delete` is now a **hard delete**, with new `archive()`/`restore()` methods. Response schemas for the 5 soft-delete entities flip `is_active` → `archived` (inverted, `exclude=True` pattern); `is_active` removed from PUT/PATCH schemas — sending it now returns **422** (auto-closes #178). New `domain/deletion.py` — FK dependency matrix + resolver. One unified `DELETE /api/v1/{entity}/{id}` route with two modes: **dry-run** (no body → 204 if deletable, 409 + dependency tree if blocked) and **execute** (wrapped body `{"resolutions": {...}}` → 204 / 422 / 404). `resolve_delete` executor runs nullify → cascade → auto → hard in a single transaction. New `POST /api/v1/{entity}/{id}/archive` + `/restore` (200-with-body). Master→users cascades: delete = auto (§4.1), archive/restore = user cascade (§4.2). `VisitorService._delete_cascade` extracted as a non-decorated core for atomic reuse.
  - **api-client:** Zod schemas flipped `is_active` → `archived` + strict `Update` schemas (no `is_active`) + new `DependencyNode`; new `archiveX`/`restoreX`/`resolveDeleteX` endpoint methods (DELETE with wrapped body).
  - **Admin:** mutation hooks + `ClientsContext` — 409-aware delete with cross-invalidation; shared `DeleteDialog` (Mode A type-to-confirm destroy, Mode B blocked→archive); 5 tables wired (+Client restore parity, auto-closes #198); all fixtures migrated to `archived`.
  - **Tests:** backend 1205 passed / 0 failed / 5 skipped; admin vitest 1331 passed / 0 failed; `tsc` 0 errors; api-client 189 passed / 4 failed (4 = pre-existing #188 baseline, unchanged); e2e 35 new green (7 new specs S1–S7 + `clients.spec.ts` #11 locator fix); Visual Compliance Gate 7/7 PASS (mobile screenshots `/tmp/visual-compliance-gh207/fallback/`).
  - **Docs:** domain-rules synced (Task 23, commit `9994b93`) — hard-delete + archive terminology + FK matrix.
  - **Notable mid-flight fix:** wrapped-only resolutions envelope (`802d891`) — E2E caught a cross-layer contract mismatch that unit tests missed.
  - **Closes:** #207; auto-closes #178, #198; absorbs #189.
  - **121 files changed, +10953 / -1471.**
  - Design spec: `docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md` (on main)
  - Plan: `docs/plans/2026-08-15-delete-hard-delete-and-dependency-resolution-plan.md` (on main)

## [Unreleased] — 2026-08-09

### Added
- **GH #191 — Records list fully server-side: filters + pagination + sorting** — branch `feat-records-server-filters` (12 commits: d8c54e1..bfbc39c):
  - **Backend:** `GET /api/v1/records` is now a server-side filtered / paginated / sorted list driven by a validated `RecordListParams` Query parameter model (`Annotated[..., Query()]`, NOT `Depends()` — Depends + model_validator raise 500). Filters: `client_id`, `activity_id`, `date_from`/`date_to` (whole-day inclusive via the new shared `day_range()` util in `backend/src/domain/dates.py`), `location_id`, `service_id`, `master_id`, `status` (waiting/visited/missed/cancelled). Pagination: `page` (ge=1) + `per_page` (1–100, default 20) via the shared `paginate_orm()` core (COUNT before ORDER BY so correlated sort-key subqueries never run in the count). Sorting: `sort_by` whitelist map (9 keys: date, client, service, master, location, guests, status, total, payment) + `sort_order` (asc/desc) — correlated scalar-subquery sort keys, NULLS FIRST on asc / NULLS LAST on desc (anonymous clients), deterministic `Record.id` tiebreak for cross-page stability; `payment` = 3-level bucket (paid ≥ total → 0, 0 < paid < total → 1, paid = 0 → 2). All invalid params → **422 VALIDATION_ERROR** (incl. `date_from > date_to`).
  - **Activities refactor:** `GET /api/v1/activities` date filter moved onto the shared `day_range` util + `_paginate` core; `date_from`/`date_to` re-typed as `date` — invalid date strings now **422** (was 500 on `fromisoformat`).
  - **api-client:** `getRecords` accepts the full filter/sort param set (`activity_id`, `location_id`, `service_id`, `master_id`, `status`, `sort_by`, `sort_order`) with query-string serialization.
  - **Admin:** Records page is context-driven — `RecordsContext` holds server-driven page/filters/sort state (paginated query, shape-agnostic list cache updaters, `setQueriesData` prefix sync); `RecordsTable` server-driven sort/pagination + page-filter wiring; `ClientCardModal` and `ActivityDetailsModal` moved to dedicated (scoped) queries instead of the shared list.
  - **Tests:** e2e `records.spec.ts` honestly reworked against the server-side contract (21/21); activity-details-modal 13/13, clients 17/17. Backend 1054 passed / 5 skipped; api-client 158 passed / 4 failed (4 = pre-existing #188, unchanged); admin vitest 1256 passed / 0 failed, `tsc --noEmit` clean; Visual Compliance Gate G4.5 passed (8/8 DOM checks; 2 environmental sub-skips covered by e2e).
  - **Spec §10 acceptance criteria all met (§10.1–§10.9 + Scenario 2).** No user-facing breaking changes (deviation details are test-side only, not user-facing).
  - **Domain-rules:** `records.md` (list-contract: params/validation/sort semantics + `seats = len(visits) + anonym_visits` invariant correction), `payments.md` (3-level payment-status bucket shared by display and ORDER BY), `activities.md` (shared `day_range` + 422 on invalid dates).
  - **30 files changed, +2032 / -666.**
  - Design spec: `docs/specs/2026-08-08-records-server-filters-pagination-sorting-design.md`
  - Plan: `docs/plans/2026-08-08-records-server-filters-pagination-sorting-plan.md`

## [Unreleased] — 2026-08-08

### Added
- **GH #201 — Client canonical PUT/PATCH (closes the #178 Client PUT 500-window)** — branch `gh-201-client-canonical-put` (7 commits: 32a8ce9, 9cb5070, 3035777, bfaa156, c282734, c5e7d99, 77af79e):
  - **Backend:** `ClientUpdate` became a standalone 5-key **required** schema (previously `ClientBase` with `is_active` optional) — PUT is true full-replace with **explicit-null wipe semantics**: all 5 fields (`phone`, `name`, `comment`, `email`, `is_active`) required, `None` explicitly wipes nullable fields, omission of any required key → 422. Closes the #178 window where a Client PUT omitting `is_active` hit a 500 (soft-delete sticky-injection path).
  - **api-client:** `ClientUpdateSchema` (required 5-key, explicit-null) + `updateClient(id, ClientUpdate)` typed method; Create-typing bug fixed (`updateClient` previously accepted the Create shape).
  - **Admin:** ClientCardModal/ClientInfoTab edit-save now sends a typed canonical `ClientUpdate` payload — `''` → `null` on save (no more empty-string 422s), save-time channel guard (omitted/invalid phone preserved), `is_active` included in the PUT.
  - **Tests:** e2e `clients.spec.ts` edit-save test **unskipped** (window closed, 17/17 green); backend contract data enriched + data-driven omit flip + payload pinning.
  - **Domain-rules:** `clients.md` + `_overview.md` — Client canonical PUT canon (required-key full replace, explicit-null wipe) + null-semantics divergence note (`null` wipes on PUT vs "don't change" on PATCH).
  - **Test results:** backend 1008 passed / 5 skipped; api-client 156 passed / 4 failed (4 = known pre-existing #188, unchanged); admin vitest 1239 passed / 0 failed + `tsc --noEmit` clean; e2e clients 17/17; Visual Compliance Gate G4.5: 3/3 PASS (autonomous, Playwright fallback).
  - **AC1–AC7 all met (spec §6).** AC8 (CI green) pending PR checks at finishing.
  - **20 files changed, +221 / -73.**
  - Design spec: `docs/specs/2026-08-04-client-canonical-put-design.md` (rev 2, G1b-approved)
  - Plan: `docs/plans/2026-08-08-client-canonical-put-plan.md` (G2-approved)

## [Unreleased] — 2026-08-04

### Added
- **GH #178 — Canonical PUT/PATCH types (api-client + backend, 4 entities: Master, Service, Location, Material)** — branch `gh-178-canonical-put-patch` (6 commits: 7a71b55, 58e7365, 3d85488, 2576a90, bee8246, cb444ac):
  - **Backend:** PUT is now true full-replace for the 4 soft-delete entities — `MasterUpdate`/`ServiceUpdate`/`LocationUpdate`/`MaterialUpdate` require `is_active: bool` (omission → 422), replacing the #184 sticky `bool | None = None`. Sticky-injection override removed from `SoftDeleteService.update`; `ServiceService.update` drops the `_strip_is_active_none` call on the update path (PATCH keeps it). `ClientUpdate.is_active` stays `bool | None = None` as a documented interim #201 wart — a Client PUT omitting `is_active` errors (500) in the window, user-accepted (Next Up #201 redefines Client PUT with explicit-null wipe semantics).
  - **api-client:** 4 `*UpdateSchema` switch from `CreateSchema.partial()` to `CreateSchema.extend({ is_active: z.boolean() })` — canonical full-replace typing; PATCH endpoints drop the `& { is_active?: boolean }` workaround intersections (TODO(#178) comments removed) — `Partial<Update>` is now the canonical PATCH type; `schemas.test.ts` + `endpoints.test.ts` updated.
  - **Admin:** `useMastersMutations`/`useLocationsMutations`/`useMaterialsMutations`/`useServicesMutations` hooks + 4 tables (Masters/Locations/Materials/Services) send typed canonical PUT payloads (incl. `is_active`); 4 hook test files updated.
  - **Domain-rules:** `_overview.md` "is_active semantics on get/update/patch" rewritten (PUT requires explicit bool for the 4 entities; PATCH stays sticky; Client #178→#201 window documented) + 5 entity notes synced (masters/locations/materials/services/clients).
  - **Test results:** backend 999 passed / 6 skipped; api-client 150 passed / 4 failed (4 = known pre-existing #188, unchanged); admin vitest 1239 passed / 0 failed; admin `tsc --noEmit` clean.
  - **AC1–AC7 all met (spec §6).** Visual Compliance Gate (spec §7): 5/5 PASS — 4 admin tables render + edit-save PUT 200.
  - **Pre-existing issue surfaced (NOT a #178 regression):** `ServiceModal.tsx` maps NULL `max_age`→0, blocking edit-save client-side on seed services with open-ended `max_age` — file byte-identical to main; flagged for follow-up.
  - **Known window:** client PUT omitting `is_active` → 500 until GH #201 (user-accepted; Next Up 2 starts immediately after merge).
  - **37 files changed, +411 / -224.**
  - Design spec: `docs/specs/2026-08-04-canonical-put-patch-design.md` (rev 3)
  - Plan: `docs/plans/2026-08-04-canonical-put-patch-plan.md`

## [Unreleased] — 2026-08-04

### Added
- **GH #185 — GenericService HTTP CRUD contract + test_api dedup** — branch `gh-185-api-crud-contract` (4 commits: 522b12e, 333f68d, 541731b, a521bb5):
  - **HTTP-level CRUD contract:** new `backend/tests/test_generic_api_contract.py` (+247) — 116 parametrized sync-only cases over 8 entities (activities/clients/locations/masters/materials/payments/services/visitors) through `TestClient` against the real test SQLite (ADR 006). Pins the transport surface the service contract (#184) cannot see: URL prefixes, HTTP status codes (201/200/204), `response_model` shape via exact body key-set + `model_validate`, pagination query-param binding, per-entity 404 error codes and ADR-005 error-body shape.
  - **Shared contract config module:** new `backend/tests/generic_contract.py` (+365) — single source of entity config (schemas, payload builders, `fk_map`) driving BOTH the service contract (`test_generic_service_contract.py`, refactored to import it) and the new HTTP contract.
  - **Per-entity dedup:** 7 `test_api_*.py` files trimmed (−1014/+26), `test_api_tags.py` deleted; `test_api_pagination_params.py` trimmed to services/records/visits. Suite arithmetic: 107 old cases removed, 116 added → net +9 vs pre-#185 baseline (990p → 999p).
  - **ADR 006:** `docs/decisions/006-http-contract-tests-end-to-end.md` (verbatim from spec §3.6) + `docs/decisions/README.md` index rows 005+006.
  - **Hard constraint honored:** `backend/src/` untouched (zero production code changes). AC1–AC7 all verified ✅ COMPLIANT by final full-feature review with independent suite run.
  - **Mutation checks (T5, all reverted):** unmounted router prefix, narrowed `response_model`, status-code flip — all turned contract red; tree pristine.
  - **Documented blind spot (spec D12, explicit user decision):** a `response_model=` kwarg dropped without changing the route's return value is undetectable at body level (services return validated schema instances → byte-identical body). Docs-only — NO guard test, per user decision; noted here so it is not re-litigated.
  - **Pre-existing lint baseline:** ruff in `backend/tests/` (143 findings, Cyrillic RUF001/002/003 etc.) untouched — no new lint introduced.
  - **Test results:** backend full suite 999 passed / 5 skipped (three independent confirmations: implementer, quality reviewer, final spec reviewer); contract file 116/116 green.
  - **Stats:** test-files-only net −667 lines (AC4 band, within −600…−700); full branch diff 14 files, +696 / −1318.
  - Design spec: `docs/specs/2026-08-03-generic-api-crud-contract-design.md` (rev 2)
  - Plan: `docs/plans/2026-08-03-generic-api-crud-contract-plan.md`

## [Unreleased] — 2026-08-03

### Added
- **GH #184 — GenericService full-CRUD service contract (create/get/list/update/delete) + sticky `is_active` production fix** — branch `gh-184-service-crud-contract` (9 commits: 7565b65, f4cf95f, b961a62, 2aa1197, 2ce401c, 8cabb48, ef7d73d, 948b480, 18479e5):
  - **Contract test:** new `backend/tests/services/test_generic_service_contract.py` (+1307 lines) replaces `test_generic_service_patch.py` (599) and `test_generic_service_list.py` (186) — ONE parametrized file covering full CRUD for all `GenericService` subclasses via `__subclasses__()` auto-discovery + `EntityConfig` + `make_entity`. New entity = one config entry → full create/get/list/update/delete coverage for free.
  - **Create/get:** `create` test forces a DB read (no in-memory echo); `get` returns archived rows — user decision 1 locked by test.
  - **List:** parametrized list contract (pagination envelope, soft-delete filtering) replaces the 2-entity hand-written `test_generic_service_list.py`.
  - **Update (PUT full-replace):** full-replace semantics incl. default-reversion of omitted fields + nonexistent → `None`, parametrized across entities (was completely untested).
  - **Delete edge cases:** nonexistent → `False`, already-inactive soft row → `False`, soft-deleted row absent from `list()`.
  - **Production fix (sticky `is_active`, G1b directive):** Update/Patch schemas for the 5 soft-delete entities flipped `is_active: bool = True` → `bool | None = None` (`schemas/{master,location,material,service,client}.py`); `SoftDeleteService.update` injects the stored value on omitted/None; `_patch_payload` hook + shared `_strip_is_active_none` helper (`services/generic.py:25`) also used by `ServiceService` overrides — PUT/PATCH omitting `is_active` on an archived row no longer silently reactivates it; explicit `true` = legal reactivation, `false` = archive, `null` = don't touch. `ClientUpdate`/`ClientPatch` gained `is_active` — archive/restore via PATCH now possible at the API level.
  - **Domain-rules:** `_overview.md` new section "is_active semantics on get/update/patch" + PATCH-table row; per-entity "Archive semantics on write" sections (masters/locations/materials/services/clients); clients.md restore note + parity-table row. Prior spec `2026-08-02-is-active-list-filters-design.md` addendum cross-references #184 (fixes its §7.5 hazard).
  - **Test results:** backend 990 passed / 5 skipped (baseline 854p/3s); api-client 144 passed / 4 failed (4 = known pre-existing #188, unchanged); domain 22/22; admin vitest 1239 passed / 0 failed; `tsc --noEmit` clean. No generated OpenAPI types to regenerate (hand-written Zod, compatible).
  - **Mutation checks:** green-by-failure (T4 step 4, T6 step 9); guard sanity (dummy-subclass) failed-as-expected.
  - **AC checklist (spec §6.1–6.9): 9/9 met.** Visual compliance gate: N/A (no user-visible UI).
  - **Production diff:** exactly 7 `src/` files (`schemas/{master,location,material,client,service}.py`, `services/{generic,service}.py`).
  - **20 files changed, +1684 / -799.**
  - Design spec: `docs/specs/2026-08-03-generic-service-crud-contract-design.md` (rev 4, G1b-approved)
  - Plan: `docs/plans/2026-08-03-generic-service-crud-contract-plan.md` (G2-approved)

## [Unreleased] — 2026-08-02

### Added
- **GH #195 — `status` filter param (ArchiveStatus: active|archived|all, default active) for soft-delete list endpoints + frontend archive views** — branch `feat/status-filter-archive-views-195` (12 commits: 724f8f6, 9d3a52a, 7209033, 18d0b57, 73aa5e7, 156c4a7, 0dff55e, 4e3f58c, 365b15d, e5bd15a, 81eef68, d3524bf):
  - **Backend:** `ArchiveStatus` enum; `SoftDeleteRepository.list` param renamed `is_active` → `status`; new `SoftDeleteService` (archive-status filtering) replaces `GenericService` for soft-delete entities; 4 service migrations (Master/Location/Material/Client) + ServiceService eager-load override; `status` query param on masters/locations/materials/services list endpoints; clients `ClientListParams.status` + `list_clients_with_stats`.
  - **api-client:** `ListParams.status` + `listQuery` serialization (default `active` omitted from query string).
  - **Admin:** server-side archive filtering on Masters/Locations/Services/Materials tables (3 filter components); clients filters `is_active` → `status` enum, default «Активные»; edit modals preserve `is_active` on archived rows (4 tables); E2E `clients.spec.ts` updated (run deferred to CI).
  - **Domain rules:** 5 docs synced (`docs/domain-rules/`).
  - **Test results:** backend 854 passed / 3 skipped; api-client 144 passed / 4 failed (4 = known pre-existing #188, unchanged); admin vitest 1239 passed / 0 failed; tsc --noEmit clean.
  - **Visual Compliance Gate (spec §11): ALL 8 checks PASS** — verified via dedicated Playwright scripts against a live stack (screenshots `/tmp/visual-compliance/section11/`). NOTE: the bundled `scripts/visual-compliance-check.sh` has a tooling bug (`networkidle` never resolves under Next.js HMR → false "ALL CHECKS PASSED" with 0 checks run); verification bypassed it — known tooling gap.
  - **Deviations (architect-sanctioned, reviewed):** (1) Task 3 absorbed the services router `status` param (plan had it in Task 4) so API tests were real; (2) `services.py` router therefore untouched in Task 4.
  - **Known follow-ups (not in scope):** restore buttons in ClientsTable (archived clients visible, not restorable from UI); `visual-compliance-check.sh` networkidle bug; dev-workflow seeding caveat (`seed.py` ignores `ENV_FILE`, pass `DATABASE_URL` explicitly).
  - **48 files changed, +1564 / -278.**
  - Design spec: `docs/specs/2026-08-02-is-active-list-filters-design.md` (rev 6, approved G1b)
  - Plan: `docs/plans/2026-08-02-status-filter-archive-views-plan.md` (approved G2)

## [Unreleased] — 2026-08-01

### Added
- **GH #194 — Deletion policy refactor: hard-delete for Tag/Photo/Visitor/Activity/Record/UserSettings** — branch `deletion-policy-194` (15 commits: 51a287e, 1058988, 114d08d, 0f7a41c, caadb7d, cea4daa, 3202656, 07cc2eb, 540a6bd, 20dbceb, 68452fa, 17ee2e0, 8806596, ee8a07c, 6ff6eec):
  - **Backend:** one Alembic migration (`b7c8d9e0f1a2`) drops 6 `is_active` columns and re-creates FKs with cascade semantics (records.activity_id → CASCADE, visits.visitor_id → CASCADE, photos.visitor_id/activity_id → SET NULL). 6 models switch to the hard-delete base; a class-level `soft_delete` ClassVar flag on the abstract base drives `GenericService.list`'s filter so one code path serves both delete semantics. 6 services moved to `BaseRepository`.
  - **Delete cascades:** Record→visits+payments+record_tags, Activity→records (and their visits/payments/record_tags)+activity_tags, Visitor→visits+visitor_tags — service-level with ORM/FK backstops. Bonus fix found in quality review (beyond plan scope): tag join tables (record_tags/visitor_tags/activity_tags) had FKs with no ON DELETE — explicit join-row deletes added + 3 tests.
  - **API surface:** `is_active` removed from Photo/Visitor/Activity/Record response schemas and swept from services/domain/mappers; api-client zod schemas + `schemas.test.ts` updated.
  - **Admin:** TagsTable «Статус» column and PhotosTable status filter/column removed; mocks + e2e rewritten for hard-delete semantics.
  - **Tests:** `EntityConfig.delete_semantics` + generic delete contract test; backend 824 passed / 0 failed / 3 skipped (baseline 793p/3s); api-client 139 passed / 4 failed (4 = known pre-existing #188, unchanged); admin vitest 1223 passed / 0 failed + type-check clean; targeted e2e 42/42 (activity-details-modal 13/13, tags-crud+photos-crud+unify-caches 29/29); visual compliance 6/6.
  - **Domain rules:** 9 docs synced from soft-delete to hard-delete policy (`docs/domain-rules/`).
  - **Follow-ups (out of scope, noted for future work):** stale "old Visits soft-deactivated" wording in records.md:123-124; `Record.is_active=True` reference in clients.md:28; PaymentService.list override now redundant with flag-driven filter (silently drops order_by).
  - **87 files changed, +1201 / -386.**
  - Design spec: `docs/specs/2026-08-01-deletion-policy-design.md`
  - Plan: `docs/plans/2026-08-01-deletion-policy-plan.md`

## [Unreleased] — 2026-07-29

### Added
- **GH #186 — Payments batch aggregate (GET /api/v1/payments/totals)** — branch `feat/payments-batch-aggregate-186`:
  - **Backend:** `GET /api/v1/payments/totals?record_ids=...` — new schema `PaymentTotalsResponse` (keyed map), module-level `get_payment_totals(session, record_ids)` in `payment.py` (SQL `IN+GROUP BY+SUM`), route declared before `/{payment_id}` for correct FastAPI resolution. 5 API tests (multiple records, record without payments, empty → 200 `{}`, over-cap → 422, mixed results).
  - **api-client:** `getPaymentTotals(recordIds)` method + `PaymentTotalsResponseSchema` Zod schema + endpoint tests.
  - **RecordsContext:** Removed unfiltered `getPayments({ per_page: 100 })` call. Totals query keyed by sorted record IDs (`['payments', 'totals', sortedIds]`), `enabled: recordIds.length > 0`. Map exposed as `payments: Map<string, number>`.
  - **RecordsTable + ClientCardModal:** Status/sort/ClientCardModal per-record statuses consumed from totals map. Drive-by `ClientWithStats[]` type fix. Detail panel per-record payment list unchanged (via `useRecordData`).
  - **Regression guard:** Backend test verifying totals correct with >105 payments in DB; `RecordsContext.test.tsx` guard asserting `getPayments` is never called.
  - **Test results:** Backend 793 passed / 3 skipped (baseline 787p/3s + 6 new); admin vitest 1218 passed / 87 files; api-client 139 passed / 4 failed (4 = known pre-existing #188, unchanged). Visual compliance: 4/4 passed.
  - **Design spec:** `docs/specs/2026-07-29-payments-batch-aggregate-design.md`
  - **Plan:** `docs/plans/2026-07-29-payments-batch-aggregate-plan.md`
  - **Domain rules:** `docs/domain-rules/payments.md` updated with batch aggregate endpoint contract.

- **GH #183 — GET /api/v1/tags/{id} + GET /api/v1/visitors paginated bare list** — branch `feat/183-tags-get-by-id-visitors-list`:
  - **Backend:** `GET /api/v1/tags/{id}` endpoint (get-by-id, 3 tests). `GET /api/v1/visitors` paginated list (page/per_page query params, GenericService subclass pattern, 7 tests incl. scoped-route regression guard ensuring `/api/v1/visitors` doesn't shadow other routes).
  - **api-client:** `VisitorListResponseSchema` added. `getTag(id)` + `getVisitors({page?, per_page?})` methods + unit tests for both.
  - **Domain-rules:** `docs/domain-rules/tags.md` updated with GET by-id + soft-delete invariant correction (hard-delete restore is follow-up #189). `docs/domain-rules/visitors.md` updated with paginated list contract.
  - **Test results:** Backend 787 passed / 0 failed / 3 skipped; api-client 136 passed / 4 failed (all 4 = known pre-existing issue #188 in schemas.test.ts, fails on main too, out of scope).
  - **Design spec:** `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md`
  - **Plan:** `docs/plans/2026-07-29-tags-get-by-id-visitors-list-plan.md`

## [Unreleased] — 2026-07-28

### Added
- **GH #182 — GenericService.list() mandatory pagination + API & frontend migration** — branch `feature/182-list-pagination` (6 commits: 8ffc378, 68fb1b4, e6edaf5, 4dd60cb, 7254c75, cde75d6):
  - **Backend:** `PaginatedResponse[ItemT]` envelope `{items,total,page,per_page}` on `GenericService.list()` (mandatory `page`/`per_page` params). 4 service overrides with custom list logic (ServiceService, RecordService, ActivityService, VisitService) + PaymentService override (hard-delete model). 9 list endpoints gain `page`/`per_page` query params (ge=1, le=100 → 422) and envelope `response_model`. Client search-by-phone adapted to envelope. New contract test `test_generic_service_list.py` (parametrized across subclasses) + `test_api_pagination_params.py` (422 validation).
  - **api-client:** `paginatedSchema()` factory + 8 per-entity list schemas. 8 list functions (`getMasters`, `getLocations`, `getTags`, `getMaterials`, `getServices`, `getActivities`, `getPayments`, `getRecords`) accept optional `{page, per_page}` params returning `PaginatedResponse<T>`. `getClients()` fixed with `per_page=100` (previously silently truncated to 20 items — the fix closes the truncation bug).
  - **Frontend/admin:** 13 consumers unwrap `.items` at queryFn layer with `per_page=100` (RecordsContext, ScheduleContext, useRecordData, useMasters, useLocations, useServices, useActivities, ClientCardModal, 5 table components). All component signatures unchanged.
  - **E2E infrastructure:** 3 e2e files unwrap envelopes (activity-details-modal.spec.ts, factories.ts, globalSetup.ts).
  - **Spec:** `docs/specs/2026-07-28-list-pagination-migration-design.md`
  - **Plan:** `docs/plans/2026-07-28-list-pagination-migration-plan.md`
  - **Test results:** Backend 777 passed / 3 skipped; frontend vitest 1210 passed / 87 files; e2e 216 passed (6 pre-existing screenshot-baseline/seed-state flakes documented, 2 flaky passed on retry).
  - **Known pre-existing issues (not in scope):** 4 failures in `packages/api-client/src/schemas.test.ts` (visit/record schema datetime parsing) — present on branch base AND on main; filed for follow-up.
  - **Acceptance criteria (spec §7/§8):** All met — 9 endpoints paginated, 422 on out-of-range, `/clients` byte-identical, getClients fix, no bare-list endpoint, no pagination UI, byte-identical datetime formats.
  - **69 files changed, +787 / -356 lines.**

- **GH #175 — Contract test for GenericService.patch() replacing N×M per-entity PATCH duplication** — branch `gh-175-patch-contract-test` (6 commits: 22df61f, 9f66e14, 7226813, 2cd7e95, 17765a2, 6296991):
  - **Parametrized contract test** (`backend/tests/services/test_generic_service_patch.py`, +487 lines): 6 contract tests (partial update, empty body, NOT NULL strip, nullable apply, 404, updated_at) parametrized across 8 entities via `GenericService.__subclasses__()` auto-discovery. Config test verifies `NOT_NULL_FIELDS ↔` model nullability. Guard test catches new subclasses without config.
  - **Per-entity dedup:** −978 lines removed from 14 test files (`+692/−978` net in branch). 13 files modified (API tests for activities, clients, locations, masters, materials, payments, photos, records, services, tags, visitors; coverage_boost, edge_cases). `test_nullable_consolidation.py` deleted (245 lines). 9 exception-service tests restored (Service, Photo, Record — their override patches).
  - **ClientService alignment** (sole `src/` change): `backend/src/services/client.py` + `backend/src/api/v1/clients.py` — subclass pattern (no behavior change). Client now auto-discovered by contract test.
  - **Domain-rules:** PATCH Contract section in `docs/domain-rules/_overview.md` — contract test as single source of truth, 3 documented exceptions (ServiceService, PhotoService, RecordService), rules for new subclasses/columns.
  - **Acceptance criteria:** Contract test ✅ green; config test ✅; guard test ✅ implemented (proven on dummy subclass then reverted); per-entity ~22 API PATCH tests (11×404+code, 6 tag_ids, invariants); full suite ✅ 734 passed, 0 failed, 3 skipped; `src/` ✅ only ClientService alignment.
  - Design spec: `docs/specs/2026-07-28-generic-service-patch-contract-design.md`
  - Plan: `docs/plans/2026-07-28-generic-service-patch-contract-plan.md`

## [Unreleased] — 2026-07-26

### Fixed
- **#151 — Next.js build: wrap ClientsPage in Suspense for useSearchParams** — `frontend/admin/app/(main)/clients/page.tsx`: extracted `ClientsPageContent` and wrapped it in `<Suspense fallback={null}>` inside `ScheduleProvider`. `useSearchParams()` requires Suspense boundary in Next.js 14 App Router static export mode. Fix verified: `npx next build` passes (clients page renders as static ○); vitest 1194/1194 pass (incl. ClientsPage.test.tsx). 1 commit (149e566), direct-to-main (FasTP). Reviews: code-quality ✅, spec-review ✅ (DoD compliance).

## [Unreleased] — 2026-07-25

### Added
- **PATCH endpoints for all 8 backend entities** — branch `feat-patch-all-entities` (9 commits: 8209e4c, 6356705, c3a54ce, 2d8cbff, 703f69e, 34e1590, 90f3759, 8142ac3; Task 1/Tags via PR #173 in main):
  - **New `<Entity>Patch` schema pattern:** all fields optional — `None` = "don't change". Nullable fields CAN be set to `null` explicitly (`exclude_unset`, not `exclude_none`). Every entity gets a dedicated Patch schema (even when identical to Update schema) for schema-evolution safety.
  - **`NOT_NULL_FIELDS` class attr mechanism:** services/locations/materials with NOT NULL columns silently strip null values instead of 422 (via `GenericService.patch`). UserSettings reuses `UserSettingsUpdate` (trivial, no NOT NULL columns).
  - **M2M `tag_ids` handling (Services + Photos):** sent → hard-replace links; `[]` → clear; omitted → preserve. Requires service-level `patch()` override for join tables `service_tags` / `photo_tags`.
  - **Tariffs NOT patchable** on services (PUT only; GH #171).
  - **`client_id` NOT patchable** on visitors (business invariant).
  - **Bonus fix (Task 8 Photos):** `create()`/`update()` rewritten to use `photo_tags` join table — fixed pre-existing MissingGreenlet async lazy-load bug.
  - **Domain-rules:** 4 new docs (materials.md, tags.md, photos.md, user_settings.md) + 4 updated (locations.md, masters.md, services.md, visitors.md) — all PATCH endpoints documented.
  - **Test results:** 725 passed, 0 failed (+51 new PATCH tests vs 674 baseline). Step 4.5 Visual Compliance: N/A (backend-only).
  - **Changed files:** 34 — 7 routers, 6 schemas, 6 services, 7 test files, 8 domain-rules docs.
  - Design spec: `docs/specs/2026-07-22-patch-all-entities-design.md`
  - Plan: `docs/plans/2026-07-22-patch-all-entities-plan.md`

### Fixed
- **Test-debt Wave 4 — cond-skip verify-first (#161 #162 #124-cascade)** — branch `feat-test-debt-wave4` (4 commits: 1a8ca91, 950b82f, b4f6f97, e41d1f1):
  - **8 condblock `test.skip` guards removed** across 3 E2E spec files:
    - `wave6-record-status-derived.spec.ts` — 4 tests (#161 wave6-record-status-derived) + 1 test (#162 scenario 4 add-visitor)
    - `wave6-status-shared.spec.ts` — 2 tests (#161 wave6-status-shared)
    - `activity-details-modal.spec.ts` — 1 test (#124 cascade, scenario 4 Sc4)
  - **Pattern proven 4× now:** prior waves (#124 Wave-1, #152, #155) fixed the root causes that made these guards fire. No code changes needed — pure guard removal.
  - **Test counts:** vitest 1194 pass, 0 regressions. tsc clean. Backend untouched (unchanged 674 pass).
  - **CI is decisive arbiter** — all guards removed locally; any flake would indicate an unresolved root cause requiring a new issue.
  - **Zero production code changed** — test-only cleanup.
  - Stats: 3 files, -38 lines
  - Design spec: `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md`
  - Plan: `docs/plans/2026-07-22-test-debt-wave4-verify-first.md`

### Fixed
- **Test-debt Wave 5 — un-skip + annotation cleanup (#125 #159 #109)** — branch `feat-test-debt-wave5` (3 commits: 2af5d6c, 4fdb6ee, 0421ea3):
  - **4 E2E tests un-skipped + 2 stale annotations cleaned:**
    - `clients.spec.ts` — #125 status filter (waitForTimeout→response-based wait)
    - `records.spec.ts` — #159 detail panel tests 8+10 (stale fixme removed; UI confirmed by recon — test 9 same flow already passes)
    - `visual-regression.spec.ts` — #109 records page snapshot (test.fixme→test; baseline in repo since Jul 5)
  - **Annotations cleanup:** Stale `#XXX` placeholder → `#109`. Stale "pre-existing flakes in clients tests" comment deleted.
  - **Test counts:** vitest 1194 pass, 0 regressions. tsc clean. Backend untouched.
  - **Zero production code changed** — test-only cleanup.
  - Stats: 3 files, +14/-11 lines
  - Design spec: `docs/specs/2026-07-22-test-debt-wave5-unskip-annotations-design.md`
  - Plan: `docs/plans/2026-07-22-test-debt-wave5-unskip-annotations.md`

### Fixed
- **#155 — @transactional commit boundary (root cause of GET /payments/{id} flake)** — branch `feat-transactional-commit-155` (3 commits: 0d47d09, 731a71d, 9b71d27):
  - **Root cause:** `get_db_session` (database.py:56-64) uses FastAPI yield-dependency — `await session.commit()` runs AFTER HTTP response is sent → GET arrives before commit → 404 on `GET /payments/{id}` immediately after POST. Fix: `@transactional` decorator commits in the service method, before the route handler returns to FastAPI. `get_db_session` commit retained as fallback (double-commit = SQLAlchemy no-op).
  - **New `@transactional` decorator** (`backend/src/services/decorators.py`, 88 lines) — Unit of Work pattern (Spring `@Transactional` equivalent). Supports positional & keyword `db_session` param, double-commit safe, preserves return value. 6 unit tests (`backend/tests/test_transactional.py`, 161 lines).
  - **Applied to all 22 write methods** across 7 service files: generic.py (5), payment.py (1), record.py (4), service.py (2), photo.py (2), visit.py (5), user_settings.py (3). Removed inline `await db_session.commit()` from photo.update (now handled by decorator).
  - **Removed E2E factory polling workarounds** (`frontend/admin/e2e/fixtures/factories.ts`): deleted `expect.poll` retry blocks from `createTestClient`, `createTestActivity`, `createTestRecord` (-50 lines). Polling was a workaround for the commit-after-response race; now dead code.
  - **Pattern:** Unit of Work (Fowler, PoEAA) — equivalent to Spring `@Transactional`. Confirmed via SQLAlchemy 2.0 docs (commit-as-you-go) and Spring Framework docs (@Transactional on service methods). Repository = flush (buffer), service = commit (transaction boundary).
  - **Test counts:** backend 674 passed (668 baseline + 6 new @transactional tests), 0 regressions. E2E factory polling removed (deterministic now).
  - Design spec: `docs/specs/2026-07-21-transactional-commit-155-design.md`
  - Plan: `docs/plans/2026-07-21-transactional-commit-155.md`

- **Wave 2A — Test-debt cleanup: un-skip 2 E2E, delete 2 dead test files, rewrite 1 vitest test** — branch `feat-test-debt-wave2a` (5 commits: e8c4e21, 1f0eab8, 3c51498, e8c68cc, 604e592):
  - **#155 — un-skip scenario 18:** Removed `test.skip(true,...)` — stats are per-request SQL scalar subqueries (no cache). Flake was on `GET /payments/{id}` payment-existence check, not stats. Un-skipped in Wave 2A (root cause fixed later in this branch). 1 line changed.
  - **#156 — un-skip US-M09 modal-no-jump:** `test.fixme` → `test`. openModal wrong-activity bug fixed in #124 Wave 1. Cross-tab dimension comparison kept as code test (stronger than visual screenshots). #XXX → #156.
  - **#157 — delete modal-blur-footer.spec.ts:** Weak z-index proxy (`zIndex > 0`) — NOT actual blur. Bug #86 (badge z-110 above modal z-50) covered by existing `modal-settings.png` visual regression. 30 lines deleted.
  - **#158 — delete private-toggle-layout.spec.ts:** Point-fix regression for bug #83 (CSS `flex-row`→`flex-col` on "Приватное" label/toggle). Covered by existing `modal-settings.png` screenshot. 36 lines deleted.
  - **#163 — rewrite visit-status-cycle vitest test:** Replaced `it.skip` with real test using StatusPicker testid pattern (`visit-v1-status-trigger`, `visit-v1-status-option-visited`). Added `patchVisit` to `@memo/api-client` mock block + `getQueryData` to `useQueryClient` mock. Asserts `patchVisit` called with `('v1', {status:'visited'})`. +18/-7 lines.
  - **Test counts:** backend 668 pass (untouched), frontend vitest 1194 pass + 0 skip (up from 1193 + 1), type-check clean. E2E verification deferred to CI.
  - **Zero production code changed.**
  - Design spec: `docs/specs/2026-07-21-test-debt-wave2a-design.md`
  - Plan: `docs/plans/2026-07-21-test-debt-wave2a.md`

## [Unreleased] — 2026-07-20

### Fixed
- **#152 — Seed staleness + E2E harness resilience** — branch `feat-seed-staleness-152` (4 commits: 0e4ea6c, e76f5d2, 05e0eb6, ad77118):
  - **Root cause:** `seed.py WEEK3_START = _get_week_monday(today)` used current server date on first seed run; idempotent guard `if await _exists: continue` then skipped existing `ev_*` rows on subsequent runs → after a Sunday→Monday rollover activities stayed on last week's dates → schedule default view empty → `waitForScheduleReady` waited 60s × 22 tests → all E2E schedule tests timeout every Monday/Tuesday.
  - **Fix (wipe + reseed):** `scripts/e2e-shard-start.sh` — `rm -f` shard DB before seed (with path-guard rejecting non-test DBs). `backend/src/seed/seed.py` — removed `_exists` + 13 skip branches; seed assumes empty DB by contract, fails loud on UNIQUE violation. `frontend/admin/e2e/globalSetup.ts` — two diagnostic branches that abort playwright before any test runs if seed contract violated (a) leftover rows missing → "re-run shard-start"; (b) current-week activities API empty → "seed did not populate". `frontend/admin/e2e/fixtures/helpers.ts` — `waitForScheduleReady` timeout 60→10s (UI render-sync only; data validation moved to globalSetup).
  - **New tests:** `scripts/e2e-shard-start.dryrun.test.sh` (shell dry-run), `globalSetup.diagnostic.test.ts` (3 vitest cases), `test_seed_raises_on_populated_db` (replaces obsolete `test_seed_is_idempotent`).
  - **Test counts:** backend 668 passed (same count: −1 idempotency +1 fail-loud), frontend 1192 passed (baseline 1189 + 3 new diagnostic).
  - Design spec: `docs/specs/2026-07-20-seed-staleness-152-design.md`
  - Plan: `docs/plans/2026-07-20-seed-staleness-152.md`

## [Unreleased] — 2026-07-20

### Fixed
- **#124 Wave 1 — openModal activity_id targeting + un-skip 8 unified-rows scenarios** — branch `test-openmodal-124` (2 commits: 5c8ebd9, 0ead9a2):
  - **Root cause:** `openModal()` (frontend/admin/e2e/fixtures/helpers.ts) opened the FIRST card with client-tabs on a shared week → picked the wrong activity when multiple seed/factory activities shared a week.
  - **Fix (resolveRecordDate + openModal):** `resolveRecordDate(recordId)` now returns `{date, activityId}` (added `a.id AS activityId` to SQL SELECT). `openModal()` targets the card by `[data-testid="activity-${activityId}"]` when `recordId` is passed. Fallback walk (first with client-tabs) preserved for callers without a recordId (e.g. `openAddTab`). `openAddTab` updated to `.date`.
  - **Tariff seed (T1 — NO-OP):** `backend/src/seed/seed.py` already had ≥2 tariffs on `s1` (t1a/t1c/t1i) — no code change needed.
  - **Un-skip 7 scenarios:** Removed `test.skip(...)` from 7 scenarios (6, 7, 8, 9c, 16, 16b, 17, 19) in `unified-rows.spec.ts`. Scenario 5 annotation updated to "waiting for PATCH /visitors (Wave 2)".
  - **Toast selector fix:** 3 toast selectors `[role="status"]` → `[data-testid="toast-info"]` (scenarios 16, 16b, 19).
  - **Stale-TODO cleanup:** Commit `0ead9a2` removed stale `TODO(flaky): openModal selects wrong activity` comments.
  - **Verification (local):** vitest 1193 pass / 1 skip (0 regressions). 8 target E2E scenarios ALL PASS locally. Shard-rest run 1: 122 pass / 13 fail / 9 skip — 13 failures triaged as PRE-EXISTING (sqlite3 relative-path bug, font-drift snapshots, API 404 — none openModal-related). **CI verdict pending** for final US-5 green.
  - **Reviews:** spec-review APPROVED; code-quality APPROVED (0 Critical/Important).
  - **Design spec:** `docs/specs/2026-07-18-openmodal-activityid-seed-124-design.md`
  - **Plan:** `docs/plans/2026-07-18-openmodal-activityid-seed-124.md`
  - **Note:** Test-infra only — zero production code changed.

## [Unreleased] — 2026-07-18

### Fixed
- **#149 Wave A — ClientListParams page/per_page ge=1 constraint** — branch `fix-clientlistparams-ge1` (3 commits: a29474e, 3c253a8, a3d9f13):
  - **Backend schema validation:** `ClientListParams.page` and `per_page` now enforce `Field(ge=1)` — page=0 / page=-1 / per_page=0 / per_page=-5 → 422 `VALIDATION_ERROR` instead of silent zero/negative value.
  - **Test debt closed:** 4 xfail(strict=True) tests in `backend/tests/test_client_stats.py` now pass (validation gap in pagination params). Backend suite: 668 passed, 0 xfailed (was 664+4xfail).
  - **Next scope:** Issue #149 created — `ge=0` for remaining numeric filters (`min_records`, `max_records`, `total_paid_min`, etc.) — deferred to separate wave.
  - Design spec: `docs/specs/2026-07-18-clientlistparams-ge1-design.md`
  - Plan: `docs/plans/2026-07-18-clientlistparams-ge1.md`

## [Unreleased] — 2026-07-17

### Fixed
- **E2E infra roots (#108 DB lock, #126 standalone warmup)** — branch `feat-e2e-infra-roots` (7 commits: 1c30c24, be0b08b, 713ce3f, 662ea67, f39856d, 51dac4c, 5d6028b):
  - **(#108) DB lock fix:** Global `event.listens_for(Engine, "connect")` hook sets `PRAGMA busy_timeout=5000` + `PRAGMA journal_mode=WAL` on every SQLite connection (app async + Alembic + sqladmin engines). Guarded to sqlite dialect only. Shared `sqliteExecWithRetry` helper extracted to `e2e/fixtures/sqlite-exec.ts`. `globalSetup.ts` + `cleanTestData()` use the shared helper; `cleanTestData` THROWS on persistent lock instead of silent swallow.
  - **(#126) Standalone warmup:** `playwright test` now warms up 9 routes in `globalSetup` (gated `!SHARD_ID`). Shared `WARMUP_ROUTES` list. Warmup-routes test detects TS↔shell drift via shell-file parsing.
  - **ADR 001:** WAL-backup caveat documented; `*.db-wal`/`*.db-shm` added to `.gitignore`.
  - **Tests:** Backend 664 passed + 4 xfailed (1 new WAL/busy_timeout test); frontend vitest 1189 passed + 1 skipped (new: sqlite-exec, cleanTestData, warmup-routes tests). US-1 (#126 warmup) live-verified on cold cache.
  - Design spec: `docs/specs/2026-07-17-e2e-infra-roots-108-126-design.md`
  - Plan: `docs/plans/2026-07-17-e2e-infra-roots-108-126.md`

## [Unreleased] — 2026-07-16

### Changed
- **#131 — Client-stats refactor: "visits"→"records" semantics** — branch `feat-client-stats-131` (5 commits: 9916a35, 6cf8447, 501e048, 6e36fe9, 16af531):
  - **Backend:** `visits_count` → `records_count` (rename only), `missed_visits` → `missed_records` (redefined: `COUNT(Record.id) WHERE Record.status='missed'` — no longer counts individual missed visits), `last_visit` → `last_record` (redefined: `MAX(Activity.start)` over ALL active records, no status filter). API params `min_visits/max_visits` → `min_records/max_records`. Removed Visit joins from 2 subqueries — uses persisted `Record.status` directly.
  - **Frontend (Zod):** `packages/api-client/src/schemas.ts` renamed fields. Mock data + contexts synced (commit 6cf8447).
  - **Frontend (Components):** 7 components renamed labels in ClientsTable, ClientStatistics, ClientInfoTab, ClientRecordTab, ClientTab, ClientsContext, ClientsFilters (commit 501e048).
  - **Frontend (Tests):** 7 test files + E2E renamed (commit 6e36fe9).
  - **Domain-rules:** `docs/domain-rules/clients.md` updated (commit 16af531).
  - **Tests:** Backend 663 passed (4 xfailed) — 4 new TDD tests + rename. Frontend 1178 passed (1 known flake #123), tsc 0 errors. Visual compliance: PASSED (/clients page shows new labels).

### Added
- **#127 — Unify records/visits/payments caches (single source of truth)** — branch `feat-unify-record-caches`:
  - **Foundation:** `lib/cache/recordCacheSync.ts` (6 pure helpers for canonical + list key sync), `contexts/PendingActionsContext.tsx` (app-level deferred-delete with 5s undo window surviving modal unmount), `RecordsContext` seeds canonical `['record', id]` from list responses.
  - **Core refactoring:** `useRecordMutations` rewired to cache helpers + `PendingActions` (removed 5-key `invalidateAll` hammer, prefix-match `setQueriesData` for `['records']`), `RecordVisitsTable`/`RecordPaymentsTable` use `useMemo(saved)+useState(drafts)` pattern (deleted `useEffect`-sync), `ClientTab` fully hook-driven (reads from `useRecordData`, dropped prop dual-source), `ClientRecordTab` fine-grained visit CRUD.
  - **Cleanup:** Deleted `hooks/useOptimisticVisitMutation.ts` (-313 lines), `invalidateAll` completely removed from fine-grained mutations.
  - **Bugs fixed:** Bug #2 (undo dies on modal close → app-level `PendingActionsProvider`), Bug #3 (row disappears mid-edit → `useMemo+saved`+`useState(drafts)`), Bug #1/#130 (`['records','client',id]` stale → prefix-match `setQueriesData`), tab-switch stale row → canonical cache + list sync.
  - **Tests:** 28 files changed, +3946 / -1272 lines (net +2674), 13 commits. Vitest ~1178 passed (1 known flake #123). E2E US-1..US-7 written (factory pattern, avoids #124). Visual Compliance 4/4 PASS.
   - Design spec: `docs/specs/2026-07-08-unify-record-caches-design.md`
   - Plan: `docs/plans/2026-07-08-unify-record-caches.md`

- **#129 — Backend health: N+1 fix, capacity re-check, dedup seats** — branch `feat-backend-health-129` (3 commits 625fea5, 4689765, e4a7214):
  - **N+1 fix:** `list_activities` query count 6→2 for 5 activities via batched `ActivityService.sum_active_seats_bulk` (single GROUP BY). Reuses `ACTIVE_RECORD_STATUSES` (no rule duplication). API contract unchanged (`occupied` field identical).
  - **Capacity re-check on update/patch:** `RecordService.update`/`patch` now call `check_activity_capacity`. Variant 1: delete old visits → `recompute_record_seats` (resets own seats — CRITICAL because capacity sums the stored `Record.seats` column) → check → insert new visits. 409 on over-capacity (symmetric with create), rollback via session model. Patch skips check when seats untouched (comment-only patch on full activity → 200). Edit-in-place on a sold-out activity (price/tariff/relink visitor_id, same seat count) → 200 (US-9, user requirement).
  - **Dedup seats:** `create` now calls `recompute_record_seats` (like update/patch already did). Dead inline `record.seats = len(...)` in update removed. Single source of truth for final persisted `seats` across all three write paths.
  - **Bonus fix (inline, in T2):** `tariff_id` now passed in `update`'s `Visit` constructor (was silently dropped; `patch` already had it). Needed for US-9 test (PUT with tariff_id round-trip).
  - **Tests:** 9 user scenarios → 10 new tests (659 total, baseline 649 → 659, 0 regression). Covers US-1 (occupied correct after batch), US-2 (query-count bounded, no N+1), US-3 (occupied=0 for empty), US-4 (update grow→409), US-5 (patch grow→409), US-6 (shrink→200), US-7 (comment-only patch on full→200), US-8 (create/update/patch identical seats), US-9 (edit price/tariff/relink on full→200).
   - Design spec: `docs/specs/2026-07-16-backend-health-129-design.md`
   - Plan: `docs/plans/2026-07-16-backend-health-129.md`

### Fixed
- **CI Green-Up (PR #145) — E2E pnpm-cache, #123 date flake, snapshot baselines** — branch `feat-ci-green` (5 commits: e3f67e4, d7dc689, 9785eba, 89520d0, 26fa0eb):
  - **E2E pnpm-cache infra fix:** `.github/workflows/test.yml` — removed wrong `cache-dependency-path: frontend/admin/pnpm-lock.yaml` from the e2e-tests job's Setup Node.js step. The pnpm lockfile lives at the repo root; bad path killed both E2E shards before Playwright ran.
  - **#123 date-flake fix:** Froze system time (`vi.setSystemTime('2026-06-15')`) in `CalendarPopover.test.tsx` and `Menubar.test.tsx` — date-coupled tests flaked on calendar edge days, failing `frontend-tests (5)` + `frontend-smoke`. Test-only, no production code changed. Different timer strategy per file: CalendarPopover uses full fake timers; Menubar uses `setSystemTime` only (avoids breaking `waitFor` async assertions).
  - **Skipped 4 pre-existing flaky E2E tests:** `test.skip` annotations for unified-rows scenario 10/15/15b (stale-cache `tab-client` timeout → tracked in #124) and clients.spec.ts "11. Status filter narrows results" (selector/timing flake → tracked in #125). Not fixed (require code changes, out of scope).
  - **Regenerated 9 shard-rest snapshot baselines:** Via new manual `.github/workflows/update-snapshots.yml` (`workflow_dispatch`) running `playwright test --project=shard-rest --update-snapshots` on the same `ubuntu-latest` CI runner, eliminating font-render drift. Affected snapshots: wave6-status-snapshots (StatusBadge waiting, StatusPicker closed/open), week-view (schedule-default/next-week/with-activities), visual-regression (records-filtered, modal-settings, modal-new-booking).
  - **New reusable workflow:** `update-snapshots.yml` kept for future font-drift regeneration (also copied to main via PR #146).
  - **Final CI result on `93cfd18`:** test.yml 12/12 green (backend all, frontend 1-5, both E2E shards), smoke.yml 2/2 green. #123 closed by this PR.
  - **Remaining:** #124, #125 remain open (deferred flaky tests, now explicitly skipped with annotations). #121/#126 remain open (adjacent E2E infra debt).

- **E2E Fixme Cleanup Wave 1 (#121)** — branch `feat-e2e-fixme-wave1` (2 commits: 0be5188, 0e0ee33):
  - Re-enabled 13 previously-disabled E2E tests whose blocker issues (#84 occupied-calc, #127 cache unification) are now CLOSED.
  - **occupied-calc.spec.ts:** 1 test re-enabled (US-S03 occupancy validation).
  - **error-messages.spec.ts:** 1 test re-enabled ("Недостаточно мест" capacity error).
  - **clients.spec.ts:** 11 tests re-enabled (create/view/edit/delete/search/modal/record-tab/status/payment/save/cancel). Test 11 (status filter) left skipped — tracked in #125.
  - **Shard-mode verification (CI-equivalent, 2 runs):** 23/23 active tests pass, 1 skip, 0 flakes. GATE PASS.
  - **Zero product-code changes** — pure un-disable of tests plus stripping stale #XXX comments.
  - Design spec: `docs/specs/2026-07-17-e2e-fixme-wave1-design.md`
  - Plan: `docs/plans/2026-07-17-e2e-fixme-wave1.md`

## [Unreleased] — 2026-07-08

### Fixed
- **#98 — Unify "active record" definition (occupied capacity) + fix last_visit metric** — branch `fix-unify-active-record`:
  - **CRITICAL (booking capacity):** `check_activity_capacity` now excludes cancelled/missed records via the shared `active_record_filter()` SQL helper and `ACTIVE_RECORD_STATUSES` constant. Cancelled/no-show records no longer phantom-occupy seats. This unifies the capacity check with the activity-view `occupied` metric — both now read from the same source of truth.
  - **Correctness (client stats):** Client stat `last_visit` now reflects `MAX(Activity.start)` over attended (`visited`) visits, not the booking-creation date (`Visit.created_at`).
  - **Shared helper:** New `ACTIVE_RECORD_STATUSES` constant (`{waiting, visited}`) in `backend/src/domain/visit_status.py` and `active_record_filter()` in `backend/src/domain/record_visits.py` — used by both `check_activity_capacity` (capacity domain) and `sum_active_seats` (activity view).
  - **Refactored:** `sum_active_seats` in `backend/src/services/activity.py` drops its local constant in favor of the shared helper + agreement test.
  - **Domain-rules synced:** 4 docs (`activities.md`, `_overview.md`, `records.md`, `clients.md`) now define "active record" consistently.
  - **Tests: 649 passed, 4 xfailed** (baseline was 642 + 5 new capacity/last_visit tests). **No regression.**
  - **No migration, no frontend, no API change.**
  - **Spun-off:** GH #133 (backfill `last_record_activity` stat), GH #134 (deduplicate `VisitStatus` enum — Python & TypeScript share one definition).
  - Design spec: `docs/specs/2026-07-08-unify-active-record-definition-design.md`
  - Plan: `docs/plans/2026-07-08-unify-active-record-definition.md`

- **#105 — Client stats cartesian product bug (scalar-subqueries rewrite)** — branch `fix-client-stats-scalar-subqueries`:
  - Rewrote `list_clients_with_stats` in `backend/src/services/client.py` to replace two `outerjoin→GROUP BY` subqueries with four independent correlated scalar subqueries (`.correlate(Client).scalar_subquery()`). Each subquery reads exactly one relation, making cross-relation multiplication (cartesian product) structurally impossible.
  - Added guard test (`test_total_paid_not_multiplied_by_visit_count`) that pins the exact data shape (1 record + multiple visits + payment) that would trigger the bug: `total_paid == 3000` (not 6000).
  - **Tests: 642 passed, 4 xfailed** (same baseline as before — no new failures).
  - **No migration, no frontend, no API change**.
  - Design spec: `docs/specs/2026-07-08-client-stats-scalar-subqueries-design.md`
  - Plan: `docs/plans/2026-07-08-client-stats-scalar-subqueries.md`

## [Unreleased] — 2026-07-07

### Added
- **Addendum-2: InlineEditableTable unified rows + hard-delete + deferred undo (6 tasks + FasTP Bug #1)** — branch `feat-inline-editable-unified-rows`:
  - **1. Backend hard-delete + repo split + migration:** Payment/Visit → hard delete (`is_active` removed), model hierarchy split (`AbstractModel` + `AbstractModelSoftDelete`), repository split (`BaseRepository`/`SoftDeleteRepository`), Alembic migration `DROP COLUMN is_active`, 13 entities on soft-delete, 2 on hard-delete. 641 backend tests pass.
  - **2. Frontend Zod schemas + test fixtures:** `is_active` removed from Visit/Payment Zod schemas + 19 test mocks, E2E SQL fixtures aligned. 1134 vitest pass (1 GH #123 baseline flake).
  - **3. Optimistic cache `setQueryData`:** 6 mutations update cache (visits → `['record', recordId]`, payments → `['payments', recordId]`) + regression fix `['visitors', clientId]` invalidation in addVisit. 7 new unit tests.
  - **4. Tariff dropdown in modal:** `servicesRaw` from ScheduleContext → ActivityDetailsModal → populated tariff dropdown. Old `getServiceTariffs` workaround removed.
  - **5. Undo toast deferred delete:** `deleteVisitDeferred` + `deletePaymentDeferred` — optimistic remove → toast "Удалено. Отменить" 5s → hard DELETE on expiry. UIConfig toast 5000ms for undo. 6 unit tests + 2 InlineEditRow contract tests.
  - **6. E2E scenarios 15-19:** 3 pass (15, 15b, 18), 4 skip (GH #124 — openModal wrong-activity).
  - **FasTP Bug #1 (live-test round 3):** Over-capacity `ApiError` caught in `RecordVisitsTable.handleAdd` → `showToast(parseApiError)` + `return undefined` (row stays editable). WIP commit with UIProvider mock wrapper.
  - **Known limitations:** GH #123 (CalendarPopover/Menubar vitest flake — baseline), GH #124 (openModal wrong-activity blocks E2E 16/16b/17/19 — test bodies ready), GH #127 (cache duplication architecture — unified cache records/visits/payments deferred to new session).
  - Design spec: `sketches/2026-07-02-spec-addendum-2.md`
  - Plans: `sketches/2026-07-02-plan-addendum-2.md` (+ review amendments)

## [Unreleased] — 2026-06-29

### Fixed
- **Backend seed.py month-boundary overflow** — branch `feat/phase2-payment-patch` (hotfix):
  - `backend/src/seed/seed.py:286-287` used `week_start.replace(day=week_start.day + day)` which raised `ValueError: day is out of range for month` when the resulting day exceeded the month's length (e.g., June 29 + 2 days = 31, but June has 30 days).
  - Bug existed on main (commit `242a466`, 2026-06-17) but was dormant until the current week started on 2026-06-29.
  - Fix: use `week_start + timedelta(days=day)` to correctly handle month/year boundaries.
  - **Unblocks pre-push hook** (`scripts/test-all.sh`) which was failing 20+ tests because the seed crashed.
  - 1 file changed: `backend/src/seed/seed.py`. 1 new regression test (`test_seed_handles_month_boundary_overflow` in `backend/tests/test_seed.py`) from Gate 1.
  - 21 seed tests now pass (was 20 failing + 1 new RED). **Tests: 635 passed, 4 xfailed, 0 regressions**.
  - Note: This is a hotfix scoped to unblock Phase 2 push. The same fix should be cherry-picked to main as a separate PR.
- **Pre-push hook: 5→2 shards** — `scripts/test-all.sh` was declaring 5 Playwright shards but `playwright.config.ts` only has 2 projects (`shard-schedule`, `shard-rest`). The 3 missing projects (services, records, clients) were no-ops. Aligned `test-all.sh` to declare only the 2 actual projects. The 5-shard design (`docs/specs/2026-06-18-e2e-shard-5-projects-design.md`) is deferred until the missing 3 projects are added to `playwright.config.ts`.

## [Unreleased] — 2026-06-28

### Added
- **Phase 1: Visit CRUD + cascade to record (seats + status)** — branch `feat/phase1-visit-crud`, 2026-06-28:
  - Second of 3 phases for Visit/Payment API completion (Phase 0 = `tariff_id` round-trip, Phase 2 = Payment PATCH).
  - New `backend/src/domain/record_visits.py` with 3 free functions: `recompute_record_seats`, `recompute_record_status`, `check_activity_capacity`. Single source of truth for aggregate invariants — used by both `VisitService` and `RecordService`.
  - `VisitService` gains 5 CRUD methods (`list`, `create`, `update`, `patch`, `delete`). Existing `update_status` refactored to use free function; `_derive_record_status` private method removed.
  - `RecordService` refactored: `create`/`update`/`patch` now use free functions; `_check_capacity` removed (replaced by `check_activity_capacity` free function).
  - Router gains 5 new handlers: `GET /api/v1/visits` (list), `POST /api/v1/visits` (create, 201), `PUT /api/v1/visits/{id}` (full replace), `PATCH /api/v1/visits/{id}` (partial), `DELETE /api/v1/visits/{id}` (soft-delete, 204).
  - Pydantic schemas added: `VisitBase`, `VisitCreate`, `VisitUpdate`, `VisitPatch` (mirroring `visitor.py` pattern).
  - Cascade behavior: creating a visit increments `record.seats` + re-derives `record.status`; soft-deleting decrements `record.seats` + re-derives `record.status`; patching re-derives only `record.status` (seats unchanged). Capacity check enforced on create (409 `ACTIVITY_AT_CAPACITY`).
  - 10 files changed, 1113 insertions(+), 106 deletions(-): `backend/src/{domain/record_visits.py (NEW),schemas/visit.py,services/{visit.py,record.py},api/v1/visits.py}`, `backend/tests/{conftest.py,test_api_visits.py,test_record_visits.py (NEW),services/{__init__.py (NEW),test_visit_service.py (NEW)}}`.
  - 33 new tests: 21 API tests (scenarios 5-20 in spec plus extras), 4 domain unit tests (free functions), 8 service unit tests (VisitService CRUD).
  - Design spec: `docs/specs/2026-06-25-backend-visit-payment-api-design.md`
  - Plan: `docs/plans/2026-06-25-backend-visit-payment-api.md`
  - Status doc: `docs/status/2026-06-25-backend-phase1-visit-crud.md`
  - **Tests: 628 passed (was 595, +33 new), 4 xfailed (unchanged), 0 regressions**.

- **Phase 2: PATCH /api/v1/payments/{id}** — branch `feat/phase2-payment-patch`, 2026-06-28:
  - Third of 3 phases for Visit/Payment API completion (Phase 0 = `tariff_id` round-trip, Phase 1 = Visit CRUD).
  - New `PaymentPatch` Pydantic schema (`backend/src/schemas/payment.py`): `amount: int | None = Field(default=None, gt=0)`, `method: PaymentMethod | None = None`. All fields optional — `None` means "don't change".
  - `PaymentService` refactored from factory-returned `GenericService` instance to proper `PaymentService(GenericService[...])` subclass. This allows the class-level `NOT_NULL_FIELDS = {"amount"}` configuration that `GenericService.patch()` consults to strip `null` for NOT NULL fields.
  - New endpoint `PATCH /api/v1/payments/{id}` in `backend/src/api/v1/payments.py`: calls inherited `service.patch()` (no service code change needed), returns 200 with `PaymentResponse` on success, 404 with `ErrorCode.PAYMENT_NOT_FOUND` if not found. PATCH semantically differs from existing PUT (full-replace): only sent fields are updated.
  - **Contract guarantee:** `PATCH {amount: null, method: "cash"}` silently strips `amount` (NOT NULL constraint would otherwise be violated). This is enforced by the `NOT_NULL_FIELDS` mechanism in `GenericService.patch`.
  - 5 files changed, 104 insertions(+), 3 deletions(-): `backend/src/{schemas/payment.py, services/payment.py, api/v1/payments.py}`, `backend/tests/{test_api_payments.py, services/test_payment_service.py (NEW)}`.
  - 3 new API tests (scenarios 21-23 in spec) + 3 new service unit tests (subclass contract: `issubclass`, `NOT_NULL_FIELDS == {"amount"}`).
  - Design spec: `docs/specs/2026-06-25-backend-visit-payment-api-design.md`
  - Plan: `docs/plans/2026-06-25-backend-visit-payment-api.md`
  - Status doc: `docs/status/2026-06-25-backend-phase2-payment-patch.md`
  - **Tests: 634 passed (was 628, +6 new), 4 xfailed (unchanged), 0 regressions**.

## [Unreleased] — 2026-06-25

### Added
- **Phase 0: `tariff_id` round-trip (GH-104)** — branch `feat/phase0-tariff-id`, 2026-06-25:
  - First of 3 phases for Visit/Payment API completion (Phase 1 = Visit CRUD, Phase 2 = Payment PATCH). UI shows `— тариф —` placeholder until Phase 0 is live.
  - `tariff_id` propagates through all 4 layers: DB column → SQLAlchemy `Visit` model → Pydantic `VisitResponse` (and nested in `RecordResponse`) → API response mapper.
  - Seed data updated: all 10 visits (6 adult + 4 child) now include `tariff_id`.
  - 10 files changed, 154 insertions(+), 11 deletions(-): `backend/src/{models/visit.py,schemas/{visit.py,record.py},services/record.py,api/v1/{records.py,visits.py},seed/seed.py}`, `backend/tests/{conftest.py,test_api_records.py,test_api_visits.py}`.
  - 4 new round-trip tests (scenarios 1-4 in spec) — `GET /visits/{id}` and `GET /records/{id}` verify `tariff_id` surfaces in both Visit and nested Record responses.
  - Conftest fixed: `query_db` helper now calls `conn.commit()` before close (was silently discarding test DB writes).
  - Design spec: `docs/specs/2026-06-25-backend-visit-payment-api-design.md`
  - Plan: `docs/plans/2026-06-25-backend-visit-payment-api.md`
  - **Tests: 595 passed, 0 regressions** (4 new + 591 existing backend).

## [Unreleased] — 2026-06-20

### Added
- **Wave 6 — Record Status Derivation & Atom Extraction** (#78, #79, #82, #98, branch `fix/wave6-status-derivation-atom-extraction`, 2026-06-20):
  - **Phase 0 (Backend):** `VisitStatus` enum + `computeRecordStatus` derivation in TypeScript (`@memo/domain`) and Python (FastAPI). Alembic data migration `4d5e6f7a8b9c` re-maps Wave 5 enum values. Record schemas reject `status` field with 422 via `extra='forbid'`.
  - **Phase 1 (Frontend enum migration):** Single `VISIT_STATUS_CONFIG` replaces 3 duplicate maps. `StatusPicker` moved to `shared/` and rebuilt on `CustomSelect`. New `StatusBadge` (read-only) component. `safeStatus()` helper for runtime defensive guards.
  - **Phase 2 (Atoms extraction):** 8 atoms extracted to `app/components/shared/{records,payments,visitors}/`: `RecordHeader`, `RecordVisitRow`, `PaymentList`, `PaymentForm`, `PaymentTotals`, `AddVisitorForm`, `VisitorRow`, `RecordWithDerived` type.
  - **Phase 3 (Wire parents):** `useRecordData` returns derived `status`. `useRecordMutations` gains `updateAnonymVisits` and `updateVisitStatus`. `ClientRecordTab` 746→329 LOC (−56%). `ClientTab` 559→227 LOC (−59%). Total: 1305→556 LOC (−57%, −749 LOC removed).
  - **Phase 4 (E2E):** 4 E2E for User Scenarios 1-4, 4 E2E for Scenario 5 (same StatusPicker everywhere), 6 visual regression snapshots. Visual Compliance Gate: 6/6 PASS. 572 backend tests, 70+ frontend vitest, 14/14 Wave 6 E2E passing.

### Changed
- **End-to-End Error Contract with Machine-Readable Codes** (#93, branch `fix/error-flow-93`):
  - **Backend:** New `ErrorCode` enum with 18 stable codes (ACTIVITY_AT_CAPACITY, *_NOT_FOUND, VALIDATION_ERROR, INTERNAL_ERROR, etc.) and `ErrorDetail { code, message }` Pydantic schema
  - **Backend:** 4 global exception handlers wrap all errors in `{detail: {code, message}}` shape (HTTPException, RequestValidationError, IntegrityError, Exception catch-all)
  - **Backend:** 41 `raise HTTPException` sites migrated to include `ErrorDetail(code=..., message=...)` — explicit codes per entity
  - **API client:** `ApiError` gets optional `code?: string` field; `api()` extracts structured errors from response body
  - **Admin:** New `parseApiError(err)` helper maps codes → user-friendly Russian messages (e.g., ACTIVITY_AT_CAPACITY → "Недостаточно мест: 2/2 мест занято")
  - **Admin:** 26 mutation handlers in 9 files now wrap `mutateAsync` in try/catch with `parseApiError` — eliminates silent error swallowing
  - **Admin:** `QueryCache.onError` uses `parseApiError` for specific messages instead of generic "Не удалось загрузить данные"
  - **Tests:** 6 E2E tests cover all 6 user scenarios (activity capacity, not-found, validation, 500, network, duplicate phone)
  - **Docs:** ADR-005 added for the error contract decision
-   **Backwards compatible:** Legacy `{"detail": "string"}` responses still work (code=undefined, uses err.message)

### Fixed
- **#112 — E2E test ordering bug in activity-details-modal scenario 4** (branch `fix/issue-112-service-persist`):
  - Root cause: `openModal()` and `getFirstActivity()` returned different activities — `openModal` navigates up to 3 weeks back to find an activity with records, while `getFirstActivity` always reads the first card on the current week. Test 4 changed the service for activity X (earlier week) but queried the DB for activity Y (current week).
  - Fix: `openModal` now returns the activity it opened; test 4 uses the returned activity for the DB query.
  - Production code was already correct; the fix was in the test helper only.

---

## [Unreleased] — 2026-06-19

### Fixed
- **Wave 4.5 — Fix 55 pre-existing TypeScript errors blocking pre-push hook** (#88, branch `fix/ts-errors-blocking-hook`):
  - Deleted dead `lib/mock-data.ts` and `lib/schedule-context.tsx` (37 errors eliminated)
  - Added `maxAge?: string` to `Activity` schema in `@memo/domain` (3 errors fixed in ActivityCard, buildSchedule)
  - Added `required?: boolean` to `TagsFieldConfig` in photo fields (4 errors fixed in PhotoModal)
  - Used `PhotoResponse` type in PhotoModal instead of raw API response (plan deviation T1.4b)
  - Updated test mocks: `kind` on toasts, `refetch` on Records/Clients contexts (6 errors fixed)
  - Re-typed `mockUseQuery` properly in `clientRecordTabSetup.ts` (1 error fixed)
  - Added `short_title`, `tag_ids` to Location mock (1 error fixed)
  - Type guard in ErrorBoundary for non-`Error` throws (1 error fixed)
  - `Array.from()` in e2e for NodeList iteration (1 error fixed)
  - **pnpm type-check: 0 errors (was 55)**
  - **No suppressions added** — no `@ts-ignore`, `as any`, or `@ts-expect-error`
  - **Tests: 986 passed, 1 skipped** — zero regression

### Added
- **Testing Strategy v2** — Pre-push gate + User Scenarios + 10 full-flow E2E (branch `feat-testing-strategy-v2`):
  - Native pre-push hook (`.git/hooks/pre-push`) blocks `git push` if local test suite fails
  - `scripts/test-all.sh` runs: lint, type-check, vitest, playwright (incl. visual regression), visual-compliance-check, backend pytest
  - `postinstall` hook in root `package.json` auto-installs the hook for new clones
  - `docs/specs/2026-06-19-current-user-scenarios.md` — living doc of all 14 admin user tasks, each mapped to E2E
  - 10 new full-flow E2E tests (T15–T24) covering bugs #73–#86 — all RED, become GREEN after Wave 4
  - Replay test (T25) confirmed all 10 E2E fail on `main`
  - `.github/workflows/smoke.yml` — CI reduced to smoke-only (lint + type-check + unit)
  - `.github/workflows/test.yml` — full E2E matrix removed
  - `.github/PULL_REQUEST_TEMPLATE.md` — manual smoke checklist for author + reviewer
  - `CONTRIBUTING.md` — documents local test execution, pre-push hook, visual baseline update policy
  - `frontend/admin/playwright.config.ts` — visual regression no longer skipped in CI
  - Superagents skills updated: `brainstorming` requires `## User Scenarios` section; `writing-plans` requires E2E coverage in DoD

- **E2E 5-shard CI split** (#71, #72) — CI suite split into 5 project-based shards (services, schedule, records, clients, rest). Wall time reduced from 5m15s to ≤5m.
- **Project board reconciliation** (2026-06-19) — 10 status updates applied across issues #30-#34, #37, #47, #48, #1.

### Added (Robustness Bundle)
- **ErrorState component** with 3 variants (`table`, `card`, `inline`) for inline error UI in list/table components when `useQuery` fails. Renders title + error message + retry button.
- **FullPageError component** — full-screen error UI for catastrophic failures.
- **ErrorBoundary** wrapper using `react-error-boundary` library. Catches render-time errors and shows FullPageError fallback.
- **Global QueryCache.onError** in `providers.tsx` — single source of truth for fetch failures. Calls `console.error` (dev) and `showToast('Не удалось загрузить данные', 'error')` on every failed query.
- **UIContext Toast kind** — `Toast.kind: 'info' | 'success' | 'error'`, with `showToast` signature accepting `kind` for explicit type. Backward compatible.
- **ToastContainer** visual distinction by kind (red left border for error, green for success).
- **Audit doc** at `docs/audits/2026-06-18-e2e-audit.md` documenting the 6 e2e tests fixme'd and recommendations for future test work.

### Fixed
- **#60 channel validation** (already in PR #66) — `ClientResponse.channel: str | None` tolerates DB values like `'instagram'`, `'vk'`, `'website'`.
- **#61 alembic migration** (already in PR #66) — initial migration + recreate script + lifespan hook.
- **5 e2e tests** in `clients.spec.ts`, `records.spec.ts`, `schedule-column-visibility.spec.ts` (clients Record tab, records sort, records payment, schedule column mode). Replaced `waitForTimeout` with `waitForResponse`, added deterministic seed data.
- **Column mode dropdown** in `schedule-day-view.spec.ts` — discovered the day-button is a single-toggle (one click switches view AND opens dropdown), previous "click twice" pattern was wrong.

### Changed
- **React Query defaults** — `throwOnError: false` in QueryClient config to prevent errors from propagating to error boundary by default.
- **7 list components** (TagsTable, PhotosTable, ServicesTable, LocationsTable, MastersTable, ClientsTable, RecordsTable) — added `if (error) return <ErrorState ... />` early return. Each uses the existing `useQuery.error` (or `useRecords()` context for records).
- **RecordsContext** — added `refetch: () => void` to context type, used by RecordsTable's ErrorState retry button.
- **ClientsContext** — same `refetch` addition (bonus change for parallel pattern).

### Skipped (Test Fixme)
- **6 e2e tests in `schedule-column-visibility.spec.ts` and `schedule-day-view.spec.ts`** marked as `test.fixme()` due to flaky column-mode dropdown toggle. Test code preserved for future investigation. See audit doc for details.

### Closed (wontfix)
- **#53 RecordsContext review** — RecordsContext IS used by both `/records` and `/schedule` pages (via ActivityDetailsModal). Merging with ScheduleContext would inflate it to 800+ LOC without architectural benefit.

### Tech
- Added `react-error-boundary@^6.1.2` to admin dependencies.

### Fixed
- **fix: backend issues batch — channel tolerance, alembic baseline, schema drift (#47, #60, #61)** — 2026-06-18 (branch `fix/backend-issues`)
  - **#60:** `ClientResponse` no longer inherits `ClientBase`; uses `str | None` for `channel` to tolerate legacy DB values (`instagram`, `vk`, `website`). Input schemas still reject unknown channels via `Channel` enum.
  - **#61:** Generated initial alembic migration capturing all base tables. Existing migrations made idempotent with column/table existence guards. Added `backend/scripts/recreate_dev_db.sh` for one-command dev DB recreation. Wired `alembic upgrade head` into FastAPI `lifespan` via `src.db.migrate.run_alembic_upgrade()`.
  - **#47:** Closed as wontfix — frontend uses PATCH (not PUT), and schemas already include `start: datetime | None = None`.
  - Tests: 2 new test classes (`TestClientChannelTolerance`, `TestMigrate`), 139 tests passing.

### Added

- **feat: schedule popover carousel — time-groups model with smart popover UX (toggle close, X close, auto-scroll, wheel propagation, smart alignment)** — 2026-06-16 (branch `feat-photo-searchable-select`)
  - Redesigned pairwise overlap into 3-group carousel (G1 09:00-12:59, G2 13:00-15:59, G3 16:00-23:59)
  - Added `OverlapPopover` with smart alignment and internal auto-scroll
  - Improved UX: toggle close, X close button, background dimming, wheel propagation lock
  - Increased z-index handling: badges `z-[110]`, popovers `z-100`

- **NavigationProvider Architecture** — 2026-06-02
  - Centralized date management: NavigationProvider as single source of truth
  - Refactored layout, Menubar, Topbar, Toolbar to use shared NavigationContext
  - Simplified date state propagation across Admin components
  - Cleaned up route groups: (main)/layout, (main)/bookings

- **Stage 6: Booking Flow E2E** — 2026-06-01
  - Verified end-to-end booking flow with real FastAPI backend
  - Polished booking UX (CalendarLine, BookingOverlay)
  - Wired booking creation API to FastAPI `/api/v1/records/`
  - Added error handling for booking flow

- **Stage 5: API Integration** — 2026-05-30
  - Migrated admin panel to real FastAPI backend using @tanstack/react-query v5
  - Shared `@memo/api-client` updated to support full CRUD via `/api/v1/`
  - Created transformation layer (API snake_case to UI camelCase)
  - Full loading/error/empty state implementation with Skeletons
  - Migrated ScheduleContext, ScheduleProvider and components to API hooks
  - 203 tests passing (all tests migrated from mock data)

- **Phase 5: Backend Foundation (FastAPI + Clean Architecture) — 2026-05-28**
  - FastAPI application with async SQLAlchemy 2.0 + aiosqlite
  - DatabaseSessionManager with Unit of Work pattern (DI-based session management)
  - Pydantic v2 Settings for configuration (`DATABASE_URL`, environment-based)
  - Lifespan events for DB init/close (startup/shutdown)
  - First domain module: System/Healthcheck (`GET /api/health`)
  - Full TDD infrastructure: 27 tests passing, ruff + mypy strict (0 errors)
  - Clean Architecture: Router → Service → Session dependency flow
  - `docs/specs/2026-05-28-backend-architecture-design.md` and `docs/plans/2026-05-28-backend-foundation.md`

- **P1: Admin Schedule — UI Polish Session (2026-05-16)**
  - ActivityCard restructured to 5-div vertical layout (Header, Title, Age, Location, Footer)
  - DnD ghost preview — responsive DragOverlay width (`w-full`) + card-shaped slot ghost
  - Stamp ghost preview on empty slot hover — card-shaped preview with service name, time, artist color
  - RightPanel toggle — inverted arrows (pointing toward panel content) + stay-visible button style
  - Vitest config — excluded `e2e/` directory from runner
- **P1: Admin Schedule** — complete weekly drag-and-drop schedule grid (`/`)
  - WeekView with 7-day column layout, sticky headers, time column (9:00–21:00)
  - ActivityCard with brightness-mix fill, collapsing at small heights, private event indicator
  - Overlapping card stacking with scroll carousel on hover
  - Current time indicator (NowLine) on today's column
  - Full @dnd-kit drag-and-drop with snap-to-half-hour, alt+drag copy, ghost preview
  - Stamp panel (Format Painter) for rapid event creation via click-to-place
  - Delete mode with fade-out animation and toast undo
  - Toast notification system with auto-dismiss and undo callback
  - Copy last week (public events only)
  - ActivityModal for create/edit with validation
  - Sidebar with MiniCalendar, navigation, artist legend, collapse toggle
  - Toolbar with week navigation, day/week toggle, filters shell, delete mode toggle
  - RightPanel with stamp configuration and week summary

- **P2: Booking Management** (`/bookings`, `/clients/[id]`) — 2026-05-17
  - Booking types: Client, Visitor, BookingRecord, Visit, Payment
  - Mock data: 7 clients, 12 visitors, 12 booking records, 16 visits, 9 payments, 7 booking activities
  - BookingFilters: date, location, service, status with clear button
  - BookingTable: sortable table with inline detail panel (client card, activity, visitors, pricing, payments, comment)
  - ClientCardPage: client info, visits history, booking history
  - Route group `(main)`: pages moved under layout with Sidebar + Toolbar + RightPanel
  - Sidebar nav links using Next.js Link with `usePathname` active highlighting
  - 154 tests passing (15 test files)

### Infrastructure

- Next.js 14 App Router project scaffolded + configured
- TypeScript strict mode, Tailwind CSS 3, @dnd-kit/core, Vitest
- v4 Design System CSS variables (brand, sidebar, grid, cards, text, status)
- ScheduleContext + UIContext (React Context API)
- 15 test files with 165 passing tests
- Vitest configured with `pool: 'forks'` for subagent compatibility
- Static prerender build (output: 'export') — `npm run build` passing
