# GH #581 — Волна переименования notify → notification (пакет, таблицы, стримы, env, CI, код ошибки, доки)

- **Date**: 2026-11-10
- **Branch**: `581-notification-rename`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `d249f2c5` — 6 коммитов (`b60ebe44..858b2f33`), 112 файлов, +2214/−1691
- **Issue**: #581 — атомарная волна переименования подсистемы уведомлений к пользовательскому имени `notification`: пакет и классы, таблицы/колонка согласия/индексы, стримы и ключи Redis, логгеры, env, CI-джоба и контур запуска, код ошибки, живая документация. Поведение и данные (кроме имён) не меняются; один PR на всю волну.
- **Спека**: `docs/specs/2026-11-09-notification-rename-581-design.md` (рев.2)
- **План**: `docs/plans/2026-11-09-notification-rename-581-plan.md` — 6/6 задач, все done
- **Domain rules**: `docs/domain-rules/notification.md` (переименован из `notify.md`) + `domain-events.md`/`_overview.md`/`records.md`/`auth.md` — вошли в кодовый коммит T6 (`858b2f33`), docser не дублировал

## Что выполнено

1. **Миграция данных и слой моделей (T1, `b60ebe44` standard)** —
   alembic-ревизия `f3a5c7e9b1d2` (родитель `e8a2c4d6b0f3`):
   `rename_table` × 4 (`notify_tasks`→`notification_tasks`,
   `notify_task_attempts`→`notification_task_attempts`,
   `notify_event_attempts`→`notification_event_attempts`,
   `notify_templates`→`notification_templates`), batch-переименование
   `clients.notify_enabled`→`notification_enabled`, drop+create трёх
   именованных индексов (включая partial `sqlite_where` и
   `COALESCE`-expression), полный симметричный downgrade; UPDATE данных
   нет (`skip_reason="notify_off"` остаётся). Модели: `__tablename__` × 4,
   имена `Index` × 3, FK-строка; ORM-атрибут в `src/models/client.py`.
   Строковые потребители (`domain/deletion.py`, `services/client.py`),
   сид-канон (`test_seed_canon.py`, `gen_seed_canon.py`), миграционный
   тест переименован и расширен (§5.6–5.8: `PRAGMA foreign_keys=ON`,
   FK-ассерт, pre-upgrade вставки под старой колонкой на родителе,
   absence-ассерты `sqlite_master`, roundtrip согласия, no-drift ORM);
   `domain_events/test_migration.py` на новые имена.
2. **Пакет, классы, конфиг, логгеры (T2, `47333084` large)** —
   `git mv src/notify → src/notification`; классы
   `Notify*`→`Notification*` (модели, `NotifyQueue`, исключения);
   внешние импорты (`models/__init__.py`, `alembic/env.py`); env
   `NOTIFY_*`→`NOTIFICATION_*` (5 имён) + тела валидаторов + fail-fast
   строки + `.env.example`; лог-неймспейс
   `memo.notify.*`→`memo.notification.*` + префиксы процессов/ошибок;
   28 переименований тест-файлов (`test_api_records_notify_flag.py`
   имя СОХРАНЕНО — обновлены только внутренние литералы подсистемы);
   страж границ `test_boundaries.py` обновлён вместе с переносом
   (ветка «#589 открыт»); coverage-omit в `pyproject.toml`, докстринги
   `src/streams/*`/`src/domain_events/*`.
3. **Транспортные литералы Redis (T3, `45e41ed5` small)** — стримы
   `notify:tasks|statuses|inbound`→`notification:*`; обе пары cap-ключей
   (`notification:{channel}:cap:{yyyymmdd}` и `…cap-notified…`); ключи
   доставок mock-каналов; литералы в redis-тестах; группы
   `dispatcher`/`worker` не тронуты (имя подсистемы не несут).
4. **Контур запуска и CI (T4, `845e3c78` standard)** — `dev.sh`:
   `--notification`, `NOTIFICATION_MODE`, экспорты `NOTIFICATION_*`,
   спавны `src.notification.dispatcher|worker`; шард-скрипт:
   `NOTIFICATION_E2E_*` ×4, `SHARD_ID=notification`,
   `TEST_DB_PATH=test_memo_notification_e2e.db`, dryrun-ассерты
   argv/env/журнальных строк; workflow: джоба `notification-tests`,
   `NOTIFICATION_TESTS_E2E_ENABLED` (5 точек), артефакт
   `e2e-report-notification`, пути спек; **укрепление Spec-file guard** —
   шаг дополнительно греплит актуальный литерал `NOTIFICATION_E2E_ENABLED`
   в спеке (защита от зелёно-пустого скипа); e2e-спеки
   `notification-s1-enabled-stack`/`notification-s6-mock-delivery`
   (env-гейт, SQL `notification_tasks`, cap-ключи), `globalSetup.ts`
   BLACKLIST, `fixtures/seed-reset.ts`.
5. **Код ошибки и веб-контракт (T5, `0ec77d14` small)** —
   `NOTIFY_TRANSPORT_UNAVAILABLE`→`NOTIFICATION_TRANSPORT_UNAVAILABLE`
   (`errors.py`, `auth/otp_transport.py`, `auth/router.py`) + тесты
   (`test_errors.py`, `test_auth_otp_api.py`); web-тесты (`useOtpLogin`,
   `BookingOverlay`), api-client `endpoints.ts`, web e2e-либы и
   test-e2e.sh.
6. **Документация, CHANGELOG, греп-контроль §10 (T6, `858b2f33` small)** —
   domain-rules `notify.md`→`notification.md`
   (+ `domain-events.md`/`_overview.md`/`records.md`/`auth.md`),
   release-док, `tests_workflow.md`, CHANGELOG-запись; выходной
   греп-контроль §10 — резидуальный «notify» только в allowlist-зонах
   (tracked content).

## Отклонения и фикс-циклы

- **T2 (large):** compliance-fix round ревью сложен в финальный коммит
  `47333084`.
- **T6 (small):** fix round — остаточный литерал в
  `backend/src/util/utc.py`, сложен в `858b2f33` (тот же коммит, что
  и доки).
- Девиаций от спеки/плана нет; условный шаг T2 по #589 выполнен по
  ветке «#589 открыт» (страж обновлён, не удалён).

## Верификация (по задачам, финальные прогоны)

| Проверка | Результат |
| --- | --- |
| T2 — полный backend pytest (exit 0) | **3995 passed / 0 failed / 92 skipped** (redis equal-skips) |
| T3 — live-Redis `-m redis` | **76 passed / 0 failed / 1 skip** (env-conditional) |
| T3 — без-Redis корпус | **368 passed / 68 skipped** |
| T4 — dryrun-сьют шард-скрипта | **139/139** |
| T4 — guard dry-run | RED/GREEN верифицирован |
| T4 — live-контур e2e | s1 **1/1** + s6 **5/5** (0 skipped) |
| T4 — queue pytest / relay-seam | **1/1** + **1/1** |
| T5 — backend целевые | **61 passed / 0 failed** |
| T5 — web vitest | **493/0** |
| T5 — api-client | **571/0** |
| T6 — §10 grep-гейт | all-zone residue — только allowlist (tracked content) |
| Visual compliance gate (G4.5) | **N/A → exit 0** («not applicable» — UI не менялся) |

## Ревью

- T1/T4 — standard (two-stage), T2 — large, T3/T5/T6 — small (1-stage);
  все ревью пройдены (compliance ✅, quality ✅ где применимо);
  фикс-раунды T2 и T6 сложены в ветку (см. выше).

## Behavioral Delta

Поведение пользователей не изменилось. Дельта — только имена: таблицы/
колонка согласия/индексы в БД, пакет и классы, env-переменные, стримы
и ключи Redis, лог-неймспейс, CI-джоба и артефакт, код ошибки
`NOTIFICATION_TRANSPORT_UNAVAILABLE`. Переключение одним деплоем
(спека §4); миграция симметрична (downgrade зеркален). Резидуальный
«notify» — только allowlist спеки §10: `records.notify`-флаг +
производные (`test_api_records_notify_flag.py`,
`skip_reason="notify_off"`), иноязычное английское «notify»,
исторический канон (спеки/планы/статусы/решения, CHANGELOG до #581,
alembic/versions, провенанс-докстринги).

## PR-заметки

- `Closes #581` — только в описании PR (канон репо), в коммиты не пишется.
- Спека (`0730789f`) и план (`d249f2c5`) — коммиты самой ветки;
  docser их не касался.
- CHANGELOG и domain-rules вошли в кодовый коммит T6 (`858b2f33`);
  docser их не дублировал. Docs-коммит docser — `PLAN.md` +
  `docs/status/2026-11-10-notification-rename-581.md` — только
  мета-доки; код/спеки/планы/domain-rules не тронуты.

## Тронутые файлы (`git diff --name-only d249f2c5..858b2f33`)

```
.github/workflows/test.yml
CHANGELOG.md
backend/.env.example
backend/alembic/env.py
backend/alembic/versions/f3a5c7e9b1d2_notification_rename_tables.py
backend/pyproject.toml
backend/scripts/generate_telegram_session.py
backend/seed-data/README.md
backend/src/auth/otp_transport.py
backend/src/auth/router.py
backend/src/core/config.py
backend/src/domain/deletion.py
backend/src/domain_events/__init__.py
backend/src/domain_events/models.py
backend/src/domain_events/relay.py
backend/src/domain_events/subscribe.py
backend/src/errors.py
backend/src/models/__init__.py
backend/src/models/client.py
backend/src/notification/__init__.py
backend/src/notification/assembly.py
backend/src/notification/channels/__init__.py
backend/src/notification/channels/base.py
backend/src/notification/channels/limits.py
backend/src/notification/channels/mock.py
backend/src/notification/channels/mock2.py
backend/src/notification/channels/registry.py
backend/src/notification/channels/telegram.py
backend/src/notification/dispatcher.py
backend/src/notification/models.py
backend/src/notification/queue.py
backend/src/notification/redis_queue.py
backend/src/notification/render.py
backend/src/notification/scenarios.py
backend/src/notification/time.py
backend/src/notification/worker.py
backend/src/services/client.py
backend/src/streams/__init__.py
backend/src/streams/transport.py
backend/src/usecases/record_snapshots.py
backend/src/usecases/records.py
backend/src/util/process.py
backend/src/util/utc.py
backend/tests/domain/test_deletion.py
backend/tests/domain/test_deletion_family.py
backend/tests/domain_events/test_boundaries.py
backend/tests/domain_events/test_migration.py
backend/tests/domain_events/test_relay.py
backend/tests/domain_events/test_relay_gate.py
backend/tests/domain_events/test_relay_unit.py
backend/tests/domain_events/test_subscribe.py
backend/tests/domain_events/test_wipe_recovery.py
backend/tests/notification_redis_support.py
backend/tests/test_auth_otp_api.py
backend/tests/test_errors.py
backend/tests/test_notification_assembly.py
backend/tests/test_notification_channel_limits.py
backend/tests/test_notification_channel_telegram.py
backend/tests/test_notification_channels.py
backend/tests/test_notification_channels_mock.py
backend/tests/test_notification_channels_mock2.py
backend/tests/test_notification_delivery.py
backend/tests/test_notification_dispatcher.py
backend/tests/test_notification_e2e_relay_seam.py
backend/tests/test_notification_migration.py
backend/tests/test_notification_per_channel_model.py
backend/tests/test_notification_queue.py
backend/tests/test_notification_redis_cap_store.py
backend/tests/test_notification_redis_chain.py
backend/tests/test_notification_redis_gates.py
backend/tests/test_notification_redis_limits_chain.py
backend/tests/test_notification_redis_queue.py
backend/tests/test_notification_redis_reenqueue.py
backend/tests/test_notification_redis_s1_queue.py
backend/tests/test_notification_redis_s6_delivery.py
backend/tests/test_notification_redis_s7_fallback.py
backend/tests/test_notification_redis_s8_recovery.py
backend/tests/test_notification_redis_worker_queue.py
backend/tests/test_notification_render.py
backend/tests/test_notification_scenarios.py
backend/tests/test_notification_settings_time.py
backend/tests/test_notification_worker.py
backend/tests/test_notify_migration.py
backend/tests/test_seed_canon.py
backend/tests/test_settings_redis_url.py
backend/tests/test_streams_transport.py
backend/tests/test_user_client_migration.py
backend/tests/test_util_utc.py
backend/tests/usecases/test_record_snapshots.py
backend/tests/usecases/test_records_create_notification_event.py
backend/tests/util/test_process.py
dev.sh
docs/domain-rules/_overview.md
docs/domain-rules/auth.md
docs/domain-rules/domain-events.md
docs/domain-rules/notification.md
docs/domain-rules/records.md
docs/release/v1-2026-12-01.md
docs/tests_workflow.md
frontend/admin/e2e/fixtures/seed-reset.ts
frontend/admin/e2e/globalSetup.ts
frontend/admin/e2e/notification-s1-enabled-stack.spec.ts
frontend/admin/e2e/notification-s6-mock-delivery.spec.ts
frontend/web/app/hooks/__tests__/useOtpLogin.test.tsx
frontend/web/app/ui/__tests__/BookingOverlay.test.tsx
frontend/web/e2e/lib/backend-url.ts
frontend/web/e2e/lib/stack-port.ts
frontend/web/scripts/test-e2e.sh
packages/api-client/src/endpoints.ts
scripts/e2e-shard-start.dryrun.test.sh
scripts/e2e-shard-start.sh
scripts/gen_seed_canon.py
```

## References

- **GitHub Issue**: #581
- **Design Spec**: `docs/specs/2026-11-09-notification-rename-581-design.md` (рев.2)
- **Plan**: `docs/plans/2026-11-09-notification-rename-581-plan.md` (6/6)
- **Domain rules**: `docs/domain-rules/notification.md` (renamed from
  `notify.md`), `domain-events.md`, `_overview.md`, `records.md`, `auth.md`
- **Смежные**: notify-семья #476 — `docs/status/2026-10-20-notify-events-482.md`,
  #483, #484, #485; #580 (DomainEventsService) —
  `docs/status/2026-11-08-domain-events-service-580.md`; #499
  (`NOTIFY_TRANSPORT_UNAVAILABLE` — источник кода ошибки);
  #589 (упразднение мета-стража границ)
- **PR**: _(to be added after PR creation)_
