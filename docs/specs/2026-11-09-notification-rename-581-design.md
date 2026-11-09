# #581 — Волна переименования notify → notification

- **Статус:** рев.2 (Gate B; панель 7 ревьюеров внесена — хостовый прогон 2026-11-09)
- **Дата:** 2026-11-09
- **Решение о имени:** пользовательское имя подсистемы — `notification` (решение владельца 2026-11-08)
- **Окно:** строго после выноски доменных событий (#580, смержена) и строго до IMPL раздела админки (#486 — его спека переписывается под новое имя до реализации)

## 1. Контекст и цель

Код подсистемы уведомлений целиком называет её `notify`: пакет `backend/src/notify`, таблицы `notify_*`, стримы Redis `notify:*`, env `NOTIFY_*`, джоба CI `notify-tests`, процессы `python -m src.notify.*`. Пользовательское имя с 2026-11-08 — `notification`. Волна приводит код к пользовательскому имени за один согласованный дифф.

**Принцип волны:** переименовывается всё, что *называет подсистему*. Семантика, поведение, данные — без изменений.

Волна — имена только. Она не смешивается с #580 (выноска доменных событий уже смержена отдельным диффом) и не тянет за собой фичи.

## 2. Границы (что волна сознательно НЕ делает)

1. **Поле `records.notify` остаётся.** Это глагольный флаг действия у записи («уведомить клиента»), а не имя подсистемы: колонка БД `records.notify`, поле `RecordCreate.notify` в api-client, состояние `notify` в админ-форме создания записи, тесты `notify flag chain`. Вместе с флагом остаются производные от него имена: тест-файл `tests/test_api_records_notify_flag.py` (имя файла называет флаг — сохраняется, обновляются только импорты/литералы подсистемы внутри) и **значение skip-причины `notify_off`** — `SkipReason = Literal["notify_off", …]` в `scenarios.py`, записываемое в `notification_tasks.skip_reason`: значение описывает состояние флага записи («у записи выключен флаг»), не имя подсистемы, и переименование потребовало бы UPDATE данных без выигрыша в имени. Упоминание `notify_off` в домен-правилах тоже НЕ переименовывается (решение Gate A — вариант Б, владелец 2026-11-09; уточнено панелью).
2. **Английское слово «notify» в чужом смысле не трогаем:** `notifyManager` (TanStack Query, 10 e2e-спек), комментарии «Notify parent…», `notifyValidity`, `notifyOnExit` (харнес), ключевое слово PostgreSQL `LISTEN/NOTIFY` (`docs/ARCHITECTURE.md` — потому НЕ входит в список переименуемых доков).
3. **Исторический канон не переписывается:** закоммиченные спеки/планы/статусы/ADR (`docs/specs`, `docs/plans`, `docs/status`, `docs/decisions`), записи `CHANGELOG.md`, тела старых alembic-ревизий (`backend/alembic/versions/*` — неизменяемая история; волна добавляет одну новую ревизию) и докстринги-провенанс (ссылки на исторические спеки/PR в тестах и модулях, например «part 3 #484 spec §3.1»). Волна добавляет новую запись в CHANGELOG, но не правит старые.
4. **Семантика не меняется:** никаких правок поведения диспетчера/воркера/каналов/лимитов — только идентификаторы и строки имён.

## 3. Реестр переименований (точные литералы)

### 3.1 Пакет, классы, импорты

- `backend/src/notify` → `backend/src/notification` (17 файлов, 4147 строк; состав после #580: dispatcher, worker, queue, redis_queue, models, scenarios, assembly, render, time, channels/* ).
- Классы подсистемы: `NotifyTask` → `NotificationTask`, `NotifyTaskAttempt` → `NotificationTaskAttempt`, `NotifyEventAttempt` → `NotificationEventAttempt`, `NotifyTemplate` → `NotificationTemplate`, прочие символы `Notify*` → `Notification*` (`NotifyQueue`, исключения и т.п.).
- Внешние импорты прод-кода (2 кодовых): `backend/src/models/__init__.py` (регистрация моделей) и `backend/alembic/env.py`. Комментарии-указатели о порядке импортов (разрыв цикла models↔notify) переформулируются под новое имя.
- Внешние импорты тестов вне маски `*notify*` (без правки — падение сборки на коллекции): `tests/domain_events/test_relay.py`, `tests/domain_events/test_wipe_recovery.py` (`from src.notify.models import NotifyTask`), `tests/domain_events/test_subscribe.py`, `tests/test_streams_transport.py` (`from tests.notify_redis_support import …`).
- Внутренние упоминания в `src/streams/*` и `src/domain_events/*` — комментарии/докстринги, обновляются текстом.
- Coverage-omit в `backend/pyproject.toml` (`src/notify/redis_queue.py`) → новый путь.

### 3.2 Таблицы, индексы, колонки

| Было | Стало |
|---|---|
| `notify_tasks` | `notification_tasks` |
| `notify_task_attempts` | `notification_task_attempts` |
| `notify_event_attempts` | `notification_event_attempts` |
| `notify_templates` | `notification_templates` |
| `clients.notify_enabled` | `clients.notification_enabled` |
| `uq_notify_tasks_root_channel` | `uq_notification_tasks_root_channel` |
| `uq_notify_tasks_event_scenario_root` | `uq_notification_tasks_event_scenario_root` |
| `uq_notify_templates_event_channel` | `uq_notification_templates_event_channel` |

Колонка `records.notify` и значение `skip_reason="notify_off"` — НЕ переименовываются (§2.1). ORM-модели (`src/notification/models.py`) переименовываются синхронно: `__tablename__`, именованные `Index`, строка FK `notify_tasks.id` → `notification_tasks.id`.

**Строковые потребители имён таблиц вне пакета:**
- `backend/src/domain/deletion.py:346` — `FKDependency(entity="notify_tasks", …)` в графе зависимостей удаления клиентов → `notification_tasks`; контракт-тесты `tests/domain/test_deletion.py` и `tests/domain/test_deletion_family.py` ассертят тот же ключ и обновляются вместе. Пропуск молча рвёт зависимость «оповещения → nullify» при жёстком удалении клиента.
- `backend/src/services/client.py:109` — страж strip-null `NOT_NULL_FIELDS = {"notify_enabled"}` → `notification_enabled` (второй рубеж записи NOT NULL-колонки согласия; сегодня дормантен, но спека #486 ребейзится именно на него).

### 3.3 Стримы и ключи Redis

| Было | Стало |
|---|---|
| `notify:tasks` | `notification:tasks` |
| `notify:statuses` | `notification:statuses` |
| `notify:inbound` | `notification:inbound` |
| `notify:{channel}:cap:{yyyymmdd}` | `notification:{channel}:cap:{yyyymmdd}` |
| `notify:{channel}:cap-notified:{yyyymmdd}` | `notification:{channel}:cap-notified:{yyyymmdd}` |
| `notify:mock:deliveries` | `notification:mock:deliveries` |
| `notify:mock2:deliveries` | `notification:mock2:deliveries` |

Литералы определены в `src/notification/redis_queue.py` (константы трёх стримов) и `src/notification/channels/limits.py` (две пары cap-ключей), `channels/mock.py` / `channels/mock2.py` (ключи доставок). Потребители: ключи доставок ассертятся бекенд-тестами; фронтовые e2e-спеки читают **cap-ключи** (`notify:mock:cap:*`, `notify:mock2:cap:*`) и SQL по `notify_tasks` — все обновляются той же волной. Группы потребителей `dispatcher` / `worker` имени подсистемы не несут — не меняются.

**Лог-неймспейс — переименовывается** (имена подсистемы в живом контракте логов): логгеры `memo.notify.*` → `memo.notification.*` (dispatcher, worker, redis_queue, channels/limits, channels/telegram, channels/registry); префикс процесса `notify dispatcher` → `notification dispatcher` (`src/util/process.py` документирует его как передаваемый лог-контракт); префикс ошибки `notify: transport unavailable` → `notification: transport unavailable` (`redis_queue.py`). Литералы логгеров/префиксов ассертятся тестами пакета (`test_notify_dispatcher`, `test_notify_worker`, `test_notify_channels`, `test_notify_delivery`, `test_notify_redis_gates`, `notify_redis_support`) — обновляются вместе.

### 3.4 env-переменные

Код (`backend/src/core/config.py`, 5):

| Было | Стало |
|---|---|
| `NOTIFY_ENABLED` | `NOTIFICATION_ENABLED` |
| `NOTIFY_POLL_INTERVAL` | `NOTIFICATION_POLL_INTERVAL` |
| `NOTIFY_CHANNEL_PRIORITY` | `NOTIFICATION_CHANNEL_PRIORITY` |
| `NOTIFY_REENQUEUE_AFTER` | `NOTIFICATION_REENQUEUE_AFTER` |
| `NOTIFY_SEND_RETRIES` | `NOTIFICATION_SEND_RETRIES` |

Скриптовые (4 + 1 CI-гейт, добавлены разведкой/панелью):

| Было | Стало |
|---|---|
| `NOTIFY_E2E_ENABLED` / `NOTIFY_E2E_BACKEND_PORT` / `NOTIFY_E2E_SHARD_PORT` / `NOTIFY_E2E_REDIS_PORT` | `NOTIFICATION_E2E_*` (те же суффиксы) |
| `NOTIFY_TESTS_E2E_ENABLED` (CI-гейт шагов джобы, `test.yml`, 5 точек) | `NOTIFICATION_TESTS_E2E_ENABLED` |

Операционная часть (все места установки/чтения): `dev.sh` (включая `NOTIFY_MODE` и флаг `--notify` → `NOTIFICATION_MODE` / `--notification`), `scripts/e2e-shard-start.sh`, `scripts/e2e-shard-start.dryrun.test.sh`, `.github/workflows/test.yml`, `backend/.env.example`. Обратная совместимость старых имён НЕ сохраняется: подсистема до прода, потребителей env вне репо нет; оператор локального контура обновляет `.env` один раз. Старый `.env` с `NOTIFY_ENABLED=true` после волны молча игнорируется (`extra="ignore"`) — отказобезопасное направление «выключено».

Тела валидаторов конфига, читающие переименованные поля, переезжают вместе с ними: `_force_notify_off_in_testing` (глушение подсистемы в testing-профиле; сам идентификатор — `notification`), `_require_redis_url_in_production` (прод-требование `rediss://` при включённой подсистеме). Тестовые конструкторы `Settings(NOTIFY_ENABLED=…)` — `tests/test_settings_redis_url.py` (7 вхождений) — на новое имя поля.

Строки fail-fast, называющие подсистему: `notify: transport not configured` → `notification: transport not configured`; текст валидации `NOTIFY_ENABLED=true (notify transport not configured)` → под новое имя переменной.

### 3.5 Код ошибки (внешний контракт, решение Gate A-Б)

| Было | Стало |
|---|---|
| `NOTIFY_TRANSPORT_UNAVAILABLE` | `NOTIFICATION_TRANSPORT_UNAVAILABLE` |

Места: `backend/src/errors.py`, `backend/src/auth/otp_transport.py`, `backend/src/auth/router.py`, бекенд-тесты `tests/test_errors.py` (полнота enum) и `tests/test_auth_otp_api.py` (2 ассерта значения), веб-тесты (`useOtpLogin`, `BookingOverlay`), комментарий в `packages/api-client/src/endpoints.ts`, `backend/.env.example` (упоминание кода), `docs/domain-rules/auth.md`. Потребителей вне монорепо нет — волна согласована одним диффом.

### 3.6 CI, скрипты, процессы

- Джоба CI `notify-tests` → `notification-tests` (`.github/workflows/test.yml`); артефакт `e2e-report-notify` → `e2e-report-notification`; гейт `NOTIFY_TESTS_E2E_ENABLED` (§3.4).
- Идентификатор шарда `SHARD_ID=notify` → `SHARD_ID=notification`; парность-инвариант `NOTIFICATION_E2E_ENABLED=1 ⇔ SHARD_ID=notification` в скрипте сохраняется.
- **Укрепление стража спек-файла:** существующий шаг Spec-file guard дополнительно проверяет, что e2e-спека содержит актуальный литерал гейта (`NOTIFICATION_E2E_ENABLED`) — иначе полусделанное переименование env даёт молча скипнутую (зелёно-пустую) e2e-ногу: Playwright с нулём исполненных тестов выходит с кодом 0.
- Процессы: `python -m src.notify.dispatcher` / `python -m src.notify.worker` → `python -m src.notification.*` — во всех точках спавна: `dev.sh`, `scripts/e2e-shard-start.sh`, literal-ассерты argv в `scripts/e2e-shard-start.dryrun.test.sh`, спавны в `tests/test_notify_worker.py`.
- Файл тестовой БД контура: `test_memo_notify_e2e.db` → `test_memo_notification_e2e.db` (workflow + скрипт + докстринги).
- Сид-канон: файлы, именующие notify-таблицы/ключи (генератор канона, тест канона), обновляются на новые имена.

### 3.7 Тест-файлы

**Правило имени файла:** переименовываются файлы, чей предмет — подсистема; файлы, чей предмет — флаг записи, имя сохраняют (обновляются импорты/литералы внутри).

- Бекенд, маска `tests/*notify*`: 28 `test_*.py` + `tests/notify_redis_support.py` = 29 файлов; из них `tests/test_api_records_notify_flag.py` имя СОХРАНЯЕТ (флаг записи, §2.1), остальные 28 переименовываются (`test_notification_*`, `notification_redis_support.py`). Плюс `tests/usecases/test_records_create_notify_event.py` → `test_records_create_notification_event.py` (предмет — событие уведомления, т.е. подсистема).
- **Файлы вне маски с функциональными литералами подсистемы (панель):**
  - `tests/domain_events/test_migration.py` — ассертит на новой голове старые имена (`INSERT INTO notify_tasks`, `notify_event_attempts`, `uq_notify_tasks_event_scenario_root`): без правки красный CI гарантирован; обновляется на новые имена.
  - `tests/domain_events/test_boundaries.py` — AST-страж границ импорта: константа `NOTIFY = "src.notify"`, `SEAL_PACKAGES = ("notify", …)`, ветка фильтра `rel.parts[0] == "notify"`; без правки страж молча перестаёт охранять переименованный пакет (зелёный CI при мёртвой границе). Страж вынесен на упразднение отдельной задачей #589 (решение владельца 2026-11-09: мета-тесты чистоты архитектуры удаляются): если #589 закроется до IMPL этой волны — пункт снимается, файл удаляется целиком.
  - `tests/domain_events/test_relay.py`, `test_wipe_recovery.py`, `test_subscribe.py`, `tests/test_streams_transport.py` — импорты (§3.1).
  - `tests/domain/test_deletion.py`, `tests/domain/test_deletion_family.py` — ключ графа удаления (§3.2).
  - `tests/test_errors.py`, `tests/test_auth_otp_api.py` — код ошибки (§3.5).
  - `tests/test_settings_redis_url.py` — конструкторы Settings (§3.4).
  - Тесты пакета с литералами логгеров/префиксов (§3.3).
- Фронт: `frontend/admin/e2e/notify-s1-enabled-stack.spec.ts` → `notification-s1-enabled-stack.spec.ts`, `notify-s6-mock-delivery.spec.ts` → `notification-s6-mock-delivery.spec.ts`; ссылки на пути в CI обновляются; внутри — SQL-литералы (`SELECT … FROM notify_tasks`), cap-ключи, env-гейт скипа; таблицы в `globalSetup.ts` (BLACKLIST) и `fixtures/seed-reset.ts` → новые имена. Чтение `records.notify` остаётся (§2.1).
- Юнит-тесты фрона/admin, ассертящие `notify: true/false` в телах создания записи, — НЕ меняются (поле осталось).

### 3.8 Документация (живая)

Переименовываются и обновляются: `docs/domain-rules/notify.md` → `docs/domain-rules/notification.md` (идентификаторы внутри: таблицы, `clients.notify_enabled`; `notify_off` остаётся — §2.1), упоминания в `docs/domain-rules/domain-events.md` (зеркало `NOTIFICATION_ENABLED`), `auth.md` (код ошибки), `_overview.md`, `records.md` (только идентификаторы подсистемы, не флаг записи), `tests_workflow.md`, живые планировочные `PLAN.md` и `docs/release/v1-2026-12-01.md` («notify-контур»). Комментарии/докстринги живых файлов, называющие подсистему настоящим временем (`pyproject.toml`, `backend/scripts/generate_telegram_session.py`, `backend/seed-data/README.md`, `src/streams/__init__.py`, `src/services/decorators.py`, `src/usecases/records.py`, `src/util/process.py`, `src/util/utc.py`, `frontend/web/e2e/lib/*`, `frontend/web/scripts/test-e2e.sh`), — обновляются; докстринги-провенанс (ссылки на исторические спеки/PR) — остаются (§2.3). Ссылки домен-правил друг на друга обновляются.

## 4. Стримы: порядок переключения

**Переходный период не нужен.** Обоснование:

1. Прод не запущен: подсистема выключена по умолчанию (`NOTIFICATION_ENABLED=false`), прод-инфраструктура и прод-данные — в бэклоге (#574/#575). Живого прод-Redis со стримами `notify:*` не существует.
2. Задачи `notification:tasks` переживают потерю стрима: ретеншн живёт в БД (ADR 013), sweep диспетчера перезапускает `queued` из таблиц. Статусные события, погибшие в старом `notify:statuses` в момент переключения, замораживают свою задачу в `sending` — это заранее существующее свойство восстановления (sweep не трогает `sending`), волна его не создаёт и не меняет; до прода оно несущественно (контур выключен, §4.1).
3. Группы потребителей создаются кодом при старте на новых именах (`XGROUP CREATE id=0 MKSTREAM`) — первый запуск после волны сам создаёт `notification:*` с чистыми группами.

Переключение = один деплой кода с новыми именами. Остатки `notify:*` в dev-Redis умирают со своим жизненным циклом (контур поднимает выделенный Redis; CI-среда эфемерна). Отдельная чистка старых ключей не выполняется.

## 5. Миграция данных

Одна новая alembic-ревизия, стиль — по образцу `e8a2c4d6b0f3` (batch_alter_table + SQLite-пересборка, полный downgrade):

1. `op.rename_table` × 4 (`notify_*` → `notification_*`). SQLite ≥ 3.26 при `ALTER TABLE … RENAME` сам обновляет REFERENCES в зависимых таблицах (среда: CPython бандлит новее; миграционный тест с включённым `PRAGMA foreign_keys` ловит любой промах — п.7).
2. Переименование колонки `clients.notify_enabled` → `notification_enabled` через batch_alter_table (пересборка таблицы).
3. Три именованных уникальных индекса: в SQLite нет `ALTER INDEX` — drop + create с определениями из моделей (включая partial `sqlite_where` у `uq_notification_tasks_event_scenario_root` и expression `COALESCE` у `uq_notification_templates_event_channel`), симметрично их созданию в ревизиях `d94b1f7c2a6e` / `e8a2c4d6b0f3`.
4. Downgrade — полные обратные переименования; тест даунгрейдится до явного id родительской ревизии (не `-1`).
5. Данные не пересоздаются: rename сохраняет строки, включая сид-шаблоны из ревизии a7c3e9f1b2d4. UPDATE данных не требуется (единственный кандидат `skip_reason="notify_off"` остаётся значением флага записи, §2.1).

Миграционный тест (существующий `test_notify_migration.py` переезжает в `test_notification_migration.py` и расширяется — панель):

6. Движки теста включают `PRAGMA foreign_keys=ON` + прямой ассерт `PRAGMA foreign_key_list(notification_task_attempts)` → `notification_tasks` (no-drift сегодня сверяет только таблицы/колонки и FK-переезд не ловит).
7. На родителе ревизии вставляются НЕ-сидовые строки (клиент с `notify_enabled=false`, задача + попытка) → после upgrade: строки на месте, согласие `false` осталось `false`, FK жив; отсутствие старых имён (absence-ассерты `sqlite_master`); после downgrade — зеркально (согласие `false` пережило roundtrip).
8. Паттерн сохраняется: `upgrade head` / downgrade на временной SQLite + no-drift ORM-метаданных. Прецедент переименований в миграциях репо есть (`e5f7a9c3b1d8`, masters→staff).

## 6. User Scenarios

| # | Сценарий | Проверка |
|---|---|---|
| US-1 | Оператор поднимает контур уведомлений (флаг `dev.sh --notification`, стек e2e-скрипта): диспетчер и воркер стартуют из пакета `src.notification`, выделенный Redis жив | e2e `notification-s1-enabled-stack` зелёный на новых именах (стек стартует `scripts/e2e-shard-start.sh` — его argv покрыт dryrun-ассертами); литералы `dev.sh` (флаг, экспорты env, спавны) покрыты греп-страхом §10 |
| US-2 | CI прогоняет контур: джоба `notification-tests` (marked-redis тесты + e2e-стек) зелёная и НЕ пустая | CI-джоба в `test.yml`; укреплённый Spec-file guard (§3.6) ловит зелёно-пустой скип |
| US-3 | Существующие данные переживают миграцию: строки `notify_*` оказываются в `notification_*`, согласие и сид-шаблоны на месте, старых имён нет | миграционный тест §5.6–5.8 (upgrade/downgrade + FK + absence + no-drift) |
| US-4 | Клиент веба при сбое транспорта одноразового кода получает код `NOTIFICATION_TRANSPORT_UNAVAILABLE` | веб-тесты `useOtpLogin` / `BookingOverlay` + бекенд `test_auth_otp_api` (обновлённые) |
| US-5 | Доставка через mock-канал видна в ключе `notification:mock:deliveries` (бекенд-тест), статусы — в `notification_tasks` и cap-ключах (e2e) | бекенд `test_notification_redis_s6_delivery` + e2e `notification-s6-mock-delivery` |

## 7. Behavioral Delta

- **Пользователь приложения:** без изменений. UI-строк с «notify» не существует; поведение подсистемы не меняется.
- **Оператор/разработчик:** env `NOTIFY_*` → `NOTIFICATION_*` (10 переменных; локальный `.env` контура обновляется руками один раз), флаг `dev.sh --notify` → `--notification`, джоба CI `notify-tests` → `notification-tests`, пути пакета/тестов/спек, файл тестовой БД и логгеры `memo.notify.*` → `memo.notification.*` переименованы, код ошибки транспорта → `NOTIFICATION_TRANSPORT_UNAVAILABLE`.
- **Поле `records.notify` в API создания записи:** осталось как было (до = после).

## 8. Visual Compliance Checks

N/A

## 9. Последовательность с соседними работами

- **#486 (раздел админки):** строго после этой волны; его локальная спека переписывается под `notification` (новые эндпоинты `/api/v1/notification/*`, тестиды `notification-*`) до IMPL.
- **#530 (dev.sh fail-fast watch), #531 (страж notify-tests), #532 (Playwright browsers в notify-tests):** те же файлы/джоба — волна #581 проходит первой, соседи ребейзятся на новые имена (их дизайн-решения не устаревают, меняются только литералы).
- **#540 (env-файлы в `envs/`):** ортогональны — #581 меняет имена переменных, #540 расположение файлов; порядок любой с ребейзом.
- **#563 (пробуждение по сообщению), #570 (reenqueue cap-out), #588 (stale consumer-записи):** бекенд-зона подсистемы, ребейз после волны; предмет задач не меняется.
- **#541 (Hold, порядок каналов в админке):** не пересекается до выхода из Hold.

## 10. Риски, греп-страх и мера

- **Авто-имена FK/индексов SQLite при rename:** миграционный тест с no-drift + FK-ассертами (§5.6) ловит расхождение; при дрейфе ревизия переименовывает явно.
- **Пропущенный литерал в ~130 файлах:** реестр §3 сверен панелью с живым деревом; выходной контроль — механический греп (ниже).
- **Греп-страх (механический):** `grep -ri notify` по зонам `backend/src`, `backend/tests`, `backend/alembic/env.py`, `backend/pyproject.toml`, `backend/scripts`, `backend/seed-data`, `scripts/`, `dev.sh`, `.github/`, `frontend/`, `packages/api-client`, `docs/domain-rules`, `tests_workflow.md`, `PLAN.md`, `docs/release` — допустимый остаток ТОЛЬКО: (а) `records.notify` и его производные (`test_api_records_notify_flag.py`, `notify_off`); (б) английское слово notify в чужом смысле (§2.2, включая `LISTEN/NOTIFY`); (в) исторический канон (§2.3: `docs/specs|plans|status|decisions`, `CHANGELOG.md`, `backend/alembic/versions`, докстринги-провенанс). Всё остальное — красный.
- **Поломка dryrun-теста скрипта:** literal-ассерты argv обновляются в той же волне (§3.6).
- **Зелёно-пустая e2e-нога:** укрепление Spec-file guard (§3.6).
- **Рассинхрон с несмерженными ветками соседей:** волна одна, ребейз соседей — их зона (§9).
