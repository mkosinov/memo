# GH #319 — Гарантированные дочерние записи UserSettings (инвариант «на покое») + get-or-create

- **Date**: 2026-09-26
- **Branch**: `319-user-settings-guarantee`
- **Status**: Completed (PR pending — architect handles finishing)
- **Base**: `6207a8ab` (main) — 8 commits (`ba5763b9..2b99ee7d`, incl. 1 merge), 89 files, +3006 / −509
- **Issue**: #319 — гарантированные дочерние записи при создании (UserSettings) + get-or-create как страховка
- **Spec**: `docs/specs/2026-09-20-user-settings-guarantee-319-design.md` (rev2, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-user-settings-guarantee-319-plan.md` (T0–T6, on main, unchanged by IMPL)

## Goal

Доменное правило `User → UserSettings`: строка настроек существует **всегда** («на
покое»). Каждый продуктовый путь создания учётки (CLI, «учётка» карточки сотрудника,
сид) создаёт настройки в той же транзакции; отсутствие строки лечится на чтении —
`GET` выполняет get-or-create (дефолты + запись в базу) вместо 404. Побочные дыры
закрыты по дороге: `POST` больше не принимает `user_id` из тела (только из сессии),
`DELETE` трактуется как сброс к дефолтам, удаление карточки сносит настройки вместе с
учёткой (каскад смерти), фронтовой POST-фолбэк и мёртвые клиентские методы убраны.
Инвариант закреплён в каноне: `docs/domain-rules/user_settings.md` (Invariants).

## Summary of Changes (per task)

- **T0 — гейт зависимости (trivial)** — без коммита: #171 (слой сценариев) верифицирован
  как смерженный до старта (`d652f84`, PR #340).
- **T1 — ядро сервиса: get-or-create + POST из сессии (standard, `ba5763b9`)** —
  `backend/src/services/user_settings.py`: get-or-create (атомарный SQLite
  `INSERT ... ON CONFLICT(user_id) DO NOTHING` + SELECT, ручной коммит вне
  `@transactional`, ответ с `Cache-Control: no-store`); `POST` берёт `user_id`
  из сессии, клиентское поле игнорируется (схема: поле осталось совместимым с
  контрактом, но игнорируется). Ревью: two-stage ✅.
- **T2 — сценарий `create_user` + перевод путей создания (standard, `61c91dd5`)** —
  новый `backend/src/usecases/user.py` (сценарий создания учётки, ~91 строка) и
  `services/user.py`: дефолты настроек создаются на всех путях — учётка карточки
  сотрудника (`services/staff.py` через usecase), CLI (`cli.py` упрощён — вся логика
  в сценарии). Страж-инвариант: тесты на каждый продуктовый путь. Ревью: two-stage ✅.
- **T3 — каскад смерти (small, `64e926d1`)** — `domain/deletion.py` +
  `services/user_settings.py`: удаление карточки с учёткой сносит строку настроек
  вместе с учёткой — сирот не остаётся; API-тесты удаления. Ревью: compliance ✅.
- **T4 — сид и фабрика (small, `8e9b7dc5`)** — `seed/seed.py`: оба пользователя сида со
  строками настроек; `tests/conftest.py`: фабрика `User` по умолчанию создаёт строку
  настроек (переиспользуется сервисом, не через страж); тесты фабрики/сида/сессии.
  Ревью: compliance ✅.
- **T5 — фронт: убрать фолбэк и мёртвые методы (small, `4604f70a`)** —
  `contexts/UserSettingsContext.tsx`: автосоздание POST-ом убрано — чтение самолечится;
  `packages/api-client/src/endpoints.ts`: `createUserSettings`/`deleteUserSettings`
  удалены (мёртвый код; серверные эндпоинты не тронуты), тесты клиента и контекста
  обновлены. Ревью: two-stage ✅.
- **T6 — гонка C4 + e2e (standard, `90092be5`)** — pytest C4: файловая SQLite, две
  реальные сессии с собственными соединениями, одновременные чтения без строки → оба
  200, одна строка, ни одной 422 уникальности наружу; e2e
  `user-settings-guarantee.spec.ts` (новый, 268 строк): С1 (создание с учёткой → строка
  в БД → первый вход → смена темы → перезагрузка), С3 (смена темы → DELETE → GET →
  дефолты), С5 (удаление карточки → нет учётки и настроек). Ревью: two-stage ✅.
- **Merge — `1d59dc7c`** — origin/main (`20b710f7`, линт-ratchet 38→0 из #301) влит.
- **Fix — `2b99ee7d`** — пост-мерж регрессия (см. ниже).

## Post-merge regression: silent GET on the invalidation bus

После влития main (`1d59dc7c`) e2e упали в 3 спеках: get-or-create при чтении публиковал
событие инвалидации `user_settings` в шину (эмиссия шла через пост-коммит-паблиш),
и чужие кэши ретали. Фикс (`2b99ee7d`): get-or-create **тихий** на шине — события нет ни
на пути создания, ни на чистом чтении; строка персональная, чужих кэшей у неё нет
(спека §5.1); коммит выполняется вручную, не через декоратор `@transactional` (он —
единственная точка пост-коммит-паблиша). Контракт закреплён в каноне
(`docs/domain-rules/user_settings.md`, Backend: «The get-or-create is SILENT on the
invalidation bus») + 93 строки тестов в `test_user_settings_service.py`.

## Test Results (final, на `1d59dc7c` + `2b99ee7d`)

- **Backend pytest:** **2469 passed / 15 skipped / 0 failed**.
- **Frontend vitest:** **2464 passed / 0 failed**.
- **Type-check + lint (`--max-warnings 0`):** чисто.
- **E2E shard-rest:** **348 passed / 0 failed**.
- **E2E shard-schedule:** **122 passed / 1 load-flake** (`schedule-day-view.spec.ts:270`;
  доказанный флейк — изолированный повтор 15/15 зелёный; к #319 отношения не имеет).
- **Новые тесты:** гонка C4 (`test_user_settings_race.py`, файловая SQLite, 2 сессии,
  одна строка), e2e `user-settings-guarantee.spec.ts` (С1/С3/С5), ~93 строки
  сервис-тестов silent-bus контракта (фикс).

## Acceptance Criteria (spec §11 / §7 scenarios)

| Критерий | Статус |
|---|---|
| Инвариант «на покое» — страж на каждом продуктовом пути создания (CLI / учётка / сид) | ✅ T2: тесты каждого пути; фабрика — тестами фабрики (T4) |
| С1 — создание с гарантией (строка до первого входа) | ✅ e2e `user-settings-guarantee.spec.ts` С1 |
| С2 — самолечение (GET возвращает 200 + дефолты + строку в БД) | ✅ pytest (T1: удаление строки → GET → 200 + строка в БД) |
| С3 — DELETE = сброс к дефолтам, пересоздание на чтении | ✅ e2e С3 |
| С4 — гонка вкладок: два одновременных GET, оба 200, одна строка, 422 наружу нет | ✅ pytest C4 (файловая SQLite, 2 сессии) |
| С5 — каскад смерти (нет учётки, нет настроек) | ✅ pytest (T3) + e2e С5 |
| С6 — защитный контракт #179: PATCH/PUT без строки → 404 `SETTINGS_NOT_FOUND`, в т.ч. сразу после DELETE | ✅ контракт #179 без изменений (pytest) |
| POST `user_id` из сессии, клиентское поле игнорируется | ✅ T1 |
| Фронт без POST-фолбэка; мёртвые методы клиента удалены | ✅ T5 (vitest: контекст не вызывает POST) |
| Silent-bus контракт get-or-create | ✅ фикс `2b99ee7d` + канон `docs/domain-rules/user_settings.md` |
| Behavioral Delta (спека §8, 10 пунктов) | ✅ все 10 поставлены |

## Review Trail

- T0: trivial (гейт зависимости, без кода) — ревью не требовалось.
- T1, T2, T5, T6: two-stage (compliance + quality) — все ✅.
- T3, T4: compliance — ✅.
- Merge `1d59dc7c` и fix `2b99ee7d`: fix проверен сервис-тестами + e2e после фикса.

## Key Files Changed

- `backend/src/services/user_settings.py` — get-or-create (no-store, silent bus), дефолты, каскад.
- `backend/src/usecases/user.py` — новый сценарий `create_user` (настройки в той же транзакции).
- `backend/src/services/user.py`, `services/staff.py`, `cli.py` — все пути создания переведены на сценарий.
- `backend/src/domain/deletion.py` — каскад смерти настроек.
- `backend/src/api/v1/user_settings.py`, `schemas/user_settings.py` — POST из сессии.
- `backend/src/seed/seed.py`, `backend/tests/conftest.py` — сид и фабрика создают строки.
- `frontend/admin/contexts/UserSettingsContext.tsx` — POST-фолбэк убран.
- `packages/api-client/src/endpoints.ts` — `createUserSettings`/`deleteUserSettings` удалены.
- Тесты: `test_user_settings_race.py` (новый), `usecases/test_user_create.py` (новый),
  `services/test_user_settings_service.py`, `test_api_user_settings.py`,
  `test_user_settings_auth.py`, `test_seed_staff.py`, `test_session_fixtures.py` и др. (~12 файлов);
  e2e `user-settings-guarantee.spec.ts` (новый), `UserSettingsContext.test.tsx`, тесты api-client.
- Канон: `docs/domain-rules/user_settings.md` — at-rest invariant + silent-bus контракт (в код-коммитах).
- Полный список: `git diff --name-only 6207a8ab..HEAD`.

## Docs Impact

- Спека и план живут на main и веткой не менялись (план `## Статус` закрывается отдельным
  docs-коммитом оркестрации).
- `docs/domain-rules/user_settings.md` — обновлён код-коммитами T1/T3/фикса (здесь не дублируется).
- Этот файл — единственный новый артефакт docs-коммита.

## Deviations from the plan

- Пост-мерж регрессия (эмиссия события инвалидации при get-or-create на чтении) не была
  предусмотрена планом — вскрылась после влития main, закрыта фиксом `2b99ee7d` с закреплением
  контракта в каноне.
- Прочих отклонений нет: все 7 задач плана выполнены как задумано; блокирующих follow-up'ов
  не обнаружено.

## References

- **GitHub Issue**: #319
- **Design Spec**: `docs/specs/2026-09-20-user-settings-guarantee-319-design.md` (rev2, on main)
- **Plan**: `docs/plans/2026-09-20-user-settings-guarantee-319-plan.md` (on main, T0–T6)
- **Canon**: `docs/domain-rules/user_settings.md` (Invariants + silent-bus контракт)
- **PR**: _(to be added after PR creation)_
