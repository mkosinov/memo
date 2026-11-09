# GH #580 — DomainEventsService: выноска сервиса доменных событий из notify (журнал, ретранслятор, стримы по типам)

- **Date**: 2026-11-08
- **Branch**: `580-domain-events`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `261ef64f` (= origin/main) — 11 коммитов (`8f5588e0..69b1c938`), 53 файла, +5256/−912
- **Issue**: #580 — сервис доменных событий как самостоятельный модуль `src/domain_events`: транзакционный журнал, реестр типов событий, ретранслятор журнал→стрим, API подписки (consumer-группы), восстановление после потери Redis; notify переводится с поллинга журнала на подписку — notification становится group-subscriber'ом группы `notification` на `domain_events:new_record`
- **Спека**: `docs/specs/2026-11-08-domain-events-service-580-design.md` (рев.2)
- **План**: `docs/plans/2026-11-08-domain-events-service-580-plan.md` — 8/8 задач, все done
- **Domain rules**: `docs/domain-rules/domain-events.md` — полный жизненный цикл (транспорт, журнал, реестр, ретранслятор, подписки, восстановление, границы), синхронизирован этой веткой (+28/−6); `docs/domain-rules/notify.md` — порядок переключения (+1)

## Что выполнено

1. **Общий транспорт стримов (T1, `8f5588e0` standard, фикс ре-экспорта
   `b2426ba3`)** — потребительско-издательское ядро Redis-стримов вынесено
   в `src/streams/transport.py` — общий шов для notify-очереди и новых
   подписчиков; явный ре-экспорт `MAX_POOL_CONNECTIONS` + зеркало текста
   транспорта в фейках (ревью T1).
2. **Модуль `src/domain_events` (T2, `8440cbd2` standard, формат
   `dc740d97`)** — модель (`models.py`), транзакционный журнал
   (`journal.py`), реестр типов (`types.py`); шов продюсера переключён —
   `decorators`/`record_snapshots`/`records` пишут в новый журнал;
   `domain_events` не зависит от notify (канонический шов §8).
3. **Миграция переключения (T3, `c4c49e6d` standard)** — `e8a2c4d6b0f3`:
   `published_at`, бэкфилл ИЛИ-множеств, гроссбух попыток
   `notify_event_attempts`, частичный индекс корней; полный сюит
   3957/0 поверх миграции.
4. **Ретранслятор (T4, `c4140b5a` standard)** — `relay.py`: цикл
   журнал→стрим; общий `run_loop` в `src/util/process` (юнит
   `tests/util/test_process.py`).
5. **API подписки (T5, `c06eb591` small)** — `subscribe.py`:
   `Subscriber` (ensure/claim/ack/reclaim/close) над общим ядром
   стримов.
6. **Notification — подписчик (T6, `1a852445` large)** — диспетчер:
   группа `notification` на `domain_events:new_record` вместо поллинга
   журнала; гроссбух попыток, цикл возврата зависших; полный сюит
   3975/0 поверх переключения.
7. **Восстановление после потери Redis (T7, `96690207` small)** —
   `--republish-since`: dry-run счёт строк, переиздание окнами ≤ MAXLEN
   с пометкой `published_at` между окнами, включающая граница
   `occurred_at >= точки`.
8. **Границы + финальная прогонка (T8, `85f4bb1e` + `69b1c938` small)** —
   тест импорт-направлений по каноническому списку шва §8
   (`domain_events` без notify, notify/продюсер по allowlist'ам,
   `streams` ниже обоих); резолвер относительных импортов ленты границ —
   level≥2 виден правилам; чистка мёртвых тестов поллинга (не
   обнаружено, комментарий цикла уточнён).

## Отклонения и фикс-циклы

- **`b2426ba3` (ревью T1):** явный ре-экспорт `MAX_POOL_CONNECTIONS`
  (линт-бюджет F401) + зеркало текста транспорта в фейках.
- **Ревью T2:** два минора зафиксированы в `8440cbd2`/`dc740d97`.
- **`69b1c938` (ревью T8):** резолвер относительных импортов ленты
  границ — правила уровня ≥2 не видели ленту; из двух миноров финального
  ревью один принят как есть, один фиксирован этим коммитом.

## Верификация (финальное дерево, `69b1c938`)

| Проверка | Результат |
| --- | --- |
| Backend полный (exit 0) | **3987 passed / 0 failed / 92 skipped** |
| Redis-контур (зеркало CI `notify-tests`) | **76 passed / 0 failed / 1 skip** (env-conditional) |
| mypy `src` | **0** |
| lint-бюджет | **зелёный** (ruff 111/111) |
| Visual compliance gate (G4.5) | **N/A → exit 0** («not applicable» — UI не менялся) |

## Ревью

- T1–T4 — standard (two-stage), T5/T7/T8 — small (1-stage), T6 — large;
  все ревью пройдены (compliance ✅, quality ✅ где применимо); фикс- и
  девиационные итерации сложены в ветку (`b2426ba3`, `dc740d97`,
  `69b1c938`). T8 дополнительно пробавлен full-feature-ревью.

## Behavioral Delta

Поведение пользователей не изменилось. Инфраструктурная дельта: продюсер
записывает доменные события в транзакционный журнал `src/domain_events`
(шов переключён на модуль), ретранслятор раздаёт их в стримы по типам
(`XADD MAXLEN ~` — стрим только транспорт, архив — журнал в БД),
notification потребляет группу `notification` на `domain_events:new_record`
вместо поллинга журнала. Гарантия доставки — at-least-once с
дедупликацией на подписчике; потеря Redis лечится штатным
пересозданием групп на старте + процедурным `--republish-since`.

## PR-заметки

- `Closes #580` — только в описании PR (канон репо), в коммиты не пишется.
- Спека/план на ветке с базы — docser их не касался; domain-rules
  обновлены кодовыми коммитами ветки (см. Range).

## Тронутые файлы (`git diff --name-only 261ef64f..69b1c938`)

```
backend/alembic/env.py
backend/alembic/versions/e8a2c4d6b0f3_domain_events_published_at.py
backend/pyproject.toml
backend/src/core/config.py
backend/src/domain_events/__init__.py
backend/src/domain_events/journal.py
backend/src/domain_events/models.py
backend/src/domain_events/relay.py
backend/src/domain_events/subscribe.py
backend/src/domain_events/types.py
backend/src/models/__init__.py
backend/src/notify/__init__.py
backend/src/notify/channels/registry.py
backend/src/notify/channels/telegram.py
backend/src/notify/dispatcher.py
backend/src/notify/models.py
backend/src/notify/redis_queue.py
backend/src/notify/scenarios.py
backend/src/notify/worker.py
backend/src/services/decorators.py
backend/src/streams/__init__.py
backend/src/streams/transport.py
backend/src/usecases/record_snapshots.py
backend/src/usecases/records.py
backend/src/util/process.py
backend/tests/domain_events/__init__.py
backend/tests/domain_events/test_boundaries.py
backend/tests/domain_events/test_journal_transactional.py
backend/tests/domain_events/test_migration.py
backend/tests/domain_events/test_relay.py
backend/tests/domain_events/test_relay_gate.py
backend/tests/domain_events/test_relay_unit.py
backend/tests/domain_events/test_subscribe.py
backend/tests/domain_events/test_types.py
backend/tests/domain_events/test_wipe_recovery.py
backend/tests/test_notify_dispatcher.py
backend/tests/test_notify_migration.py
backend/tests/test_notify_per_channel_model.py
backend/tests/test_notify_redis_chain.py
backend/tests/test_notify_redis_limits_chain.py
backend/tests/test_notify_redis_reenqueue.py
backend/tests/test_notify_redis_s6_delivery.py
backend/tests/test_notify_redis_s7_fallback.py
backend/tests/test_notify_scenarios.py
backend/tests/test_notify_worker.py
backend/tests/test_seed_canon.py
backend/tests/test_streams_transport.py
backend/tests/usecases/test_record_snapshots.py
backend/tests/usecases/test_records_create_notify_event.py
backend/tests/util/test_process.py
dev.sh
docs/domain-rules/domain-events.md
docs/domain-rules/notify.md
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-11-08-domain-events-service-580.md` — только
мета-доки; код/спеки/планы/domain-rules не тронуты.

## References

- **GitHub Issue**: #580
- **Design Spec**: `docs/specs/2026-11-08-domain-events-service-580-design.md` (рев.2)
- **Plan**: `docs/plans/2026-11-08-domain-events-service-580-plan.md` (8/8)
- **Domain rules**: `docs/domain-rules/domain-events.md`,
  `docs/domain-rules/notify.md`
- **Смежные**: notify-семья #476 — `docs/status/2026-10-20-notify-events-482.md`,
  #483, #484, #485; ADR 008 (транзакционный журнал доменных событий),
  ADR 013 (Redis-стримы)
- **PR**: _(to be added after PR creation)_
