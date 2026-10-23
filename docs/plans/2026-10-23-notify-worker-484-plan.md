# Воркер отправки оповещений (#484, часть 3 #476) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать воркер доставки реальным: потребление `notify:tasks` группой `worker`, реестр каналов с мок-каналом, фолбэк по приоритету, транспортные ретраи, публикация статусов, включение воркера в dev/e2e/CI-контуры.

**Architecture:** Воркер — отдельный asyncio-процесс без БД и без рендера (ADR 009); транспорт — Redis Streams + consumer groups напрямую через sync redis-py (ADR 013), вызовы порта через `asyncio.to_thread`. Каналы — асинхронный протокол с типизированными ошибками и декларативным реестром (ADR 011); конвертация разметки — владение канала. Диспетчер — единственный писатель в БД, воркер только публикует статусные события в `notify:statuses`.

**Tech Stack:** Python 3.11+, redis-py (sync), SQLAlchemy/alembic (только читатель статусов — без новых миграций), pytest (+маркер `redis`), Playwright (S6).

Спека: `docs/specs/2026-10-22-notify-worker-484-design.md` (rev.2, main cbca6628). Семейная: `docs/specs/2026-10-11-notify-system-476-design.md` (рев.4). Доменные правила: `docs/domain-rules/notify.md`. Все пути кода — относительно `backend/` (кроме `dev.sh`, `scripts/`, `.github/`, `frontend/`).

Маркированные redis-тесты: `cd backend && REDIS_URL=redis://127.0.0.1:6379/0 .venv/bin/python -m pytest tests/<module> -m redis -q` (Redis поднимает `./dev.sh --notify` с хоста, выделенный инстанс на :6379; в CI — сервис-контейнер джобы `notify-tests`). Обвязка контура: `tests/notify_redis_support.py` (маркер + skipif без `REDIS_URL`, уникальный префикс ключей, фабрики).

---

## Task 1: Настройка NOTIFY_SEND_RETRIES + общий модуль процессов
### Classification: small
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.7 (process.py), §3.8 (настройка), §4.5 семейной спеки (дефолт 3)
- `backend/src/notify/dispatcher.py` — источник `run_loop`/`_install_signal_handlers` при переносе (переносить дословно)

### Files
- Modify: `src/core/config.py`, `src/notify/dispatcher.py`, `src/notify/worker.py`
- Create: `src/notify/process.py`
- Modify: `tests/test_notify_worker.py` (существующие строки скелета — только импорты)

### Steps
- [ ] Добавить настройку в `config.py` (рядом с `NOTIFY_REENQUEUE_AFTER`):
  ```python
  #: Max send attempts per channel in the delivery worker — transport
  #: failures only (family #476 §4.5; part 3, GH #484).
  NOTIFY_SEND_RETRIES: int = 3
  ```
- [ ] Тест RED: `tests/test_notify_settings_time.py` дополнить строкой `assert settings.NOTIFY_SEND_RETRIES == 3`; прогнать `cd backend && .venv/bin/python -m pytest tests/test_notify_settings_time.py -q` — падает на новой строке (атрибута нет).
- [ ] GREEN: настройка добавлена — тест зелёный.
- [ ] Создать `src/notify/process.py`: перенести дословно `run_loop` (dispatcher.py:388–406) и `_install_signal_handlers` (dispatcher.py:443–451; публичное имя `install_signal_handlers`), модульный docstring — «общие механики процессов notify: изолированный цикл + сигналы (часть 3 #484, спека §3.7); источник — диспетчер части 1».
- [ ] `dispatcher.py`: удалить оба определения, импортировать из `src.notify.process`; логгер внутри `run_loop` остаётся `memo.notify.dispatcher` — передать `logger` параметром `run_loop(..., log: logging.Logger)`, диспетчер передаёт свой.
- [ ] `worker.py`: `_install_signal_handlers` заменить на импорт из `src.notify.process` (`idle_loop` пока остаётся — цикл доставки приезжает в Task 5).
- [ ] Прогнать: `cd backend && .venv/bin/python -m pytest tests/test_notify_dispatcher.py tests/test_notify_worker.py -q` — всё зелёное (поведение без изменений).
- [ ] Коммит: `feat(#484): настройка NOTIFY_SEND_RETRIES + общий process.py (run_loop, сигналы)`.

## Task 2: Пакет каналов — протокол, ошибки, реестр, мок
### Classification: standard
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.2 (протокол+ошибки), §3.3 (реестр/приоритет/дефолт), §3.6 (мок+рекордеры)
- `docs/decisions/011-channels-registry-templates-in-core.md` — паттерн декларативного реестра
- `src/notify/scenarios.py` — прецедент реестра (`SCENARIOS` + регистрация внизу модуля)
- `src/notify/dispatcher.py:91–112` — текущий `parse_channel_priority` (переносится дословно)

### Files
- Create: `src/notify/channels/__init__.py`, `src/notify/channels/base.py`, `src/notify/channels/registry.py`, `src/notify/channels/mock.py`
- Modify: `src/notify/dispatcher.py` (импорт перенесённой функции)
- Create: `tests/test_notify_channels.py`, `tests/test_notify_channels_mock.py`

### Steps
- [ ] `base.py` — протокол и ошибки (спека §3.2):
  ```python
  class ChannelError(Exception):
      """Base of channel-delivery failures (part 3 #484, spec §3.2)."""

  class ChannelAppError(ChannelError):
      """Application-level failure (bad address, refused, blocked — the
      4xx analogue): NOT retried, the channel attempt ends here."""

  class ChannelTransportError(ChannelError):
      """Transport failure (disconnect/timeout/5xx/429): retried up to
      NOTIFY_SEND_RETRIES. ``retry_after`` — seconds from Retry-After."""
      def __init__(self, message: str, retry_after: float | None = None) -> None:
          super().__init__(message)
          self.retry_after = retry_after

  @runtime_checkable
  class Channel(Protocol):
      name: str
      async def is_available(self) -> bool: ...
      async def send(self, address: str, text_neutral: str) -> None: ...
  ```
- [ ] `registry.py` — перенос `parse_channel_priority` из `dispatcher.py` дословно (docstring: канонический дом словаря имён каналов); диспетчер импортирует отсюда, своё определение удаляет. Реестр и проверка:
  ```python
  ChannelFactory = Callable[[], "Channel"]
  CHANNELS: dict[str, ChannelFactory] = {}

  NOT_REGISTERED_MESSAGE = "notify worker: channel {!r} is not registered"

  def validate_priority_channels(names: list[str], registry: dict[str, ChannelFactory] | None = None) -> None:
      """Loud startup gate (spec §3.3): every priority name must be
      registered — SystemExit(2) with a STABLE message before the group
      is created or the queue consumed."""
      known = registry if registry is not None else CHANNELS
      for name in names:
          if name not in known:
              raise SystemExit(2, NOT_REGISTERED_MESSAGE.format(name))

  def build_instances(names: list[str]) -> dict[str, Channel]:
      """Instantiate ONLY the prioritized channels."""
      return {name: CHANNELS[name]() for name in names}
  ```
- [ ] `mock.py` — мок-канал и рекордеры (спека §3.6): протокол `Recorder.record(address, text)`; `InMemoryRecorder` (список + снапшот-свойство `deliveries`); `RedisListRecorder(url, key_prefix="", list_name="mock:deliveries", cap=1000)` — свой клиент redis-py (те же опции пула, что у `RedisQueue`), `LPUSH` JSON `{address, text, occurred_at}` + `LTRIM 0 cap-1`. Канал:
  ```python
  class MockChannel:
      """Identity-conversion mock channel (spec §3.6): outcomes are
      scripted by the ADDRESS PREFIX — fail-transport:, fail-app:,
      anything else delivers to the recorder."""
      name = "mock"

      def __init__(self, recorder: Recorder) -> None:
          self._recorder = recorder

      async def is_available(self) -> bool:
          return True

      async def send(self, address: str, text_neutral: str) -> None:
          if address.startswith("fail-transport:"):
              raise ChannelTransportError(f"mock: scripted transport failure for {address}")
          if address.startswith("fail-app:"):
              raise ChannelAppError(f"mock: scripted app failure for {address}")
          self._recorder.record(address, text_neutral)
  ```
- [ ] Регистрация внизу `mock.py`: мок НЕ регистрируется при проде:
  ```python
  if settings.ENV != "production":
      CHANNELS["mock"] = lambda: MockChannel(RedisListRecorder(settings.REDIS_URL.get_secret_value()))
  ```
  (в тестах инстансы внедряются напрямую через шов `main(channels=…)` Task 5 — фабрика прод-контура в тестах не вызывается).
- [ ] Тесты `tests/test_notify_channels.py`: перенос `parse_channel_priority` не меняет поведение (строки диспетчерских тестов уже покрывают; добавить точечный импорт-тест); `validate_priority_channels` — известное имя молчит, неизвестное → `SystemExit` с точным сообщением `notify worker: channel 'x' is not registered`; пустой/дублированный CSV — прежние ошибки.
- [ ] Тесты `tests/test_notify_channels_mock.py`: тождественная конвертация (send пишет текст без изменений); `fail-transport:` → `ChannelTransportError` с `retry_after is None`; `fail-app:` → `ChannelAppError`; успех пишет `{address, text}` в `InMemoryRecorder`; `settings.ENV=production` (monkeypatch) → `"mock" not in CHANNELS` (пересоздать модуль или проверять условие функцией `mock_registered()` — выбрать второе: вынести проверку в функцию `is_mock_allowed() -> bool` и тестировать её).
- [ ] Прогон: `cd backend && .venv/bin/python -m pytest tests/test_notify_channels.py tests/test_notify_channels_mock.py tests/test_notify_dispatcher.py -q` — зелёные.
- [ ] Коммит: `feat(#484): пакет channels — протокол, ошибки, реестр, мок-канал`.

## Task 3: Воркерская половина транспорта — WorkerQueue, FakeQueue, RedisQueue
### Classification: standard
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.1 (порт, группа worker, periodic reclaim НЕ здесь — это цикл Task 5; close/DELCONSUMER-страховка)
- `src/notify/queue.py`, `src/notify/redis_queue.py` — текущие половины; `_claim`/`_ack` хардкодят `DISPATCHER_GROUP` — обобщить параметром группы
- `tests/notify_redis_support.py` — обвязка маркированного контура

### Files
- Modify: `src/notify/queue.py`, `src/notify/redis_queue.py`
- Create: `tests/test_notify_redis_worker_queue.py` (маркированный)
- Modify: `tests/test_notify_queue.py` (FakeQueue-половина — юнит)

### Steps
- [ ] `queue.py` — протокол воркерской половины (рядом с `NotifyQueue`):
  ```python
  @runtime_checkable
  class WorkerQueue(Protocol):
      """Worker-side half of the queue seam (part 3 #484, spec §3.1).
      publish_status is TYPED here (ADR 013 keeps it off the dispatcher
      protocol); names follow the adapter (FakeQueue.push_status stays
      as an alias for part-1/2 tests)."""
      def claim_tasks(self) -> list[TaskPayload]: ...
      def ack_task(self, item: TaskPayload) -> None: ...
      def publish_status(self, event: StatusEvent) -> None: ...
      def ensure_worker_group(self) -> None: ...
      def reclaim_hanging_tasks(self) -> None: ...
  ```
- [ ] `FakeQueue`: `_servicing_tasks: list[TaskPayload]`; `claim_tasks` (tasks → servicing, источник пуст), `ack_task` (удаление с подавлением ValueError — как `ack_status`), `publish_status = push_status` (алиас-присваивание), `reclaim_hanging_tasks` — **только задачи**: `self._tasks = self._servicing_tasks + self._tasks; self._servicing_tasks = []`; `reclaim_hanging()` существующий (статусы+inbound) не трогать.
- [ ] Юнит-тесты в `tests/test_notify_queue.py`: FIFO задач, ack идемпотентен, reclaim возвращает к голове, `isinstance(FakeQueue(), WorkerQueue)` истинно.
- [ ] `redis_queue.py` — обобщение и новые методы:
  - `_claim(self, stream, group)` / `_ack(self, stream, group, item)` — параметр группы (существующие диспетчерские вызовы передают `DISPATCHER_GROUP` — поведение без изменений);
  - `claim_tasks()` = `self._claim(TASKS_STREAM, WORKER_GROUP)`;
  - `ack_task(item)` = `self._ack(TASKS_STREAM, WORKER_GROUP, item)`;
  - `ensure_worker_group()` = `self._ensure_group(TASKS_STREAM, WORKER_GROUP)` (id=0 MKSTREAM — вычитка накопленного бэклога сознательна, спека §3.1);
  - `reclaim_hanging_tasks()` = `self._reclaim_stream(TASKS_STREAM, WORKER_GROUP)`;
  - `close()`: перед снятием consumer'а воркера — `XPENDING key group consumer`: пусто → `XGROUP DELCONSUMER`, непусто → журнал warning «consumer kept: N pending entries preserved for reclaim» и НЕ снимать (спека §3.1: DELCONSUMER уничтожил бы PEL-записи — спроектированный abort-путь). Диспетчерская половина close без изменений.
- [ ] Маркированные тесты `tests/test_notify_redis_worker_queue.py` (обвязка `redis_marks` + префикс из support-модуля):
  - `ensure_worker_group` идемпотентен (двойной вызов — BUSYGROUP подавлен);
  - раундтрип: `enqueue_task` → `claim_tasks` (конверт `_qid`) → `ack_task` → повторный claim пуст;
  - запись без ack → новый инстанс с малым `reclaim_min_idle_ms` → `reclaim_hanging_tasks` возвращает запись в доставку (claim снова её отдаёт; дубль исходной принят);
  - `close()` при пустом PEL снимает consumer, при зависшей записи — НЕ снимает (проверка `XINFO CONSUMERS`: consumer жив).
- [ ] Прогон юнита: `cd backend && .venv/bin/python -m pytest tests/test_notify_queue.py -q`; маркированный: `REDIS_URL=redis://127.0.0.1:6379/0 .venv/bin/python -m pytest tests/test_notify_redis_worker_queue.py -q` (пропуск без REDIS_URL — норма).
- [ ] Коммит: `feat(#484): воркерская половина транспорта — WorkerQueue, FakeQueue, группа worker в RedisQueue`.

## Task 4: Ядро доставки — parse_task_payload + deliver_task
### Classification: standard
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.1 (валидатор/брак), §3.2 (неклассифицированное исключение), §3.4 (алгоритм, паузы), §3.5 (таблица событий)
- `src/notify/queue.py` — конверт `_qid`, `TaskPayload`
- `docs/domain-rules/notify.md` — словарь состояний/стадий

### Files
- Modify: `src/notify/worker.py`
- Create: `tests/test_notify_delivery.py`

### Steps
- [ ] Валидатор в `worker.py` (брак всей задачи при любом нарушении, спека §3.1):
  ```python
  class InvalidTaskPayload(ValueError):
      """Task payload violating the family §4.2 shape — brak: log + ack,
      no status event (nothing to address)."""

  def parse_task_payload(raw: dict[str, Any]) -> TaskPayload:
      task_id = raw.get("task_id")
      if not isinstance(task_id, int) or task_id <= 0: raise InvalidTaskPayload(...)
      if not isinstance(raw.get("text"), str): raise InvalidTaskPayload(...)
      channels = raw.get("channels")
      if not isinstance(channels, list) or not channels: raise InvalidTaskPayload(...)
      for entry in channels:
          if (not isinstance(entry, dict) or not isinstance(entry.get("name"), str)
                  or not entry.get("name") or not isinstance(entry.get("address"), str)
                  or not entry.get("address")): raise InvalidTaskPayload(...)
      return raw
  ```
  (`created_at`/`resend_of` не критичны для доставки — не проверяются.)
- [ ] Константы модуля: `TRANSPORT_RETRY_PAUSE_SECONDS = 1.0`, `RETRY_AFTER_CAP_SECONDS = 30.0`.
- [ ] `deliver_task(task, channels: dict[str, Channel], queue: WorkerQueue, *, retries: int, sleep: Callable[[float], Awaitable[None]], stop: asyncio.Event) -> None` — алгоритм спеки §3.4: по записям payload; имя не в `channels` → событие `failed/unknown_channel`, следующая запись; `is_available()` false → `failed/unavailable`, следующая; попытки 1..retries: событие `sending/attempt` → `send`; успех → `sent/delivered`, возврат; `ChannelAppError` и ЛЮБОЕ неклассифицированное исключение (журнал с `exc_info`) → `failed/app_error`, канал закрыт, следующая запись; `ChannelTransportError` → `failed/transport_error`, при остатке бюджета — пауза `min(retry_after or TRANSPORT_RETRY_PAUSE_SECONDS, RETRY_AFTER_CAP_SECONDS)` через `sleep` (шов часов; в проде — `wait_for(stop.wait(), timeout=паузы)`), иначе следующая запись; после исчерпания записей — одно финальное `failed/not_delivered` с `channel` = имя последней записи. Публикация статусов — через переданный колбэк `publish: Callable[[StatusEvent], Awaitable[None]]` (прод-цикл оборачивает `queue.publish_status` в `to_thread`); исключение публикации (`NotifyTransportError`) прерывает задачу — пробрасывается выше без ack (спека §3.1). Тела сообщений в журналы не попадают — только идентификаторы и исходы.
- [ ] Тесты `tests/test_notify_delivery.py` (FakeQueue + `InMemoryRecorder`-мок + стаб-каналы, `sleep`-шов — счётчик вызовов без реального ожидания) — матрица S9 ядра:
  - успех с первой попытки: события `sending`,`sent`; остаток каналов не пробуется;
  - фолбэк: `fail-transport` ×N (N = retries, все с `transport_error`) → второй канал доставляет: полная цепочка событий, финала нет;
  - все каналы сбойны → финал `not_delivered` с последним именем;
  - `fail-app` не ретраится (ровно 1 попытка канала) и уходит на следующий канал;
  - `retry_after` больше потолка → пауза урезана до 30 с (журнал урезания), после последней неудачной попытки паузы НЕТ (бюджет проверяется до сна);
  - `is_available()=false` → `unavailable` без `sending`;
  - имя вне словаря каналов → `unknown_channel`;
  - неклассифицированное исключение `send` → `app_error`, трассировка в журнале (caplog), задача не падает;
  - `parse_task_payload`: нет task_id/text/channels, пустой список, запись без name/address → `InvalidTaskPayload`.
- [ ] Прогон: `cd backend && .venv/bin/python -m pytest tests/test_notify_delivery.py -q` — зелёные.
- [ ] Коммит: `feat(#484): ядро доставки — валидатор payload и перебор каналов с ретраями`.

## Task 5: Процесс воркера — цикл доставки, стартовые проверки, вход
### Classification: standard
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.1 (цикл, periodic reclaim, порядок ack), §3.3 (стартовые проверки), §3.7 (main-шов)
- `src/notify/dispatcher.py` — прецедент стартовых обязанностей и `run_loop`
- `src/notify/worker.py` — скелет, который замещаем (docstring скелета обновить)

### Files
- Modify: `src/notify/worker.py`
- Modify: `tests/test_notify_worker.py`

### Steps
- [ ] `main(queue: WorkerQueue | None = None, channels: dict[str, Channel] | None = None) -> None`: выключено (`NOTIFY_ENABLED=false`) — прежний тихий выход 0; включено: `names = parse_channel_priority(settings.NOTIFY_CHANNEL_PRIORITY)` → `validate_priority_channels(names)` (громко, exit 2 до создания группы) → очередь: инъекция или `connect_or_exit(...)` → `channels = channels or build_instances(names)` → `ensure_worker_group()` → `reclaim_hanging_tasks()` (обе через `to_thread`, `reclaim_min_idle_ms = settings.NOTIFY_REENQUEUE_AFTER * 1000` передать при построении очереди) → `install_signal_handlers(stop)` → цикл `run_loop("delivery", stop, settings.NOTIFY_POLL_INTERVAL, iteration, logger)`.
- [ ] Итерация: `items = await to_thread(queue.claim_tasks)`; для каждой: `parse_task_payload` — брак → журнал (ключи+task_id, без текста) + `ack_task`, продолжить; валидной — `await deliver_task(...)` с `publish = lambda e: to_thread(queue.publish_status, e)`; затем `ack_task`. Любая `NotifyTransportError` итерации пробрасывается в гвард `run_loop` (запись остаётся без ack). После батча: `await to_thread(queue.reclaim_hanging_tasks)` — периодический возврат зависших (спека §3.1, порог тот же). `idle_loop` и `SKELETON_MESSAGE` удалить, docstring модуля переписать под часть 3.
- [ ] Тесты `tests/test_notify_worker.py` (FakeQueue + стаб-каналы):
  - цикл обрабатывает батч: задача в FakeQueue → доставки в рекордере, статусы опубликованы, задача acked;
  - брак-payload → ack без статуса (FakeQueue.tasks после reclaim пуст);
  - `NotifyTransportError` из `publish_status` (стаб-очередь) → итерация падает, задача НЕ acked, процесс жив (вторая итерация после починки доставляет) — изоляция итераций `run_loop`;
  - стартовые проверки: неизвестное имя в приоритете → `SystemExit(2)` с точным сообщением, группа не создаётся (FakeQueue не получает `ensure_worker_group`);
  - `ensure_worker_group`+`reclaim_hanging_tasks` вызваны до цикла;
  - интеграция S9: полный юнит-прогон матрицы ядра (Task 4) + процесса — единый `-m "not redis"` контур без REDIS_URL.
- [ ] Прогон: `cd backend && .venv/bin/python -m pytest tests/test_notify_worker.py tests/test_notify_delivery.py -q`.
- [ ] Коммит: `feat(#484): цикл доставки воркера — стартовые проверки, periodic reclaim, ack после статусов`.

## Task 6: Диспетчер — защита читателя статусов от брака
### Classification: small
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.5 (двухслойное правило брака)
- `src/notify/dispatcher.py` — `statuses_once`/`apply_status_event` (текущее поведение: любая ошибка → без ack навечно)

### Files
- Modify: `src/notify/dispatcher.py`
- Modify: `tests/test_notify_dispatcher.py`

### Steps
- [ ] Пред-валидация формы события + класс брака в `statuses_once`:
  ```python
  def _is_malformed_status(item: StatusEvent) -> bool:
      """Shape pre-validation (spec §3.5): task_id int, stage in the
      vocabulary, channel non-empty str, occurred_at parseable."""
      try:
          if not isinstance(item.get("task_id"), int): return True
          if item.get("stage") not in ("sending", "sent", "failed"): return True
          if not isinstance(item.get("channel"), str) or not item["channel"]: return True
          _naive_utc(item["occurred_at"])
      except (KeyError, TypeError, ValueError):
          return True
      return False
  ```
  В цикле: `if _is_malformed_status(item): logger.error("...brak...identifiers...%r", {k: item.get(k) for k in ("task_id","stage")}); await to_thread(queue.ack_status, item); continue`; в `try` рядом с `apply_status_event` добавить `except ValueError` → журнал + `ack_status` (неизвестная задача/стадия при валидной форме). Прочие исключения — прежнее поведение: журнал, без ack.
- [ ] Тесты: брак формы (нет `channel`, кривой `occurred_at`, `stage` вне словаря) и неизвестный `task_id` → событие acked, соседние элементы батча обработаны; ошибка БД (monkeypatch сессии на `RuntimeError`) → без ack (зависший путь сохранён).
- [ ] Интеграционная строка S9 (спека): прогон на настоящем `statuses_once` с `FakeQueue.push_status` брака — читатель подтверждает брак и не возвращается к нему.
- [ ] Прогон: `cd backend && .venv/bin/python -m pytest tests/test_notify_dispatcher.py -q`.
- [ ] Коммит: `feat(#484): диспетчер подтверждает бракованные статус-события (форма + неизвестная задача/стадия)`.

## Task 7: S7+S8 — маркированные интеграционные сценарии
### Classification: standard
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §4 S7/S8; §3.6 (рукотворный payload с реальным task_id)
- `tests/test_notify_redis_reenqueue.py` — прецедент состаривания/порога малым значением
- `tests/notify_redis_support.py` — обвязка контура

### Files
- Create: `tests/test_notify_redis_s7_fallback.py`, `tests/test_notify_redis_s8_recovery.py`

### Steps
- [ ] `test_notify_redis_s7_fallback.py`: `RedisQueue` с префиксом; диспетчерская задача с реальным `task_id` (строка в тестовой БД через фикстуру диспетчерских тестов — прецедент `test_notify_dispatcher.py`); рукотворный payload `channels=[{"name":"mock","address":"fail-transport:+7…"},{"name":"mock","address":"+7…"}]` c `retries` малым (2) и `sleep`-швом; воркерская итерация (функции Task 5 без процесса) → доставка второй записи, события `transport_error`×2 затем `sent`; вариант оба `fail-*` → финал `not_delivered`; `apply_status_event` доводит строку БД до `sent`/`failed`.
- [ ] `test_notify_redis_s8_recovery.py`: `enqueue_task` → `claim_tasks` (запись в PEL) без ack; новый `RedisQueue` с `reclaim_min_idle_ms=500` → `reclaim_hanging_tasks` → claim отдаёт запись снова (переживание падения воркера, дубль принят); сюда же: `close()` воркерского инстанса при зависшей записи оставляет consumer (без delconsumer) — строка Task 3 закреплена на уровне сценария.
- [ ] Прогон: `REDIS_URL=redis://127.0.0.1:6379/0 .venv/bin/python -m pytest tests/test_notify_redis_s7_fallback.py tests/test_notify_redis_s8_recovery.py -q`.
- [ ] DoD: E2E/интеграционные сценарии S7 и S8 проходят (RED-GREEN-REFACTOR: сначала пишутся против несуществующих функций Task 3–5 — задача исполняется ПОСЛЕ них, RED-фаза вехой «прогон до реализации» не требуется, цикл соблюдён внутри Tasks 3–5).
- [ ] Коммит: `test(#484): S7 фолбэк/не-доставлено + S8 возврат зависших — маркированный контур`.

## Task 8: Стеки, e2e S6, CI, инвариант S10
### Classification: standard
### Required Docs
- `docs/specs/2026-10-22-notify-worker-484-design.md` — §3.3 (экспорт приоритета), §3.8 (стеки), §4 S6/S10
- `frontend/admin/e2e/notify-s1-enabled-stack.spec.ts` — прецедент обвязки notify-контура в Playwright (теги/пропуски/окружение)
- `scripts/e2e-shard-start.sh` — блок notify-контура части 2 (диспетчер-child, дисциплина сигналов, `|| true`)
- `.github/workflows/test.yml` — джоба `notify-tests`

### Files
- Modify: `dev.sh`, `scripts/e2e-shard-start.sh`, `.github/workflows/test.yml`, `backend/pyproject.toml`
- Create: `frontend/admin/e2e/notify-s6-mock-delivery.spec.ts`, `backend/tests/test_notify_redis_s6_delivery.py`
- Modify: `scripts/e2e-shard-start.dryrun.test.sh` (если dryrun фиксирует состав children — сверить)

### Steps
- [ ] `dev.sh`: в блоке notify-контура рядом с `export NOTIFY_ENABLED=true` добавить `export NOTIFY_CHANNEL_PRIORITY=mock` (комментарий: до части 4 — реестр части 3 знает только мок, спека §3.3).
- [ ] `scripts/e2e-shard-start.sh`: тот же экспорт в notify-режиме + воркер вторым child-процессом — зеркально блоку диспетчера (тот же `ENV_FILE=.env.test`, `exec .venv/bin/python -m src.notify.worker`, PID-переменная `WORKER_PID`, kill в ловушке с `|| true`).
- [ ] `.github/workflows/test.yml` (джоба `notify-tests`): в env шагов pytest и e2e добавить `NOTIFY_CHANNEL_PRIORITY: mock`.
- [ ] `backend/tests/test_notify_redis_s6_delivery.py` (маркированная проверка S6, бекенд-половина): поднятый контуром Redis; `enqueue_task` задачи (реальный `task_id` строки БД) с адресом без префикса → воркерская итерация → `LRANGE` списка `mock:deliveries` (с префиксом контура) содержит `{address, text}` с подставленным текстом; `LTRIM` держит список ≤1000 (вставить 1001, проверить длину).
- [ ] `frontend/admin/e2e/notify-s6-mock-delivery.spec.ts`: обвязка как у S1 (пропуск вне notify-контура); leg: вход администратором → создание записи с чекбоксом «отправлять оповещения» на будущего клиента → UI записей не изменился (запись в списке); утверждения доставки — в маркированной проверке выше (разделение S1-прецедент).
- [ ] `pyproject.toml`: убрать `src/notify/worker.py` из списка coverage-исключений (спека §3.8; `redis_queue.py` остаётся — адаптер покрыт маркированным контуром вне основного прогона).
- [ ] S10-инвариант: `cd backend && .venv/bin/python -m pytest -q` без `REDIS_URL` — весь зелёный, маркированные пропущены; основной CI (без notify-джобы) не тронут составом.
- [ ] DoD: E2E-сценарий S6 проходит в notify-контуре (RED-GREEN-REFACTOR: фаза RED — прогон спеки на стеке до правок Task 8, падает отсутствием воркера в стеке); S10 подтверждён.
- [ ] Коммит: `feat(#484): воркер в dev/e2e/CI-контурах, S6 e2e, приоритет mock до части 4`.

---

## Self-Review

- Покрытие спеки: §3.1 → Tasks 3–5; §3.2 → Task 2; §3.3 → Tasks 2, 8; §3.4 → Task 4; §3.5 → Tasks 4, 6; §3.6 → Tasks 2, 7, 8; §3.7 → Task 1; §3.8 → Task 8. Сценарии: S6 → Task 8, S7/S8 → Task 7, S9 → Tasks 4–6, S10 → Task 8. Пробелов нет.
- Placeholder-скан: заглушек нет; каждое действие — с кодом или точной командой.
- Консистентность типов: `WorkerQueue` (Task 3) — то, что принимает `main` (Task 5); `deliver_task`-сигнатура Task 4 используется Task 5; рекордер Task 2 используется Tasks 7–8.
- Required Docs — в каждой задаче.
