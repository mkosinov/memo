# План #581 — волна переименования notify → notification

- **Goal:** привести код подсистемы уведомлений к пользовательскому имени `notification` одним атомарным диффом: пакет, таблицы/индексы/колонка согласия, стримы и ключи Redis, логгеры, env, CI-джоба и контур запуска, код ошибки. Поведение и данные (кроме имён) не меняются. Поведенческая дельта — в спеке `docs/specs/2026-11-09-notification-rename-581-design.md` §7 (Behavioral Delta).
- **Architecture:** механическая волна по реестру спеки §3 (точные литералы); один PR на всю волну — задачи суть упорядоченные коммиты одного branch, CI-гейт на голове PR. Промежуточные задачи держат свои локальные проверки (pytest-подмножества, tsc, линт), сквозная e2e-зелёность гарантируется только на голове. Границы волны — спека §2 (`records.notify` и производные остаются: флаг записи, `test_api_records_notify_flag.py`, `skip_reason="notify_off"`).
- **Tech Stack:** Python/SQLAlchemy/alembic (SQLite batch-миграции), Redis Streams, bash (dev.sh, scripts/e2e-shard-start.sh + dryrun), GitHub Actions, TypeScript (api-client, веб-тесты, Playwright-спеки).

## Task 1: Миграция данных и слой моделей (сценарий 3)

### Classification: standard

### Required Docs

- `docs/specs/2026-11-09-notification-rename-581-design.md` — §3.2 (реестр таблиц/индексов/колонки + строковые потребители), §5 (миграция и миграционный тест, п.1–8)
- `docs/domain-rules/notify.md` — текущие имена таблиц/колонок (файл переименуется в Task 6, здесь источник имён)
- `docs/domain-rules/domain-events.md` — журнал и связь с таблицами попыток

Шаги:

1. Новая alembic-ревизия (родитель `e8a2c4d6b0f3`), стиль `e8a2c4d6b0f3` (batch + SQLite): `op.rename_table` × 4 (`notify_tasks`→`notification_tasks`, `notify_task_attempts`→`notification_task_attempts`, `notify_event_attempts`→`notification_event_attempts`, `notify_templates`→`notification_templates`); batch-переименование `clients.notify_enabled`→`clients.notification_enabled`; drop+create трёх именованных индексов (`uq_notify_tasks_root_channel`, `uq_notify_tasks_event_scenario_root` c partial `sqlite_where`, `uq_notify_templates_event_channel` c expression `COALESCE`) определениями из моделей; полный симметричный downgrade. UPDATE данных не добавляется (`skip_reason="notify_off"` остаётся).
2. `src/notify/models.py` (до переноса пакета — перенос в Task 2): `__tablename__` × 4, имена `Index` × 3, строка FK `notify_tasks.id`→`notification_tasks.id`; ORM-атрибут колонки согласия в `src/models/client.py` (`notify_enabled`→`notification_enabled`) — консумент `client.notify_enabled` в `scenarios.py` правится при переносе пакета (Task 2).
3. Строковые потребители имён таблиц: `src/domain/deletion.py` (`entity="notify_tasks"`→`"notification_tasks"`) + контракт-тесты `tests/domain/test_deletion.py`, `tests/domain/test_deletion_family.py`; `src/services/client.py` (`NOT_NULL_FIELDS`).
4. Сид-канон — потребители имён таблиц: `tests/test_seed_canon.py` (`EXPECTED_TABLES`, raw-SQL вставки) и `scripts/gen_seed_canon.py` (blacklist) на новые имена (перенесено из Task 4 — без этого полный pytest красный уже после Task 1).
5. Миграционный тест: `tests/test_notify_migration.py` → `tests/test_notification_migration.py` + расширения по спеке §5.6–5.8: движки с `PRAGMA foreign_keys=ON`; ассерт `PRAGMA foreign_key_list(notification_task_attempts)` → `notification_tasks`; на родителе вставляются не-сидовые строки (клиент со СТАРЫМ именем колонки `notify_enabled=false` — на родителе колонка ещё старая, задача + попытка); после upgrade — строки на месте, согласие `false` осталось `false`, старые имена отсутствуют (`sqlite_master` absence-ассерты); downgrade до явного id родителя — зеркально (согласие `false` пережило roundtrip); no-drift ORM сохраняется.
6. `tests/domain_events/test_migration.py` — старые имена в INSERT/ассертах на новые.

DoD: E2E test for scenario 3 passes (RED-GREEN-REFACTOR) — расширенный миграционный тест зелёный; `pytest tests/test_notification_migration.py tests/domain_events/test_migration.py tests/domain/` зелёные.

## Task 2: Пакет, классы, конфиг, логгеры

### Classification: large

### Required Docs

- `docs/specs/2026-11-09-notification-rename-581-design.md` — §3.1 (пакет/классы/импорты/coverage), §3.4 (env + валидаторы + fail-fast + settings-тесты), §3.3 (лог-неймспейс), §3.7 (правило имён тест-файлов)
- `docs/domain-rules/notify.md` — контекст подсистемы

Шаги:

1. Перенос пакета: `git mv backend/src/notify backend/src/notification`; все классы/символы `Notify*`→`Notification*` (`NotifyTask`, `NotifyTaskAttempt`, `NotifyEventAttempt`, `NotifyTemplate`, `NotifyQueue`, исключения).
2. Внешние импорты: `src/models/__init__.py`, `alembic/env.py`; комментарии-указатели цикла импортов переформулировать. Тесты вне маски: `tests/domain_events/test_relay.py`, `test_wipe_recovery.py`, `test_subscribe.py`, `tests/test_streams_transport.py`.
3. `src/core/config.py`: 5 env-имён (`NOTIFY_*`→`NOTIFICATION_*`), тела валидаторов (`_force_notify_off_in_testing`→`_force_notification_off_in_testing`, `_require_redis_url_in_production`), fail-fast строки («notify: transport not configured», «NOTIFY_ENABLED=true (…)»); `backend/.env.example` — env-имена (`NOTIFY_ENABLED` и остальные); `tests/test_settings_redis_url.py` — конструкторы, литералы и имена тестов (`test_gate_applies_only_when_notify_enabled`).
4. Лог-неймспейс: логгеры `memo.notify.*`→`memo.notification.*` (dispatcher, worker, redis_queue, channels/limits, channels/telegram, channels/registry); префикс процесса `notify dispatcher`→`notification dispatcher`; префикс ошибки `notify: transport unavailable`→`notification: transport unavailable`; литералы в тестах пакета (`test_notify_dispatcher`, `test_notify_worker`, `test_notify_channels`, `test_notify_delivery`, `test_notify_redis_gates`, `notify_redis_support`).
5. Тест-файлы маски: 27 `test_*.py` + `notify_redis_support.py` = 28 переименований → `notification_*`; `tests/usecases/test_records_create_notify_event.py` → `test_records_create_notification_event.py`; `tests/test_api_records_notify_flag.py` имя СОХРАНЯЕТ (обновить только импорты/литералы подсистемы внутри).
6. `tests/domain_events/test_boundaries.py` — условный шаг по #589 (упразднение мета-стража, спека §3.7): #589 открыт — обновить константы стража (`NOTIFY="src.notify"`→`"src.notification"`, `SEAL_PACKAGES`, ветка фильтра) вместе с переносом пакета; #589 закрыт — убедиться, что файл удалён той задачей, пункт снимается.
7. Coverage-omit в `backend/pyproject.toml`; комментарии `pyproject.toml`; докстринги `src/streams/*`, `src/domain_events/*` (текст, не провенанс).

DoD: полный backend pytest зелёный (`uv run pytest`); `uv run ruff check` + lint_budget зелёные.

## Task 3: Транспортные литералы Redis

### Classification: small

### Required Docs

- `docs/specs/2026-11-09-notification-rename-581-design.md` — §3.3 (реестр стримов/ключей), §4 (переключение одним деплоем)

Шаги:

1. `src/notification/redis_queue.py`: константы `notify:tasks|statuses|inbound` → `notification:*`; префикс ошибки (если остался после Task 2).
2. `src/notification/channels/limits.py`: обе пары cap-ключей (`notify:{channel}:cap:{yyyymmdd}`, `notify:{channel}:cap-notified:{yyyymmdd}`) → `notification:*`; `channels/mock.py`/`mock2.py`: ключи доставок.
3. Литералы ключей в тестах (redis-marked + support).

DoD: `uv run pytest -m redis` зелёный (бекенд-половина сценария 5); групп `dispatcher`/`worker` не трогаем (имя подсистемы не несут).

## Task 4: Контур запуска и CI (сценарии 1, 2, e2e-половина 5)

### Classification: standard

### Required Docs

- `docs/specs/2026-11-09-notification-rename-581-design.md` — §3.6 (CI/скрипты/процессы/guard), §3.7 (e2e-спеки), §6 US-1/US-2
- `docs/tests_workflow.md` — структура джоб CI

Шаги:

1. `dev.sh`: флаг `--notify`→`--notification`, `NOTIFY_MODE`→`NOTIFICATION_MODE`, экспорты `NOTIFY_ENABLED`/`NOTIFY_CHANNEL_PRIORITY`→`NOTIFICATION_*`, спавны `python -m src.notification.dispatcher|worker`.
2. `scripts/e2e-shard-start.sh`: 4 `NOTIFY_E2E_*`, `SHARD_ID=notify`→`notification` (парность-инвариант сохранить), спавны dispatcher/worker, `TEST_DB_PATH=test_memo_notification_e2e.db`.
3. `scripts/e2e-shard-start.dryrun.test.sh`: literal-ассерты argv/env/журнальных строк.
4. `.github/workflows/test.yml`: джоба `notify-tests`→`notification-tests`; `NOTIFY_TESTS_E2E_ENABLED`→`NOTIFICATION_TESTS_E2E_ENABLED` (5 точек); `SHARD_ID`; `TEST_DB_PATH` ×4; артефакт `e2e-report-notify`→`e2e-report-notification`; пути e2e-спек; **укрепление Spec-file guard**: шаг дополнительно грепит актуальный литерал гейта (`NOTIFICATION_E2E_ENABLED`) в спеке — иначе красный (защита от зелёно-пустого скипа).
5. E2e: `notify-s1-enabled-stack.spec.ts`→`notification-s1-enabled-stack.spec.ts`, `notify-s6-mock-delivery.spec.ts`→`notification-s6-mock-delivery.spec.ts`; внутри — env-гейт скипа, SQL `notification_tasks`, cap-ключи `notification:mock:cap:*`; `globalSetup.ts` BLACKLIST, `fixtures/seed-reset.ts` — новые имена таблиц. Сид-канон уже перенесён в Task 1 (шаг 4).

DoD: E2E test for scenario 1 passes (RED-GREEN-REFACTOR) — `notification-s1-enabled-stack` зелёный локально на новом контуре; scenario 2 — CI-джоба `notification-tests` зелёная и непустая (guard срабатывает на отсутствие гейт-литерала); scenario 5 e2e-половина — `notification-s6-mock-delivery` зелёный.

## Task 5: Код ошибки и веб-контракт (сценарий 4)

### Classification: small

### Required Docs

- `docs/specs/2026-11-09-notification-rename-581-design.md` — §3.5 (реестр кода ошибки)

Шаги:

1. `src/errors.py`: `NOTIFY_TRANSPORT_UNAVAILABLE`→`NOTIFICATION_TRANSPORT_UNAVAILABLE`; `src/auth/otp_transport.py`, `src/auth/router.py`.
2. Тесты: `tests/test_errors.py` (полнота enum), `tests/test_auth_otp_api.py` (2 ассерта).
3. Веб: `frontend/web/app/hooks/__tests__/useOtpLogin.test.tsx`, `app/ui/__tests__/BookingOverlay.test.tsx`; комментарий `packages/api-client/src/endpoints.ts`; упоминание в `backend/.env.example`.

DoD: E2E test for scenario 4 passes (RED-GREEN-REFACTOR) — веб-тесты + `tests/test_auth_otp_api.py` зелёные; `pnpm -C packages/api-client test` и веб-юниты зелёные.

## Task 6: Документация, CHANGELOG, выходной греп-контроль

### Classification: small

### Required Docs

- `docs/specs/2026-11-09-notification-rename-581-design.md` — §3.8 (живые доки), §2.3 (исторический канон), §10 (греп-страх, зоны и allowlist)

Шаги:

1. `docs/domain-rules/notify.md` → `docs/domain-rules/notification.md`: идентификаторы таблиц, `clients.notify_enabled`; `notify_off` остаётся (§2.1); упоминания в `domain-events.md` (зеркало env), `auth.md` (код ошибки), `_overview.md`, `records.md` (только идентификаторы подсистемы), `tests_workflow.md`; ссылки домен-правил друг на друга.
2. Живые планировочные: `PLAN.md`, `docs/release/v1-2026-12-01.md`.
3. Комментарии живых файлов по списку §3.8 (`generate_telegram_session.py`, `seed-data/README.md`, `src/streams/__init__.py`, `src/services/decorators.py`, `src/usecases/records.py`, `src/util/process.py`, `src/util/utc.py`, `frontend/web/e2e/lib/*`, `frontend/web/scripts/test-e2e.sh`); докстринги-провенанс НЕ трогать.
4. `CHANGELOG.md` — новая запись о волне (старые записи не правятся).
5. Выходной механический греп §10 по зонам (`backend/src`, `backend/tests`, `backend/alembic/env.py`, `backend/pyproject.toml`, `backend/scripts`, `backend/seed-data`, `scripts/`, `dev.sh`, `.github/`, `frontend/`, `packages/api-client`, `docs/domain-rules`, `tests_workflow.md`, `PLAN.md`, `docs/release`) — допустимый остаток только allowlist §10 (флаг записи и производные; английское notify в чужом смысле incl. `LISTEN/NOTIFY`; исторический канон `docs/specs|plans|status|decisions`, `CHANGELOG.md`, `backend/alembic/versions`, провенанс-докстринги). Всё вне allowlist — чинится до мержа.
6. Визуальная секция спеки — N/A: UI не меняется, визуальный гейт не требуется.

DoD: греп-остаток совпадает с allowlist §10 построчно; полный CI головы PR зелёный (все джобы, включая `notification-tests`); PR готов к мержу по гейту (зелёный CI → squash-мерж).
