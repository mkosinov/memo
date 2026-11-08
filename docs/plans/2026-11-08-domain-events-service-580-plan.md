# План: DomainEventsService — выноска сервиса доменных событий (#580)

Спека: `docs/specs/2026-11-08-domain-events-service-580-design.md` (рев.2). Каждый сценарий спеки §5 закрыт задачей ниже; DoD задач несёт его тест.

## Goal

Журнал `domain_events` покидает пакет оповещений: модуль `src/domain_events` (модель, журнал, реестр типов, ретранслятор, API подписки) + общий транспорт стримов `src/streams` + notification читает группу вместо поллинга журнала. Поведение для пользователей не меняется; гарантия «как минимум один раз» с дедупликацией на подписчике.

## Architecture

Продюсер помечает событие в своей транзакции (аккумулятор в `@transactional`, без изменений семантики) → ретранслятор (`python -m src.domain_events.relay`) хвостом журнала публикует XADD в стримы `domain_events:<тип>` → подписчики-группы (первый — notification) подтверждают после материализации результата. Журнал SQLite — источник истины; Redis — перестраиваемый слой рассылки.

## Tech Stack

Python 3.12 / SQLAlchemy async + alembic / Redis Streams через извлекаемый общий транспорт (`src/streams/transport.py`) / pytest + redis-gates контур CI `notify-tests`.

---

## Task 1: Общий транспорт стримов `src/streams/transport.py`

### Classification: standard

Извлечь из `src/notify/redis_queue.py` общее ядро (§3.6 спеки): пул (ретраи выключены, socket timeout), `StreamTransportError` (в notify — псевдоним `NotifyTransportError`), `_publish` (XADD c MAXLEN_APPROX), `_claim` (XREADGROUP > + конверт `_qid`), `_ack`, `_ensure_group` (id=0 MKSTREAM, BUSYGROUP подавлен), **сырой XAUTOCLAIM** (без пере-XADD), `_is_missing_group`, `ping`/`close` (keep_if_pending), `connect_or_exit`. `RedisQueue` сохраняет API, делегирует ядру; обёртка «повторный XADD + ack» остаётся на `RedisQueue`. Существующие `test_notify_redis_queue.py` и весь redis-корпус — зелёные без правки ассертов (правка только импортов/фикстур).

### Required Docs

`docs/domain-rules/domain-events.md` (правила транспорта), ADR 013, спека §3.6.

### DoD

- Все `test_notify_redis_*` зелёные на делегирующем `RedisQueue`; новый юнит: сырое-XAUTOCLAIM-ядро не пере-XADD-ит (ассерт числа записей в стриме).

---

## Task 2: Модуль `src/domain_events` — модель, журнал, реестр; переключение шва продюсера

### Classification: standard

- `models.py`: переезд `DomainEvent` (таблица не переименовывается); `types.py`: декларативный реестр (пилот `new_record`), `require_type`; `journal.py`: переезд ПОЛНОЙ поверхности (`open_journal`/`reset_journal`/`draw_events`/`pending_events`/`mark_domain_event`) + валидация типа (`ValueError` на незарегистрированном, снимок обязателен).
- Переключение импортов: `src/services/decorators.py` (журнал + `DomainEvent`), `src/models/__init__.py`, `alembic/env.py`, `src/usecases/records.py` (марка + тип). Сборщик снимка `build_new_record_snapshot` переезжает из `src/notify/snapshots.py` к продюсеру (`src/usecases/records.py` или соседний модуль) — продюсер не импортирует notify.

### Required Docs

`docs/domain-rules/domain-events.md` (журнал, реестр), семейная спека §4.1, спека §3.1–3.2.

### DoD

- Сценарий 1 (продюсерская половина) проходит: `backend/tests/usecases/test_records_create_notify_event.py` адаптирован + негативная ветка (незарегистрированный тип / марка без снимка → `ValueError`, доменная строка и событие откатились вместе); `test_notify_journal_transactional.py` и `test_notify_snapshots.py` переезжают вместе с модулем без правки ассертов.
- Тест полноты реестра: `new_record` зарегистрирован без импорт-побочек.

---

## Task 3: Миграция переключения

### Classification: standard

Alembic-миграция (§4.2): добавить `published_at`; бэкфилл моментом миграции для строк, где `processed_at IS NOT NULL` **ИЛИ** `processing_error IS NOT NULL` (два непересекающихся множества: потреблённые и припаркованные ошибкой — мёртвые события не переиздаются); снять `processed_at`/`attempts`/`processing_error`; заменить `ix_domain_events_pending` → `ix_domain_events_unpublished WHERE published_at IS NULL`; у notification: таблица `notify_event_attempts(event_id, scenario, attempts, last_error)` c `UNIQUE(event_id, scenario)` и частичный индекс `uq_notify_tasks_event_scenario_root (event_id, scenario) WHERE parent_task_id IS NULL` с предварительной проверкой дублей корней.

### Required Docs

`docs/domain-rules/notify.md`, спека §4.2, прецедент `c970adc6b3d6` (частичный индекс через `sqlite_where`).

### DoD

- Сценарий 7 проходит: `test_domain_events_migration` — оба множества бэкфилла (потреблённые ИЛИ припаркованные — помечены; непотреблённые — NULL и публикуются) + корни без дублей (стиль `test_notify_migration`); `test_partial_index_has_both_predicates` переписан под новый предикат.
- Порядок переключения «стоп диспетчера → миграция → старт ретранслятора и диспетчера» зафиксирован в `docs/domain-rules/notify.md` (раздел «Журнал доменных событий»).

---

## Task 4: Ретранслятор

### Classification: standard

`src/util/process.py` (переезд `run_loop` + `install_signal_handlers`, параметризованный префикс лога; notify переключается импортом). `src/domain_events/relay.py` (§3.3): вход `python -m src.domain_events.relay`, цикл — батч 20 `published_at IS NULL ORDER BY occurred_at, id`, XADD по типу через `to_thread`, пометка батча одним коммитом; транспортный сбой XADD — батч остаётся непомеченным, повтор на следующем тике (не в `finally`); пособытийный не-транспортный сбой — published + ERROR-лог; лог глубины хвоста каждым тиком; настройки `DOMAIN_EVENTS_ENABLED`/`DOMAIN_EVENTS_POLL_INTERVAL` (§4.4); `dev.sh` — ребёнок relay в контуре `--notify`; каркас входа — по образцу `dispatcher.main()`.

### Required Docs

`docs/domain-rules/domain-events.md` (ретранслятор), спека §3.3, §4.4–4.5.

### DoD

- Сценарий 1 проходит полностью: `test_domain_events_redis_publish` — журнал → XADD → `published_at`; порядок: события вставлены в обратном `(occurred_at, id)` — прибытие строго `(occurred_at, id)`, потолок батча 20 (преемник `test_poll_respects_batch_size_and_occurred_at_order`).
- Сценарий 3 проходит: `test_domain_events_relay_restart` — рестарт допубликовывает; в стриме ДВЕ записи (дубль реально доставлен), задача-корень одна.

---

## Task 5: API подписки `src/domain_events/subscribe.py`

### Classification: small

`Subscriber` (§3.4): `ensure` (валидация имён стримов по реестру, XGROUP id=0 MKSTREAM), `claim`, `ack`, `reclaim` (сырой XAUTOCLAIM ядра), `close` (keep_if_pending). Имя группы глобально уникально — контракт в докстринге и domain-rules.

### Required Docs

`docs/domain-rules/domain-events.md` (подписки), спека §3.4.

### DoD

- Сценарий 6 проходит целиком (`test_domain_events_registry_multi`): регистрация второго типа в реестре → вывод ключа стрима → `ensure`/claim на нём → вторая группа получает свои записи независимо от первой; `ensure` на незарегистрированном имени стрима — ошибка валидации; негативная ветка реестра — из DoD задачи 2.

---

## Task 6: Notification — подписчик вместо поллинга

### Classification: large

Диспетчер теряет цикл поллинга журнала (§3.5): цикл чтения группы `notification` на `domain_events:new_record` (claim батчем → `handle_new_record` → ack) + четвёртый периодический цикл возврата зависших (константа интервала, стартовый `reclaim_hanging` остаётся). Сценарий: идемпотентность через частичный индекс корней (IntegrityError → ack «уже обработано»); гроссбух `notify_event_attempts` (инкремент; `attempts < 3` — не ack, ≥ 3 — ack с парковкой; повторная выдача паркованного перейпаркуется); `StreamTransportError` — без инкремента, без ack (закоммиченная задача добирается перезаливкой). Циклы статусов/входящих, перезаливка, цепочки, воркер — не трогаются. Тесты поллинг-цикла диспетчера удаляются с заменой на групповые входы; судьбы — по спеке §5.2.

### Required Docs

`docs/domain-rules/notify.md`, ADR 014, спека §3.5.

### DoD

- Сценарий 2 проходит: адаптированные `test_notify_scenarios`/`test_notify_dispatcher` на вход через группу (успех, каждый skip-реason).
- Сценарий 4 проходит: `test_notify_scenario_attempts_ledger` — инкременты по циклу возврата (не ручной вызов), после 3 неудач PEL пуст для события (`min_idle_ms=0` возврат пуст), транспортная ветка попыток не сжигает.

---

## Task 7: Восстановление и потеря Redis

### Classification: small

`--republish-since <ISO>` (§3.3/§4.5): dry-run печатает число строк, затем окна ≤ MAXLEN с пометкой между окнами; граничное условие `occurred_at >= точки`. Wipe-сюита: пересоздание групп на старте (NOGROUP — уже в ядре), повторная доставка поглощается.

### Required Docs

`docs/domain-rules/domain-events.md` (восстановление), спека §4.5.

### DoD

- Сценарий 5 проходит: `test_domain_events_wipe_recovery` (по образцу `test_notify_redis_s8_recovery`) — включая событие СТАРШЕ точки (не переиздаётся).

---

## Task 8: Границы модулей и финальная прогонка

### Classification: small

Тест импорт-направлений по каноническому списку шва (спека §8): `src/domain_events` не импортирует notify; продюсер — реестр/марка/сборщик снимка; notify — `subscribe` и реестр. Чистка мёртвых тестов поллинга; полный зелёный прогон бэкенда + CI `notify-tests`.

### Required Docs

Спека §8, `docs/domain-rules/domain-events.md` (границы).

### DoD

- Линт границ зелёный; `pytest` бэкенда и CI-джоба `notify-tests` зелёные; несвязанных переименований нет (волна — #581).
