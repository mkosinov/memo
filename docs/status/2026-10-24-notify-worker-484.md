# GH #484 — Воркер отправки оповещений (часть 3 системы оповещений #476)

- **Date**: 2026-10-24
- **Branch**: `484-notify-worker`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `e6981c52` — 10 коммитов (`8f4205f4..88d874f9`), 29 файлов, +3553/−398
- **Issue**: #484 — notify subsystem part 3: воркер потребляет очередь (`WorkerQueue`, группа `worker`), доставляет через реестр каналов, публикует статусы; семья — #476 (часть 3/5; части 1–2 = #482/#483 на main)
- **Спека**: `docs/specs/2026-10-22-notify-worker-484-design.md` (рев.2)
- **План**: `docs/plans/2026-10-23-notify-worker-484-plan.md` — 8/8 задач, все done
- **Domain rules**: `docs/domain-rules/notify.md` — этой веткой не менялся
- **Характер**: продуктовая доставка — потребительская половина транспорта, канальный шов с мок-каналом до части 4 (реальные каналы), воркер включён в dev/e2e/CI-контуры части 2

## Что выполнено

1. **`NOTIFY_SEND_RETRIES` + общий `process.py` (T1, `8f4205f4`, small)** —
   настройка числа попыток доставки + общий модуль процессов
   (`run_loop`, обработка сигналов) — общий каркас для воркера.
2. **Пакет `channels` (T2, `d6bd8e15` + гейт-рефактор `738603f4`, standard)** —
   `backend/src/notify/channels/`: протокол канала (async-шов, конвертация
   внутри канала), типизированные ошибки, реестр и мок-канал; гейт реестра —
   `logger.error` + `SystemExit(2)` по прецеденту `connect_or_exit`
   (tuple-форма давала exit 1).
3. **Воркерская половина транспорта (T3, `9ddad53d`, standard)** — порт
   `WorkerQueue` + `FakeQueue`, потребительская группа `worker` в
   `RedisQueue` (чтение, claim, ack — зеркально диспетчерской половине).
4. **Ядро доставки (T4, `285cc98d`, standard)** — валидатор payload
   (каноническая форма `task_id` — непустая UUID-строка) и `deliver_task`:
   перебор каналов по приоритету с ретраями, статусы `sent`/`failed`/
   `not_delivered`.
5. **Цикл воркера (T5, `eede6e04`, standard)** — вход и цикл доставки:
   стартовые проверки (гейты, группы), периодический `reclaim` зависших,
   ack строго после публикации статусов.
6. **Защита читателя статусов (T6, `57d4a492`, small + шов-фикс
   `4cabab6b`)** — диспетчер подтверждает бракованные статус-события
   (кривая форма, неизвестная задача/стадия) — читатель не циклится на
   яде; follow-up: `task_id` приведён к реальному шву `NotifyTask.id`
   (String(36)) и в валидаторе воркера, и в слое брака диспетчера.
7. **Маркированные S7+S8 (T7, `fd04f08d`, standard)** — фолбэк на
   приоритет-2 и `not_delivered` (DB-строка → failed при исчерпании),
   возврат зависших задач через reclaim + ack-закрытие у удерживающего
   консьюмера.
8. **Контуры и e2e S6 (T8, `88d874f9`, standard)** — воркер включён в
   dev/e2e/CI-контуры (dev.sh уже поднимал процесс — теперь он реально
   доставляет); Playwright `notify-s6-mock-delivery.spec.ts` — S6 через
   мок-канал (RED→GREEN доказан); dryrun-сюит пополнен; приоритет мок-
   канала — осознанно до части 4 (реальные каналы).

## Отклонения и фикс-циклы

- **`4cabab6b` (шов-фикс плана, середина T6):** скетчи плана рисовали
  `task_id` как int — реальный шов `NotifyTask.id` это `String(36)`;
  валидатор воркера и слой брака диспетчера переведены на канон
  «непустая UUID-строка». Примеры int в спеке семьи #476 §4.2/§4.3 —
  артефакт спеки (кандидат в errata, см. Follow-ups).

## Ключевые решения

1. **`task_id` = непустая UUID-строка** — каноническая форма по шву
   `NotifyTask.id` (String(36)); int-примеры семьи #476 §4.2/§4.3 —
   errata-кандидат.
2. **Гейт реестра** — `logger.error` + `SystemExit(2)` по прецеденту
   `connect_or_exit` (tuple-форма exit 1).
3. **Имя списка рекордера** — `notify:mock:deliveries` (спека §3.6
   поверх скетча плана).
4. **Послабление S1** — спека + маркированная S1-проверка очереди
   relaxed `queued→{queued,sending,sent}`: живой воркер теперь двигает
   задачи дальше queued (failed по-прежнему жёсткий фейл).
5. **Хук регистрации каналов** — `channels/__init__.py` (9 строк), чтобы
   процессный вход видел реестр.

## Верификация (финальное дерево, `88d874f9`)

| Проверка | Результат |
| --- | --- |
| Backend полный, без `REDIS_URL` (инвариант S10) | **3724 passed / 0 failed / 58 skipped** (redis-marked) |
| Маркированный контур (воркер-очередь, S6, S7, S8, S1-relax, reenqueue, гейты) | **всё зелёное** против живого Redis |
| notify e2e-контур | **S1 1/1, S6 1/1** (RED→GREEN доказан) |
| dryrun-шард `e2e-shard-start.dryrun.test.sh` | **ALL PASS** |
| ruff + mypy + lint-бюджет | **зелёные** |
| Coverage | **90.61%** total, `worker.py` измеряется (~90%) |
| Визуальный комплаенс-гейт (G4.5) | **N/A → exit 0** (UI не менялся — S6 ассертит неизменный список записей) |

## DoD-статус / User Scenarios

- **S6 ✅** — e2e через мок-канал + маркированная backend-проверка.
- **S7 ✅** — фолбэк/`not_delivered`, DB-строка уходит в sent/failed.
- **S8 ✅** — reclaim зависших + ack-закрытие у консьюмера.
- **S9 ✅** — юнит-матрица + process-интеграция.
- **S10 ✅** — инвариант без Redis (полный сюит без `REDIS_URL` зелёный).
- §3.1–§3.8 реализованы по coverage-таблице плана; все DoD 8 задач выполнены.

## Ревью

- Классификация по размерам: T1/T6 — small (1-stage), T2–T5/T7/T8 —
  standard (2-stage). Шов-фикс `4cabab6b` верифицирован отдельным ревью.

## Behavioral Delta

По умолчанию (без `NOTIFY_ENABLED`/`REDIS_URL`) поведение прежнее —
инвариант S10. При включённой доставке воркер реально потребляет группу
`worker`: задача из стрима → валидация payload → перебор каналов по
приоритету с ретраями (`NOTIFY_SEND_RETRIES`) → публикация статус-событий
→ ack после статусов; зависшие задачи возвращаются периодическим
reclaim. Доставка — через реестр каналов; единственный канал — мок
(запись в `notify:mock:deliveries`), реальные каналы — часть 4. UI не
менялся.

## PR-заметки

- `Closes #484` — только в описании PR (канон репо), в коммиты не пишется.
- Семья #476: часть 3 из 5; части 1–2 (#482/#483) на main; спека семьи —
  `docs/specs/2026-10-11-notify-system-476-design.md`.

## Follow-up кандидаты (не заводились — на усмотрение архитектора)

- Errata спеки семьи #476 §4.2/§4.3: примеры `task_id` int → UUID-строка.
- Унификация инертных int-id в redis-тестовых хелперах к части 5.
- S6 e2e-нога без CI-раннера (контурно доказана — маркированный S6 + dryrun).
- Латентный nit `worker.py`: `channels = channels or build_instances` → `is None`.
- Префикс guard-лога `process.py` захардкожен «notify dispatcher:».
- Дедуп хелперов маркированных модулей (`_worker_consumers`/`_consumer_names`).

## Тронутые файлы (`git diff --name-only e6981c52..88d874f9`)

```
.github/workflows/test.yml
backend/pyproject.toml
backend/src/core/config.py
backend/src/notify/channels/__init__.py
backend/src/notify/channels/base.py
backend/src/notify/channels/mock.py
backend/src/notify/channels/registry.py
backend/src/notify/dispatcher.py
backend/src/notify/process.py
backend/src/notify/queue.py
backend/src/notify/redis_queue.py
backend/src/notify/worker.py
backend/tests/test_notify_channels.py
backend/tests/test_notify_channels_mock.py
backend/tests/test_notify_delivery.py
backend/tests/test_notify_dispatcher.py
backend/tests/test_notify_queue.py
backend/tests/test_notify_redis_s1_queue.py
backend/tests/test_notify_redis_s6_delivery.py
backend/tests/test_notify_redis_s7_fallback.py
backend/tests/test_notify_redis_s8_recovery.py
backend/tests/test_notify_redis_worker_queue.py
backend/tests/test_notify_settings_time.py
backend/tests/test_notify_worker.py
dev.sh
frontend/admin/e2e/notify-s1-enabled-stack.spec.ts
frontend/admin/e2e/notify-s6-mock-delivery.spec.ts
scripts/e2e-shard-start.dryrun.test.sh
scripts/e2e-shard-start.sh
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-24-notify-worker-484.md` — только мета-доки;
код/спеки/планы/domain-rules не тронуты.

## Scope guards

Часть 4 (реальные каналы доставки) и часть 5 не строились; мок-канал —
единственный зарегистрированный, приоритет мока осознанный (до части 4);
режим по умолчанию (без Redis) байт-в-байт прежний — инвариант S10;
спека/план на ветке с базы, docser их не касался; `Closes #484` — только
в описании PR (канон репо).

## References

- **GitHub Issue**: #484 (семья #476, часть 3/5)
- **Design Spec**: `docs/specs/2026-10-22-notify-worker-484-design.md` (рев.2)
- **Family Spec**: `docs/specs/2026-10-11-notify-system-476-design.md`
- **Plan**: `docs/plans/2026-10-23-notify-worker-484-plan.md` (8/8)
- **Parts 1–2**: #482 — `docs/status/2026-10-20-notify-events-482.md`,
  #483 — `docs/status/2026-10-22-notify-infra-483.md`
- **PR**: _(to be added after PR creation)_
